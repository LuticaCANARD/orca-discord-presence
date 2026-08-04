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
export {};
//# sourceMappingURL=orca-api.mjs.map