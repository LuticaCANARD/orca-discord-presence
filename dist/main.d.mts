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
import type { OrcaPluginApi } from './lib/orca-api.mjs';
import { type PresenceSummary, type PrivacyLevel } from './lib/presence-model.mjs';
export type PresenceStatusReport = {
    enabled: boolean;
    privacy: PrivacyLevel;
    connected: boolean;
    socketPath: string | null;
    summary: PresenceSummary;
    lastError: string | null;
};
export default function activate(orca: OrcaPluginApi): void;
export declare function deactivate(): Promise<void>;
