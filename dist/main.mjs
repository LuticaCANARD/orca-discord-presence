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
import { DiscordPresenceClient } from './lib/discord-ipc.mjs';
import { DEFAULT_PRIVACY, applyAgentStatus, applyWorktreeCreated, applyWorktreeRemoved, buildActivity, createPresenceState, deserializeState, describeActivity, isBusy, isPrivacyLevel, nextPrivacy, pruneStale, serializeState, summarize } from './lib/presence-model.mjs';
const STORAGE_KEY = 'presence-state';
const STORAGE_STARTED_AT_KEY = 'busy-since';
/** Coalesce bursts: a single agent transition can fan out several events. */
const PUBLISH_DEBOUNCE_MS = 1_500;
/** Discord throttles SET_ACTIVITY at roughly 5 calls / 15s; stay well under. */
const MIN_PUBLISH_INTERVAL_MS = 4_000;
const FOCUS_POLL_MS = 30_000;
const RECONNECT_DELAYS_MS = [15_000, 30_000, 60_000];
/**
 * Module-scoped because the host ignores whatever `activate` returns and calls
 * the `deactivate` export for teardown — there is nowhere else to hand the
 * runtime across.
 */
let activeRuntime = null;
export default function activate(orca) {
    activeRuntime?.dispose();
    const runtime = new PresenceRuntime(orca);
    activeRuntime = runtime;
    runtime.start();
    orca.commands.register('presence.toggle', () => runtime.toggleEnabled());
    orca.commands.register('presence.privacy', () => runtime.cyclePrivacy());
    orca.commands.register('presence.status', () => runtime.reportStatus());
    orca.events.on('worktree.created', (payload) => {
        runtime.onEvent((state) => applyWorktreeCreated(state, payload));
    });
    orca.events.on('worktree.removed', (payload) => {
        runtime.onEvent((state) => applyWorktreeRemoved(state, payload));
    });
    orca.events.on('agent.status.changed', (payload) => {
        runtime.onEvent((state) => applyAgentStatus(state, payload));
    });
}
export async function deactivate() {
    const runtime = activeRuntime;
    activeRuntime = null;
    // Clear the status on the way out: a stale "3 agents working" left sitting on
    // a profile after Orca quits is worse than no presence at all.
    await runtime?.shutdown();
}
class PresenceRuntime {
    #orca;
    #granted;
    #state = createPresenceState();
    #settings = {
        enabled: true,
        privacy: DEFAULT_PRIVACY,
        clientId: '',
        assets: { largeImage: '', largeText: '' }
    };
    #client = null;
    #connecting = false;
    #reconnectAttempt = 0;
    #busySince = 0;
    #lastPublishAt = 0;
    #lastPayload = '';
    #focus = null;
    #publishTimer = null;
    #reconnectTimer = null;
    #focusTimer = null;
    #disposed = false;
    #lastError = null;
    constructor(orca) {
        this.#orca = orca;
        // Consent is granted per manifest, but a host that narrows a grant should
        // cost us a skipped call, not a failing one every 30 seconds.
        this.#granted = new Set(orca.grantedCapabilities ?? []);
    }
    start() {
        void this.#bootstrap();
        this.#focusTimer = setInterval(() => void this.#refreshFocus(), FOCUS_POLL_MS);
        this.#focusTimer.unref?.();
    }
    async #bootstrap() {
        await this.#loadSettings();
        await this.#loadState();
        await this.#refreshFocus();
        this.#schedulePublish();
    }
    #can(capability) {
        return this.#granted.size === 0 || this.#granted.has(capability);
    }
    async #loadSettings() {
        try {
            const result = await this.#orca.host.call('settings.get');
            const stored = result.settings ?? {};
            this.#settings = {
                enabled: stored['enabled'] !== false,
                privacy: isPrivacyLevel(stored['privacy']) ? stored['privacy'] : DEFAULT_PRIVACY,
                clientId: typeof stored['clientId'] === 'string' ? stored['clientId'].trim() : '',
                assets: {
                    largeImage: typeof stored['largeImage'] === 'string' ? stored['largeImage'] : '',
                    largeText: typeof stored['largeText'] === 'string' ? stored['largeText'] : ''
                }
            };
        }
        catch (error) {
            this.#orca.log(`settings unavailable, using defaults: ${describeError(error)}`);
        }
    }
    async #saveSetting(key, value) {
        try {
            await this.#orca.host.call('settings.set', { key, value });
        }
        catch (error) {
            this.#orca.log(`could not persist ${key}: ${describeError(error)}`);
        }
    }
    async #loadState() {
        try {
            const stored = await this.#orca.host.call('storage.get', { key: STORAGE_KEY });
            this.#state = pruneStale(deserializeState(stored.value), Date.now());
            const since = await this.#orca.host.call('storage.get', { key: STORAGE_STARTED_AT_KEY });
            this.#busySince = typeof since.value === 'number' ? since.value : 0;
        }
        catch (error) {
            this.#orca.log(`could not restore state: ${describeError(error)}`);
        }
    }
    async #persistState() {
        try {
            await this.#orca.host.call('storage.set', {
                key: STORAGE_KEY,
                value: serializeState(this.#state)
            });
        }
        catch (error) {
            this.#orca.log(`could not persist state: ${describeError(error)}`);
        }
    }
    async #refreshFocus() {
        if (this.#disposed || !this.#can('workspace:read')) {
            return;
        }
        try {
            this.#focus = await this.#orca.host.call('workspace.readContext');
        }
        catch (error) {
            // Non-fatal: without focus context the presence falls back to counts only.
            this.#orca.log(`workspace context unavailable: ${describeError(error)}`);
            this.#focus = null;
        }
    }
    /** Applies a state mutation, then persists and republishes. */
    onEvent(mutate) {
        if (this.#disposed) {
            return;
        }
        try {
            mutate(this.#state);
        }
        catch (error) {
            this.#orca.log(`event ignored: ${describeError(error)}`);
            return;
        }
        pruneStale(this.#state, Date.now());
        this.#trackBusyWindow();
        void this.#persistState();
        this.#schedulePublish();
    }
    /**
     * Discord's elapsed timer should measure the current stretch of work, so the
     * start stamp is set when the fleet goes idle→busy and cleared on the way back.
     */
    #trackBusyWindow() {
        const busy = isBusy(summarize(this.#state));
        if (busy && this.#busySince === 0) {
            this.#busySince = Date.now();
            void this.#orca.host
                .call('storage.set', { key: STORAGE_STARTED_AT_KEY, value: this.#busySince })
                .catch(() => { });
        }
        else if (!busy && this.#busySince !== 0) {
            this.#busySince = 0;
            void this.#orca.host.call('storage.delete', { key: STORAGE_STARTED_AT_KEY }).catch(() => { });
        }
    }
    #schedulePublish() {
        if (this.#disposed || this.#publishTimer) {
            return;
        }
        const sinceLast = Date.now() - this.#lastPublishAt;
        const delay = Math.max(PUBLISH_DEBOUNCE_MS, MIN_PUBLISH_INTERVAL_MS - sinceLast);
        this.#publishTimer = setTimeout(() => {
            this.#publishTimer = null;
            void this.#publish();
        }, delay);
        this.#publishTimer.unref?.();
    }
    async #publish() {
        if (this.#disposed || !this.#settings.enabled) {
            return;
        }
        if (!this.#settings.clientId) {
            this.#lastError = 'no Discord application id configured';
            return;
        }
        const activity = buildActivity({
            state: this.#state,
            focus: this.#focus,
            privacy: this.#settings.privacy,
            startedAt: this.#busySince,
            assets: this.#settings.assets
        });
        // Why: identical payloads still cost a rate-limit slot, and a fleet can emit
        // many events that do not change what the status would say.
        const encoded = JSON.stringify(activity);
        if (encoded === this.#lastPayload) {
            return;
        }
        const client = await this.#ensureClient();
        if (!client) {
            return;
        }
        try {
            await client.setActivity(activity);
            this.#lastPayload = encoded;
            this.#lastPublishAt = Date.now();
            this.#lastError = null;
        }
        catch (error) {
            this.#lastError = describeError(error);
            this.#orca.log(`could not publish presence: ${this.#lastError}`);
        }
    }
    async #ensureClient() {
        if (this.#client?.connected) {
            return this.#client;
        }
        if (this.#connecting || this.#disposed) {
            return null;
        }
        this.#connecting = true;
        const client = new DiscordPresenceClient({
            clientId: this.#settings.clientId,
            log: (line) => this.#orca.log(line)
        });
        client.onDisconnect = (error) => {
            this.#client = null;
            this.#lastPayload = '';
            this.#lastError = describeError(error);
            this.#scheduleReconnect();
        };
        try {
            await client.connect();
            this.#client = client;
            this.#reconnectAttempt = 0;
            this.#lastError = null;
            return client;
        }
        catch (error) {
            this.#lastError = describeError(error);
            this.#orca.log(`discord unavailable: ${this.#lastError}`);
            this.#scheduleReconnect();
            return null;
        }
        finally {
            this.#connecting = false;
        }
    }
    #scheduleReconnect() {
        if (this.#disposed || this.#reconnectTimer || !this.#settings.enabled) {
            return;
        }
        const index = Math.min(this.#reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
        const delay = RECONNECT_DELAYS_MS[index] ?? RECONNECT_DELAYS_MS[0];
        this.#reconnectAttempt += 1;
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            this.#schedulePublish();
        }, delay);
        this.#reconnectTimer.unref?.();
    }
    async toggleEnabled() {
        this.#settings.enabled = !this.#settings.enabled;
        await this.#saveSetting('enabled', this.#settings.enabled);
        if (this.#settings.enabled) {
            this.#lastPayload = '';
            this.#schedulePublish();
        }
        else {
            await this.#clearPresence();
        }
        await this.#notify('Discord Presence', this.#settings.enabled ? 'Presence enabled.' : 'Presence disabled.');
        return { enabled: this.#settings.enabled };
    }
    async cyclePrivacy() {
        this.#settings.privacy = nextPrivacy(this.#settings.privacy);
        await this.#saveSetting('privacy', this.#settings.privacy);
        this.#lastPayload = '';
        if (this.#settings.privacy === 'off') {
            await this.#clearPresence();
        }
        else {
            this.#schedulePublish();
        }
        await this.#notify('Discord Presence', `Privacy level: ${this.#settings.privacy}`);
        return { privacy: this.#settings.privacy };
    }
    async reportStatus() {
        const summary = summarize(this.#state);
        const connection = this.#client?.connected
            ? `connected (${this.#client.socketPath})`
            : (this.#lastError ?? 'not connected');
        const body = [
            `${this.#settings.enabled ? 'Enabled' : 'Disabled'} · privacy: ${this.#settings.privacy}`,
            describeActivity(summary),
            connection
        ].join('\n');
        await this.#notify('Discord Presence', body);
        return {
            enabled: this.#settings.enabled,
            privacy: this.#settings.privacy,
            connected: Boolean(this.#client?.connected),
            socketPath: this.#client?.socketPath ?? null,
            summary,
            lastError: this.#lastError
        };
    }
    async #clearPresence() {
        this.#lastPayload = '';
        if (!this.#client?.connected) {
            return;
        }
        try {
            await this.#client.setActivity(null);
        }
        catch (error) {
            this.#orca.log(`could not clear presence: ${describeError(error)}`);
        }
    }
    async #notify(title, body) {
        try {
            await this.#orca.host.call('notifications.show', { title, body });
        }
        catch (error) {
            this.#orca.log(`${title}: ${body} (${describeError(error)})`);
        }
    }
    /** Graceful stop: drop the status first, then tear the connection down. */
    async shutdown() {
        if (this.#disposed) {
            return;
        }
        try {
            await this.#clearPresence();
        }
        catch {
            // Nothing actionable during teardown.
        }
        this.dispose();
    }
    dispose() {
        this.#disposed = true;
        if (this.#publishTimer) {
            clearTimeout(this.#publishTimer);
        }
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
        }
        if (this.#focusTimer) {
            clearInterval(this.#focusTimer);
        }
        this.#publishTimer = null;
        this.#reconnectTimer = null;
        this.#focusTimer = null;
        this.#client?.close();
        this.#client = null;
    }
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=main.mjs.map