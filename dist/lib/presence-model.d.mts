/**
 * Pure state model: Orca events in, a Discord activity payload out.
 *
 * Kept free of IPC and of the `orca` host API so the interesting parts — what
 * counts as "working", what leaks at each privacy level, how a payload degrades
 * when a field is missing — are testable without a Discord client or a running
 * Orca.
 *
 * Event payloads arrive as `unknown` even though the host validates them with
 * zod before delivery. The host's guarantee is worth trusting for shape, not
 * for this plugin's own storage round-trip, and one validation path is simpler
 * to reason about than two.
 */
import type { DiscordActivity } from './discord-ipc.mjs';
import type { AgentStatusState, WorkspaceContext } from './orca-api.mjs';
/** Orca's agent states, from `AGENT_STATUS_STATES` in the host. */
export declare const AGENT_STATES: readonly AgentStatusState[];
export declare const PRIVACY_LEVELS: readonly ['full', 'minimal', 'off'];
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];
/**
 * Default is `minimal`, not `full`. Branch names routinely carry ticket ids and
 * client names, and a status that silently published them the moment the plugin
 * was enabled would be a bad default even though it is the more interesting one.
 */
export declare const DEFAULT_PRIVACY: PrivacyLevel;
/**
 * Pane statuses older than this are dropped. The worker is reaped after 5
 * minutes idle and rehydrates from storage on the next event, so without a TTL
 * a fleet that was busy yesterday would still read as busy today.
 */
export declare const STALE_STATUS_MS: number;
export type WorktreeRecord = {
    path: string;
    branch: string;
};
export type PaneRecord = {
    worktreeId: string | null;
    state: AgentStatusState;
    receivedAt: number;
};
export type PresenceState = {
    worktrees: Map<string, WorktreeRecord>;
    panes: Map<string, PaneRecord>;
};
export type PresenceSummary = {
    working: number;
    blocked: number;
    waiting: number;
    done: number;
    panes: number;
    worktrees: number;
    activeWorktrees: number;
};
export declare function createPresenceState(): PresenceState;
export declare function applyWorktreeCreated(state: PresenceState, payload: unknown): PresenceState;
export declare function applyWorktreeRemoved(state: PresenceState, payload: unknown): PresenceState;
export declare function applyAgentStatus(state: PresenceState, payload: unknown): PresenceState;
export declare function pruneStale(state: PresenceState, now: number): PresenceState;
/** Storage holds JSON, so Maps round-trip through plain objects. */
export declare function serializeState(state: PresenceState): {
    worktrees: Record<string, WorktreeRecord>;
    panes: Record<string, PaneRecord>;
};
export declare function deserializeState(raw: unknown): PresenceState;
export declare function summarize(state: PresenceState): PresenceSummary;
/**
 * The status line. Ordered by what a reader would want to know first: blocked
 * agents need a human, working agents do not.
 */
export declare function describeActivity(summary: PresenceSummary): string;
/**
 * Project label from whatever the host gave us. `workspace.readContext` returns
 * a display name for the focused worktree; a worktree seen only through
 * `worktree.created` has just a path, whose basename is the best available name.
 */
export declare function describeProject(focus: WorkspaceContext, state: PresenceState): string;
export type BuildActivityInput = {
    state: PresenceState;
    focus: WorkspaceContext;
    privacy: PrivacyLevel;
    startedAt?: number;
    assets?: {
        largeImage?: string;
        largeText?: string;
    } | undefined;
};
/**
 * Builds the payload handed to SET_ACTIVITY. Returns `null` when nothing should
 * be published — the caller clears the status rather than sending an empty one.
 *
 * `startedAt` drives Discord's elapsed timer; it is the moment the fleet last
 * went from idle to busy, not process start, so the timer reads as "how long
 * this batch of work has been running".
 */
export declare function buildActivity({ state, focus, privacy, startedAt, assets }: BuildActivityInput): DiscordActivity | null;
export declare function isPrivacyLevel(value: unknown): value is PrivacyLevel;
export declare function nextPrivacy(current: PrivacyLevel): PrivacyLevel;
/** True when the fleet has any agent that is not finished. */
export declare function isBusy(summary: PresenceSummary): boolean;
