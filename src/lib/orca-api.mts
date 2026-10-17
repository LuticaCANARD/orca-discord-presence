/**
 * Type declarations for Orca's plugin worker API (`pluginApi: 1`).
 *
 * Orca ships no types package for plugin authors, so this file is a
 * hand-maintained transcription of the host's own contracts:
 *
 *   - `src/shared/plugins/plugin-host-api.ts`     — method params/results
 *   - `src/shared/plugins/plugin-events.ts`       — event payloads
 *   - `src/shared/plugins/plugin-capabilities.ts` — capability kinds
 *   - `src/shared/agent-status-types.ts`          — agent states
 *   - `src/main/plugins/plugin-host-runtime.ts`   — the `orca` object's shape
 *
 * The whole plugin API is marked EXPERIMENTAL upstream ("no compatibility
 * promises until pluginApi v1 freezes"), so treat a type error after an Orca
 * upgrade as a real signal rather than something to cast away.
 */

/** `PLUGIN_CAPABILITY_KINDS`. */
export type PluginCapabilityKind =
  | 'workspace:read'
  | 'terminal:send'
  | 'notifications:show'
  | 'storage'
  | 'secrets'
  | 'events:subscribe'
  | 'settings:own'

/** `AGENT_STATUS_STATES`. */
export type AgentStatusState = 'working' | 'blocked' | 'waiting' | 'done'

/**
 * `AGENT_TURN_OUTCOMES` — the verdict on a main agent's last finished turn.
 *
 * Absent means *unknown*, never success: a provider that omits its interrupt
 * flag would otherwise turn a cancelled turn into a false success. `failure` is
 * the provider's own error and `interruption` a death mid-turn the host proved;
 * `cancellation` is a stop somebody asked for, so it is not a fault.
 */
export type AgentTurnOutcome =
  | 'success'
  | 'failure'
  | 'cancellation'
  | 'superseded'
  | 'interruption'
  | 'unconfirmed'

/**
 * `AgentMainAgentStatus`, as projected into the event payload — the main
 * agent's *own* state, beside the row's combined one.
 */
export type MainAgentStatus = {
  state: AgentStatusState
  /** Present only while `state` is `done`; a new turn clears it. */
  outcome?: AgentTurnOutcome
  /**
   * Milliseconds, stamped on the host the agent runs on — an SSH host's own
   * clock, not this machine's — when the main agent's own state began. The
   * row's combined state has its own, later start while child work holds the
   * pane open.
   */
  stateStartedAt: number
}

export type WorktreeCreatedPayload = {
  worktreeId: string
  path: string
  branch: string
}

export type WorktreeRemovedPayload = {
  worktreeId: string
  path: string
}

export type AgentStatusChangedPayload = {
  worktreeId: string | null
  paneKey: string
  /**
   * The *combined* status, which is what the pane shows the user: `working`
   * while the main agent **or any live subagent** works. So a settled main
   * agent whose subagent is still running arrives here as `working`.
   */
  state: AgentStatusState
  receivedAt: number
  /**
   * The main agent's own state beside the combined one, so "the main agent is
   * still working" is distinguishable from "a subagent outlived it". Absent on
   * hosts that predate it and on rows carrying no main-agent fact (OSC titles,
   * launch seeds), where `state` is all there is.
   */
  mainAgent?: MainAgentStatus
}

/** `PLUGIN_EVENT_NAMES` — a closed set in v0. */
export type PluginEventMap = {
  'worktree.created': WorktreeCreatedPayload
  'worktree.removed': WorktreeRemovedPayload
  'agent.status.changed': AgentStatusChangedPayload
}

export type PluginEventName = keyof PluginEventMap

/**
 * Result of `workspace.readContext`. Nullable: there may be no focused
 * worktree, in which case the host returns null rather than an empty object.
 */
export type WorkspaceContext = {
  branch: string
  displayName: string
  terminals: Array<{ id: string }>
} | null

/** JSON is all that crosses the storage and settings boundary. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * `PLUGIN_HOST_API_V0`. `params: void` marks the methods whose parameters the
 * host schema declares optional — the call signature below then forbids
 * passing one at all, which keeps a typo from silently becoming an argument.
 */
export type HostCallMap = {
  'workspace.readContext': { params: void; result: WorkspaceContext }
  'terminal.sendText': {
    params: { terminalId: string; text: string; enter?: boolean }
    result: { accepted: boolean }
  }
  'notifications.show': {
    params: { title: string; body?: string }
    result: { delivered: boolean }
  }
  'storage.get': { params: { key: string }; result: { value: JsonValue | null } }
  'storage.set': { params: { key: string; value: JsonValue }; result: { ok: true } }
  'storage.delete': { params: { key: string }; result: { ok: true } }
  'storage.keys': { params: void; result: { keys: string[] } }
  'secrets.get': { params: { key: string }; result: { value: string | null } }
  'secrets.set': { params: { key: string; value: string }; result: { ok: true } }
  'secrets.delete': { params: { key: string }; result: { ok: true } }
  'settings.get': { params: void; result: { settings: Record<string, JsonValue> } }
  'settings.set': { params: { key: string; value: JsonValue }; result: { ok: true } }
  'events.subscribe': {
    params: { events: PluginEventName[] }
    result: { subscribed: PluginEventName[] }
  }
}

export type HostMethod = keyof HostCallMap

export interface OrcaHostApi {
  call<M extends HostMethod>(
    method: M,
    ...params: HostCallMap[M]['params'] extends void ? [] : [params: HostCallMap[M]['params']]
  ): Promise<HostCallMap[M]['result']>
}

export interface OrcaCommandsApi {
  register(commandId: string, handler: (args?: unknown) => unknown | Promise<unknown>): void
}

export interface OrcaEventsApi {
  on<E extends PluginEventName>(
    event: E,
    handler: (payload: PluginEventMap[E]) => unknown | Promise<unknown>
  ): void
}

/** The object handed to the default-exported `activate`. */
export interface OrcaPluginApi {
  commands: OrcaCommandsApi
  events: OrcaEventsApi
  host: OrcaHostApi
  grantedCapabilities: readonly PluginCapabilityKind[]
  log(message: string): void
}
