/**
 * Orca plugin worker entry: mirrors the agent fleet into Discord Rich Presence.
 *
 * Lifetime note, because it shapes everything below: Orca reaps a plugin worker
 * after 5 minutes with no in-flight work (`PLUGIN_WORKER_IDLE_REAP_MS`) and
 * re-forks it on the next event. A worker cannot keep itself alive — only
 * host→worker traffic refreshes the idle clock. So the presence is deliberately
 * *ephemeral*: it appears while the fleet is active, disappears once things have
 * been quiet for a few minutes, and comes back on the next agent event. State
 * survives the gap in plugin storage rather than in memory.
 */

import { DiscordPresenceClient } from './lib/discord-ipc.mjs'
import type {
  JsonValue,
  OrcaPluginApi,
  PluginCapabilityKind,
  WorkspaceContext
} from './lib/orca-api.mjs'
import {
  DEFAULT_PRIVACY,
  applyAgentStatus,
  applyWorktreeCreated,
  applyWorktreeRemoved,
  buildActivity,
  createPresenceState,
  deserializeState,
  describeActivity,
  isBusy,
  isPrivacyLevel,
  nextPrivacy,
  pruneStale,
  serializeState,
  summarize,
  type PresenceState,
  type PresenceSummary,
  type PrivacyLevel
} from './lib/presence-model.mjs'

const STORAGE_KEY = 'presence-state'
const STORAGE_STARTED_AT_KEY = 'busy-since'

/**
 * Discord application backing the presence by default.
 *
 * Rich Presence application ids are public identifiers — they travel in every
 * client's IPC traffic and grant nothing on their own. The sensitive half is
 * the OAuth client secret, which Rich Presence never needs and this plugin
 * never asks for. Shipping an id means the plugin works on install; set
 * `clientId` in settings to publish under your own application instead (the
 * application's name is what Discord shows as the "Playing …" line).
 */
export const DEFAULT_CLIENT_ID = '1534192299926360234'

/** Coalesce bursts: a single agent transition can fan out several events. */
const PUBLISH_DEBOUNCE_MS = 1_500
/** Discord throttles SET_ACTIVITY at roughly 5 calls / 15s; stay well under. */
const MIN_PUBLISH_INTERVAL_MS = 4_000
const FOCUS_POLL_MS = 30_000
const RECONNECT_DELAYS_MS = [15_000, 30_000, 60_000] as const

type PluginSettings = {
  enabled: boolean
  privacy: PrivacyLevel
  clientId: string
  assets: { largeImage: string; largeText: string }
}

export type PresenceStatusReport = {
  enabled: boolean
  privacy: PrivacyLevel
  connected: boolean
  socketPath: string | null
  /** False once `clientId` in settings points at the user's own application. */
  usingDefaultApplication: boolean
  summary: PresenceSummary
  lastError: string | null
}

/**
 * Module-scoped because the host ignores whatever `activate` returns and calls
 * the `deactivate` export for teardown — there is nowhere else to hand the
 * runtime across.
 */
let activeRuntime: PresenceRuntime | null = null

export default function activate(orca: OrcaPluginApi): void {
  activeRuntime?.dispose()
  const runtime = new PresenceRuntime(orca)
  activeRuntime = runtime
  runtime.start()

  orca.commands.register('presence.toggle', () => runtime.toggleEnabled())
  orca.commands.register('presence.privacy', () => runtime.cyclePrivacy())
  orca.commands.register('presence.status', () => runtime.reportStatus())

  orca.events.on('worktree.created', (payload) => {
    runtime.onEvent((state) => applyWorktreeCreated(state, payload))
  })
  orca.events.on('worktree.removed', (payload) => {
    runtime.onEvent((state) => applyWorktreeRemoved(state, payload))
  })
  orca.events.on('agent.status.changed', (payload) => {
    runtime.onEvent((state) => applyAgentStatus(state, payload))
  })
}

export async function deactivate(): Promise<void> {
  const runtime = activeRuntime
  activeRuntime = null
  // Clear the status on the way out: a stale "3 agents working" left sitting on
  // a profile after Orca quits is worse than no presence at all.
  await runtime?.shutdown()
}

class PresenceRuntime {
  readonly #orca: OrcaPluginApi
  readonly #granted: Set<PluginCapabilityKind>

  #state: PresenceState = createPresenceState()
  #settings: PluginSettings = {
    enabled: true,
    privacy: DEFAULT_PRIVACY,
    clientId: DEFAULT_CLIENT_ID,
    assets: { largeImage: '', largeText: '' }
  }
  #client: DiscordPresenceClient | null = null
  #connecting = false
  #reconnectAttempt = 0
  #busySince = 0
  #lastPublishAt = 0
  #lastPayload = ''
  #focus: WorkspaceContext = null
  #publishTimer: NodeJS.Timeout | null = null
  #reconnectTimer: NodeJS.Timeout | null = null
  #focusTimer: NodeJS.Timeout | null = null
  #disposed = false
  #lastError: string | null = null

  constructor(orca: OrcaPluginApi) {
    this.#orca = orca
    // Consent is granted per manifest, but a host that narrows a grant should
    // cost us a skipped call, not a failing one every 30 seconds.
    this.#granted = new Set(orca.grantedCapabilities ?? [])
  }

  start(): void {
    void this.#bootstrap()
    this.#focusTimer = setInterval(() => void this.#refreshFocus(), FOCUS_POLL_MS)
    this.#focusTimer.unref?.()
  }

  async #bootstrap(): Promise<void> {
    await this.#loadSettings()
    await this.#loadState()
    await this.#refreshFocus()
    this.#schedulePublish()
  }

  #can(capability: PluginCapabilityKind): boolean {
    return this.#granted.size === 0 || this.#granted.has(capability)
  }

  async #loadSettings(): Promise<void> {
    try {
      const result = await this.#orca.host.call('settings.get')
      const stored = result.settings ?? {}
      this.#settings = {
        enabled: stored['enabled'] !== false,
        privacy: isPrivacyLevel(stored['privacy']) ? stored['privacy'] : DEFAULT_PRIVACY,
        clientId: readClientId(stored['clientId']),
        assets: {
          largeImage: typeof stored['largeImage'] === 'string' ? stored['largeImage'] : '',
          largeText: typeof stored['largeText'] === 'string' ? stored['largeText'] : ''
        }
      }
    } catch (error) {
      this.#orca.log(`settings unavailable, using defaults: ${describeError(error)}`)
    }
  }

  async #saveSetting(key: string, value: JsonValue): Promise<void> {
    try {
      await this.#orca.host.call('settings.set', { key, value })
    } catch (error) {
      this.#orca.log(`could not persist ${key}: ${describeError(error)}`)
    }
  }

  async #loadState(): Promise<void> {
    try {
      const stored = await this.#orca.host.call('storage.get', { key: STORAGE_KEY })
      this.#state = pruneStale(deserializeState(stored.value), Date.now())
      const since = await this.#orca.host.call('storage.get', { key: STORAGE_STARTED_AT_KEY })
      this.#busySince = typeof since.value === 'number' ? since.value : 0
    } catch (error) {
      this.#orca.log(`could not restore state: ${describeError(error)}`)
    }
  }

  async #persistState(): Promise<void> {
    try {
      await this.#orca.host.call('storage.set', {
        key: STORAGE_KEY,
        value: serializeState(this.#state) as unknown as JsonValue
      })
    } catch (error) {
      this.#orca.log(`could not persist state: ${describeError(error)}`)
    }
  }

  async #refreshFocus(): Promise<void> {
    if (this.#disposed || !this.#can('workspace:read')) {
      return
    }
    try {
      this.#focus = await this.#orca.host.call('workspace.readContext')
    } catch (error) {
      // Non-fatal: without focus context the presence falls back to counts only.
      this.#orca.log(`workspace context unavailable: ${describeError(error)}`)
      this.#focus = null
    }
  }

  /** Applies a state mutation, then persists and republishes. */
  onEvent(mutate: (state: PresenceState) => void): void {
    if (this.#disposed) {
      return
    }
    try {
      mutate(this.#state)
    } catch (error) {
      this.#orca.log(`event ignored: ${describeError(error)}`)
      return
    }
    pruneStale(this.#state, Date.now())
    this.#trackBusyWindow()
    void this.#persistState()
    this.#schedulePublish()
  }

  /**
   * Discord's elapsed timer should measure the current stretch of work, so the
   * start stamp is set when the fleet goes idle→busy and cleared on the way back.
   */
  #trackBusyWindow(): void {
    const busy = isBusy(summarize(this.#state))
    if (busy && this.#busySince === 0) {
      this.#busySince = Date.now()
      void this.#orca.host
        .call('storage.set', { key: STORAGE_STARTED_AT_KEY, value: this.#busySince })
        .catch(() => {})
    } else if (!busy && this.#busySince !== 0) {
      this.#busySince = 0
      void this.#orca.host.call('storage.delete', { key: STORAGE_STARTED_AT_KEY }).catch(() => {})
    }
  }

  #schedulePublish(): void {
    if (this.#disposed || this.#publishTimer) {
      return
    }
    const sinceLast = Date.now() - this.#lastPublishAt
    const delay = Math.max(PUBLISH_DEBOUNCE_MS, MIN_PUBLISH_INTERVAL_MS - sinceLast)
    this.#publishTimer = setTimeout(() => {
      this.#publishTimer = null
      void this.#publish()
    }, delay)
    this.#publishTimer.unref?.()
  }

  async #publish(): Promise<void> {
    if (this.#disposed || !this.#settings.enabled) {
      return
    }
    if (!this.#settings.clientId) {
      this.#lastError = 'no Discord application id configured'
      return
    }
    const activity = buildActivity({
      state: this.#state,
      focus: this.#focus,
      privacy: this.#settings.privacy,
      startedAt: this.#busySince,
      assets: this.#settings.assets
    })
    // Why: identical payloads still cost a rate-limit slot, and a fleet can emit
    // many events that do not change what the status would say.
    const encoded = JSON.stringify(activity)
    if (encoded === this.#lastPayload) {
      return
    }

    const client = await this.#ensureClient()
    if (!client) {
      return
    }
    try {
      await client.setActivity(activity)
      this.#lastPayload = encoded
      this.#lastPublishAt = Date.now()
      this.#lastError = null
    } catch (error) {
      this.#lastError = describeError(error)
      this.#orca.log(`could not publish presence: ${this.#lastError}`)
    }
  }

  async #ensureClient(): Promise<DiscordPresenceClient | null> {
    if (this.#client?.connected) {
      return this.#client
    }
    if (this.#connecting || this.#disposed) {
      return null
    }
    this.#connecting = true
    const client = new DiscordPresenceClient({
      clientId: this.#settings.clientId,
      log: (line) => this.#orca.log(line)
    })
    client.onDisconnect = (error) => {
      this.#client = null
      this.#lastPayload = ''
      this.#lastError = describeError(error)
      this.#scheduleReconnect()
    }
    try {
      await client.connect()
      this.#client = client
      this.#reconnectAttempt = 0
      this.#lastError = null
      return client
    } catch (error) {
      this.#lastError = describeError(error)
      this.#orca.log(`discord unavailable: ${this.#lastError}`)
      this.#scheduleReconnect()
      return null
    } finally {
      this.#connecting = false
    }
  }

  #scheduleReconnect(): void {
    if (this.#disposed || this.#reconnectTimer || !this.#settings.enabled) {
      return
    }
    const index = Math.min(this.#reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    const delay = RECONNECT_DELAYS_MS[index] ?? RECONNECT_DELAYS_MS[0]
    this.#reconnectAttempt += 1
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      this.#schedulePublish()
    }, delay)
    this.#reconnectTimer.unref?.()
  }

  async toggleEnabled(): Promise<{ enabled: boolean }> {
    this.#settings.enabled = !this.#settings.enabled
    await this.#saveSetting('enabled', this.#settings.enabled)
    if (this.#settings.enabled) {
      this.#lastPayload = ''
      this.#schedulePublish()
    } else {
      await this.#clearPresence()
    }
    await this.#notify(
      'Discord Presence',
      this.#settings.enabled ? 'Presence enabled.' : 'Presence disabled.'
    )
    return { enabled: this.#settings.enabled }
  }

  async cyclePrivacy(): Promise<{ privacy: PrivacyLevel }> {
    this.#settings.privacy = nextPrivacy(this.#settings.privacy)
    await this.#saveSetting('privacy', this.#settings.privacy)
    this.#lastPayload = ''
    if (this.#settings.privacy === 'off') {
      await this.#clearPresence()
    } else {
      this.#schedulePublish()
    }
    await this.#notify('Discord Presence', `Privacy level: ${this.#settings.privacy}`)
    return { privacy: this.#settings.privacy }
  }

  async reportStatus(): Promise<PresenceStatusReport> {
    const summary = summarize(this.#state)
    const connection = this.#client?.connected
      ? `connected (${this.#client.socketPath})`
      : (this.#lastError ?? 'not connected')
    const body = [
      `${this.#settings.enabled ? 'Enabled' : 'Disabled'} · privacy: ${this.#settings.privacy}`,
      describeActivity(summary),
      connection
    ].join('\n')
    await this.#notify('Discord Presence', body)
    return {
      enabled: this.#settings.enabled,
      privacy: this.#settings.privacy,
      connected: Boolean(this.#client?.connected),
      socketPath: this.#client?.socketPath ?? null,
      usingDefaultApplication: this.#settings.clientId === DEFAULT_CLIENT_ID,
      summary,
      lastError: this.#lastError
    }
  }

  async #clearPresence(): Promise<void> {
    this.#lastPayload = ''
    if (!this.#client?.connected) {
      return
    }
    try {
      await this.#client.setActivity(null)
    } catch (error) {
      this.#orca.log(`could not clear presence: ${describeError(error)}`)
    }
  }

  async #notify(title: string, body: string): Promise<void> {
    try {
      await this.#orca.host.call('notifications.show', { title, body })
    } catch (error) {
      this.#orca.log(`${title}: ${body} (${describeError(error)})`)
    }
  }

  /** Graceful stop: drop the status first, then tear the connection down. */
  async shutdown(): Promise<void> {
    if (this.#disposed) {
      return
    }
    try {
      await this.#clearPresence()
    } catch {
      // Nothing actionable during teardown.
    }
    this.dispose()
  }

  dispose(): void {
    this.#disposed = true
    if (this.#publishTimer) {
      clearTimeout(this.#publishTimer)
    }
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
    }
    if (this.#focusTimer) {
      clearInterval(this.#focusTimer)
    }
    this.#publishTimer = null
    this.#reconnectTimer = null
    this.#focusTimer = null
    this.#client?.close()
    this.#client = null
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A configured id wins; anything blank or non-string falls back to the default. */
function readClientId(configured: unknown): string {
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim()
  }
  return DEFAULT_CLIENT_ID
}
