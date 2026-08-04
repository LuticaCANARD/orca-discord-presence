/**
 * Discord Rich Presence socket discovery.
 *
 * Discord listens on a local IPC endpoint named `discord-ipc-<n>`, where `n`
 * counts up from 0 for each concurrently running client. Where that endpoint
 * lives depends on the platform and on how Discord was packaged.
 *
 * The hard case is Linux under Orca. The plugin worker's environment is an
 * allowlist (see Orca's `plugin-worker-env.ts`) that deliberately omits
 * `XDG_RUNTIME_DIR` — the variable that normally points at `/run/user/<uid>`,
 * where the socket actually is. So we reconstruct that path from the uid
 * instead of trusting the environment to carry it.
 */
/** Discord numbers sockets 0..9; beyond that it stops accepting clients. */
export declare const IPC_INDEX_LIMIT = 10;
export type SocketProbeOptions = {
    platform: NodeJS.Platform | string;
    env?: NodeJS.ProcessEnv;
    uid?: number | undefined;
};
/**
 * Runtime directories to scan on macOS and Linux, most specific first.
 * `uid` is optional so callers on platforms without uids (and tests) can omit it.
 */
export declare function posixRuntimeBases({ env, uid }: {
    env?: NodeJS.ProcessEnv;
    uid?: number | undefined;
}): string[];
/**
 * Every path worth trying, in probe order. Windows named pipes need no
 * directory search — the pipe namespace is flat and global.
 */
export declare function candidateSocketPaths({ platform, env, uid }: SocketProbeOptions): string[];
/**
 * Narrow the candidate list to paths that exist. Windows is returned unfiltered:
 * `existsSync` does not report named pipes reliably, so there the connect
 * attempt itself is the existence check.
 */
export declare function probeSocketPaths({ platform, env, uid, exists }: SocketProbeOptions & {
    exists?: (path: string) => boolean;
}): string[];
