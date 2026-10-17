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
import type { AgentStatusState, AgentTurnOutcome, WorkspaceContext } from './orca-api.mjs';
/** Orca's agent states, from `AGENT_STATUS_STATES` in the host. */
export declare const AGENT_STATES: readonly AgentStatusState[];
/** `AGENT_TURN_OUTCOMES`. An outcome outside this set is treated as unknown. */
export declare const TURN_OUTCOMES: readonly AgentTurnOutcome[];
export declare const PRIVACY_LEVELS: readonly ['full', 'minimal', 'off'];
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];
/**
 * Default is `minimal`, not `full`. Branch names routinely carry ticket ids and
 * client names, and a status that silently published them the moment the plugin
 * was enabled would be a bad default even though it is the more interesting one.
 */
export declare const DEFAULT_PRIVACY: PrivacyLevel;
/**
 * Leading segment of the details line — the closest thing to a card "header"
 * this plugin controls. Discord renders the application's own name above it and
 * that name cannot be set over IPC, so the header lives in `details` instead.
 * Set the setting to `""` to drop the segment entirely.
 */
export declare const DEFAULT_HEADER = "Orca";
/**
 * What the **Set Header** command cycles through when the host hands it no
 * argument. Ends on `''` — hiding the header entirely is a real choice, and a
 * cycle that cannot reach it would force a trip to the settings file.
 */
export declare const HEADER_PRESETS: readonly string[];
/**
 * Art asset keys from the Discord application's *Rich Presence → Art Assets*
 * tab. `orca` is the logo uploaded to the shipped application; pointing
 * `clientId` at your own application means uploading artwork under these keys
 * (or naming your own via `largeImage` / `largeText`).
 */
export declare const DEFAULT_LARGE_IMAGE = "orca";
export declare const DEFAULT_LARGE_TEXT = "Orca";
/**
 * Pane statuses older than this are dropped. The worker is reaped after 5
 * minutes idle and rehydrates from storage on the next event, so without a TTL
 * a fleet that was busy yesterday would still read as busy today.
 */
export declare const STALE_STATUS_MS: number;
/**
 * How long a turn that ended badly keeps counting. Done panes live for
 * `STALE_STATUS_MS`, which is far too long for "something just failed" — a
 * failure from this morning is history, not status.
 */
export declare const RECENT_FAILURE_MS: number;
/**
 * Window around now in which a host-stamped `stateStartedAt` is believed.
 *
 * The stamp comes from the machine the agent runs on, which for an SSH host is
 * not this one, so a skewed clock could otherwise anchor Discord's timer in the
 * future or days back. Outside these bounds the locally observed idle→busy
 * moment is used instead.
 */
export declare const START_STAMP_MAX_AGE_MS: number;
export declare const START_STAMP_MAX_SKEW_MS: number;
export type WorktreeRecord = {
    path: string;
    branch: string;
};
/**
 * One pane's last known status. `state` is Orca's *combined* state — `working`
 * covers a live subagent whose main agent has already settled — so the main
 * agent's own facts are kept beside it rather than folded in.
 */
export type PaneRecord = {
    worktreeId: string | null;
    state: AgentStatusState;
    receivedAt: number;
    /** The main agent's own state; absent on hosts that do not report it. */
    mainState?: AgentStatusState;
    /** Verdict on the main agent's last finished turn; absent means unknown. */
    outcome?: AgentTurnOutcome;
    /** Host-stamped start of the main agent's own state, in ms. */
    startedAt?: number;
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
    /** Ids of the worktrees with a working agent, sorted so payloads stay stable. */
    activeWorktreeIds: string[];
    /**
     * Panes that read `working` only because a subagent outlived the main agent.
     * A subset of `working`, never added to it: the pane is still busy, but no
     * main agent is driving it any more.
     */
    wrappingUp: number;
    /** Main agents whose last turn failed or died, within `RECENT_FAILURE_MS`. */
    recentFailures: number;
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
export declare function summarize(state: PresenceState, now?: number): PresenceSummary;
/**
 * When the fleet's current stretch of work began, for Discord's elapsed timer.
 *
 * Prefers the host's own `stateStartedAt` over `fallback`, the moment this
 * plugin first *noticed* the fleet go busy, because the two differ exactly when
 * it matters: the worker is re-forked after an idle reap, or the plugin was
 * enabled while agents were already running. Only panes whose main agent is
 * itself busy count — a pane held open by a subagent has a stamp that dates the
 * main agent's `done`, which is not when the work started.
 *
 * Returns `fallback` when no stamp is usable, so an older host behaves exactly
 * as before.
 */
export declare function busyAnchor(state: PresenceState, fallback: number, now?: number): number;
/**
 * Names of the workspaces (worktrees) that currently have a working agent.
 *
 * Only worktrees seen through `worktree.created` can be named — one that
 * existed before the plugin was installed is known by id alone, so the list
 * comes back short and `describeActivity` falls back to counting.
 */
export declare function describeWorkspaces(state: PresenceState, summary?: PresenceSummary): string[];
/**
 * The status line. Ordered by what a reader would want to know first: agents
 * that need a human come before agents that do not.
 *
 * `blocked` and `waiting` are separate segments even though Orca renders both
 * as its `permission` status — the distinction is free here and tells a reader
 * whether the fleet is stuck or merely asking. `wrapping up` is the tail of a
 * pane whose main agent has settled while a subagent still runs.
 *
 * Turns that ended badly are deliberately absent: a failure count on a public
 * profile would be noise minutes after it stopped being news, and **Show
 * Connection Status** reports it where it is actionable.
 *
 * `workspaces` names the worktrees the working agents sit in. It is passed only
 * at `full` privacy — at `minimal` the trailing segment stays a bare count, so
 * the shape of the fleet still shows without leaking what it is working on.
 */
export declare function describeActivity(summary: PresenceSummary, workspaces?: readonly string[]): string;
/**
 * Project label from whatever the host gave us. `workspace.readContext` returns
 * a display name for the focused worktree; a worktree seen only through
 * `worktree.created` has just a path, whose basename is the best available name.
 */
export declare function describeProject(focus: WorkspaceContext, state: PresenceState): string;
export type HeaderContext = {
    focus: WorkspaceContext;
    state: PresenceState;
    privacy: PrivacyLevel;
};
/**
 * Expands a header template. `{workspace}` and `{branch}` resolve only at
 * `full`; at `minimal` they blank out, and a template left with nothing but
 * blanks falls back to the default name rather than publishing an empty line.
 *
 * Segments are split on `·` so that a token dropping out takes its separator
 * with it — `{workspace} · {branch}` reads as `Orca`, never as `· `.
 */
export declare function renderHeader(template: string, { focus, state, privacy }: HeaderContext): string;
/**
 * Next template in the cycle. A header the user typed by hand is not in the
 * list, so cycling from it starts the presets over from the top.
 */
export declare function nextHeader(current: string): string;
export type PresenceAssets = {
    largeImage?: string | undefined;
    largeText?: string | undefined;
    /** Badge in the corner of the logo. Off by default: the shipped application
     *  hosts no artwork under any other key, so a default would render blank. */
    smallImage?: string | undefined;
    smallText?: string | undefined;
};
export type BuildActivityInput = {
    state: PresenceState;
    focus: WorkspaceContext;
    privacy: PrivacyLevel;
    startedAt?: number;
    /** Leading segment of the details line; `undefined` takes `DEFAULT_HEADER`. */
    header?: string | undefined;
    assets?: PresenceAssets | undefined;
    /** Opaque party id; omitted, Discord may not render the party size at all. */
    partyId?: string | undefined;
};
/**
 * Builds the payload handed to SET_ACTIVITY. Returns `null` when nothing should
 * be published — the caller clears the status rather than sending an empty one.
 *
 * The card reads top to bottom as:
 *
 *   Orca · my-app · feat/ipc      ← details: header, workspace, branch
 *   2 agents working · in my-app  ← state: fleet summary, workspaces at `full`
 *
 * `startedAt` drives Discord's elapsed timer; it is the moment the fleet last
 * went from idle to busy, not process start, so the timer reads as "how long
 * this batch of work has been running".
 */
export declare function buildActivity({ state, focus, privacy, startedAt, header, assets, partyId }: BuildActivityInput): DiscordActivity | null;
export declare function isPrivacyLevel(value: unknown): value is PrivacyLevel;
export declare function nextPrivacy(current: PrivacyLevel): PrivacyLevel;
/**
 * True when the fleet has any agent that is not finished.
 *
 * `waiting` counts: Orca maps both `blocked` and `waiting` onto its
 * `permission` status — "agent needs user attention" — so a fleet sitting on a
 * permission prompt is not idle, and the elapsed timer should keep running.
 */
export declare function isBusy(summary: PresenceSummary): boolean;
/** Agents the fleet still owes work on — the `current` half of the party size. */
export declare function busyCount(summary: PresenceSummary): number;
