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
import { basename } from 'node:path';
/** Orca's agent states, from `AGENT_STATUS_STATES` in the host. */
export const AGENT_STATES = ['working', 'blocked', 'waiting', 'done'];
export const PRIVACY_LEVELS = ['full', 'minimal', 'off'];
/**
 * Default is `minimal`, not `full`. Branch names routinely carry ticket ids and
 * client names, and a status that silently published them the moment the plugin
 * was enabled would be a bad default even though it is the more interesting one.
 */
export const DEFAULT_PRIVACY = 'minimal';
/** Discord rejects a details/state string shorter than 2 or longer than 128. */
const FIELD_MIN = 2;
const FIELD_MAX = 128;
/**
 * Pane statuses older than this are dropped. The worker is reaped after 5
 * minutes idle and rehydrates from storage on the next event, so without a TTL
 * a fleet that was busy yesterday would still read as busy today.
 */
export const STALE_STATUS_MS = 6 * 60 * 60 * 1000;
export function createPresenceState() {
    return { worktrees: new Map(), panes: new Map() };
}
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : null;
}
function asString(value) {
    return typeof value === 'string' ? value : '';
}
function isAgentState(value) {
    return typeof value === 'string' && AGENT_STATES.includes(value);
}
export function applyWorktreeCreated(state, payload) {
    const record = asRecord(payload);
    const worktreeId = asString(record?.['worktreeId']);
    if (!worktreeId) {
        return state;
    }
    state.worktrees.set(worktreeId, {
        path: asString(record?.['path']),
        branch: asString(record?.['branch'])
    });
    return state;
}
export function applyWorktreeRemoved(state, payload) {
    const record = asRecord(payload);
    const worktreeId = asString(record?.['worktreeId']);
    if (!worktreeId) {
        return state;
    }
    state.worktrees.delete(worktreeId);
    for (const [paneKey, pane] of state.panes) {
        if (pane.worktreeId === worktreeId) {
            state.panes.delete(paneKey);
        }
    }
    return state;
}
export function applyAgentStatus(state, payload) {
    const record = asRecord(payload);
    const paneKey = asString(record?.['paneKey']);
    const agentState = record?.['state'];
    if (!paneKey || !isAgentState(agentState)) {
        return state;
    }
    const worktreeId = record?.['worktreeId'];
    const receivedAt = record?.['receivedAt'];
    state.panes.set(paneKey, {
        worktreeId: typeof worktreeId === 'string' ? worktreeId : null,
        state: agentState,
        receivedAt: typeof receivedAt === 'number' ? receivedAt : 0
    });
    return state;
}
export function pruneStale(state, now) {
    for (const [paneKey, pane] of state.panes) {
        if (now - pane.receivedAt > STALE_STATUS_MS) {
            state.panes.delete(paneKey);
        }
    }
    return state;
}
/** Storage holds JSON, so Maps round-trip through plain objects. */
export function serializeState(state) {
    return {
        worktrees: Object.fromEntries(state.worktrees),
        panes: Object.fromEntries(state.panes)
    };
}
export function deserializeState(raw) {
    const state = createPresenceState();
    const root = asRecord(raw);
    if (!root) {
        return state;
    }
    for (const [id, value] of Object.entries(asRecord(root['worktrees']) ?? {})) {
        const record = asRecord(value);
        if (record) {
            state.worktrees.set(id, { path: asString(record['path']), branch: asString(record['branch']) });
        }
    }
    for (const [paneKey, value] of Object.entries(asRecord(root['panes']) ?? {})) {
        const record = asRecord(value);
        if (record && isAgentState(record['state'])) {
            const worktreeId = record['worktreeId'];
            const receivedAt = record['receivedAt'];
            state.panes.set(paneKey, {
                worktreeId: typeof worktreeId === 'string' ? worktreeId : null,
                state: record['state'],
                receivedAt: typeof receivedAt === 'number' ? receivedAt : 0
            });
        }
    }
    return state;
}
export function summarize(state) {
    const counts = { working: 0, blocked: 0, waiting: 0, done: 0 };
    const activeWorktrees = new Set();
    for (const pane of state.panes.values()) {
        counts[pane.state] += 1;
        if (pane.state === 'working' && pane.worktreeId) {
            activeWorktrees.add(pane.worktreeId);
        }
    }
    return {
        ...counts,
        panes: state.panes.size,
        worktrees: state.worktrees.size,
        activeWorktrees: activeWorktrees.size
    };
}
function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
/**
 * The status line. Ordered by what a reader would want to know first: blocked
 * agents need a human, working agents do not.
 */
export function describeActivity(summary) {
    const parts = [];
    if (summary.working > 0) {
        parts.push(`${plural(summary.working, 'agent')} working`);
    }
    if (summary.blocked > 0) {
        parts.push(`${summary.blocked} blocked`);
    }
    if (parts.length === 0) {
        return summary.panes > 0 ? 'Fleet idle' : 'No agents running';
    }
    if (summary.working > 0 && summary.activeWorktrees > 1) {
        parts.push(`across ${plural(summary.activeWorktrees, 'worktree')}`);
    }
    return parts.join(' · ');
}
/**
 * Project label from whatever the host gave us. `workspace.readContext` returns
 * a display name for the focused worktree; a worktree seen only through
 * `worktree.created` has just a path, whose basename is the best available name.
 */
export function describeProject(focus, state) {
    const displayName = focus?.displayName.trim();
    if (displayName) {
        return displayName;
    }
    const branch = focus?.branch.trim();
    for (const worktree of state.worktrees.values()) {
        if (branch && worktree.branch === branch && worktree.path) {
            return basename(worktree.path);
        }
    }
    const [first] = state.worktrees.values();
    return first?.path ? basename(first.path) : '';
}
function clampField(value) {
    const trimmed = value.trim();
    if (trimmed.length < FIELD_MIN) {
        return undefined;
    }
    return trimmed.length > FIELD_MAX ? `${trimmed.slice(0, FIELD_MAX - 1)}…` : trimmed;
}
/**
 * Builds the payload handed to SET_ACTIVITY. Returns `null` when nothing should
 * be published — the caller clears the status rather than sending an empty one.
 *
 * `startedAt` drives Discord's elapsed timer; it is the moment the fleet last
 * went from idle to busy, not process start, so the timer reads as "how long
 * this batch of work has been running".
 */
export function buildActivity({ state, focus, privacy, startedAt, assets }) {
    if (privacy === 'off') {
        return null;
    }
    const summary = summarize(state);
    const activity = {};
    if (privacy === 'full') {
        const project = describeProject(focus, state);
        const branch = focus?.branch.trim() ?? '';
        const details = project && branch ? `${project} · ${branch}` : project || branch;
        activity.details = clampField(details) ?? clampField('Working in Orca');
    }
    else {
        // `minimal`: the fleet's shape is not sensitive, its names are.
        activity.details = clampField('Working in Orca');
    }
    activity.state = clampField(describeActivity(summary));
    if (typeof startedAt === 'number' && startedAt > 0) {
        activity.timestamps = { start: Math.floor(startedAt) };
    }
    if (assets?.largeImage) {
        activity.assets = { large_image: assets.largeImage };
        if (assets.largeText) {
            activity.assets.large_text = clampField(assets.largeText);
        }
    }
    activity.instance = false;
    return activity;
}
export function isPrivacyLevel(value) {
    return typeof value === 'string' && PRIVACY_LEVELS.includes(value);
}
export function nextPrivacy(current) {
    const index = PRIVACY_LEVELS.indexOf(current);
    return PRIVACY_LEVELS[(index + 1) % PRIVACY_LEVELS.length];
}
/** True when the fleet has any agent that is not finished. */
export function isBusy(summary) {
    return summary.working > 0 || summary.blocked > 0;
}
//# sourceMappingURL=presence-model.mjs.map