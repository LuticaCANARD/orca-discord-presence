/**
 * Minimal Discord Rich Presence IPC client.
 *
 * Deliberately dependency-free: Orca installs plugins as plain directories with
 * no install step, so a `node_modules` tree would have to be vendored into the
 * repo. The protocol is small enough that talking to it directly is less code
 * than vendoring `discord-rpc` would be.
 *
 * Wire format is an 8-byte little-endian header (opcode, payload length)
 * followed by a UTF-8 JSON payload.
 */
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { probeSocketPaths } from './socket-path.mjs';
export const OP = {
    HANDSHAKE: 0,
    FRAME: 1,
    CLOSE: 2,
    PING: 3,
    PONG: 4
};
const HEADER_BYTES = 8;
/** Defensive cap: a well-behaved Discord never sends frames near this size. */
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;
const READY_TIMEOUT_MS = 10_000;
export function encodeFrame(op, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length);
    frame.writeInt32LE(op, 0);
    frame.writeInt32LE(body.length, 4);
    body.copy(frame, HEADER_BYTES);
    return frame;
}
/**
 * Streaming frame decoder. Returns a `push(chunk)` that yields whole frames and
 * keeps the remainder buffered — a socket read can split or coalesce frames
 * arbitrarily, so neither "one chunk is one frame" nor "one frame per read"
 * holds.
 */
export function createFrameDecoder() {
    let buffered = Buffer.alloc(0);
    return function push(chunk) {
        buffered = Buffer.concat([buffered, chunk]);
        const frames = [];
        while (buffered.length >= HEADER_BYTES) {
            const op = buffered.readInt32LE(0);
            const length = buffered.readInt32LE(4);
            if (length < 0 || length > MAX_PAYLOAD_BYTES) {
                throw new Error(`discord ipc: refusing frame with length ${length}`);
            }
            if (buffered.length < HEADER_BYTES + length) {
                break;
            }
            const body = buffered.subarray(HEADER_BYTES, HEADER_BYTES + length);
            buffered = buffered.subarray(HEADER_BYTES + length);
            let data;
            try {
                data = JSON.parse(body.toString('utf8'));
            }
            catch {
                throw new Error('discord ipc: frame payload was not JSON');
            }
            frames.push({ op, data });
        }
        return frames;
    };
}
function connectToPath(path) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ path });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`discord ipc: connect timed out on ${path}`));
        }, CONNECT_TIMEOUT_MS);
        const fail = (error) => {
            clearTimeout(timer);
            socket.destroy();
            reject(error);
        };
        socket.once('error', fail);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.removeListener('error', fail);
            resolve(socket);
        });
    });
}
/**
 * Connects, handshakes, and keeps one activity published.
 *
 * The client owns no retry policy of its own — the caller drives reconnection,
 * because in Orca the worker itself may be reaped at any time and a retry loop
 * that outlives its owner is worse than no retry loop.
 */
export class DiscordPresenceClient {
    clientId;
    connected = false;
    socketPath = null;
    onDisconnect = null;
    #log;
    #platform;
    #env;
    #pending = new Map();
    #socket = null;
    constructor({ clientId, log = () => { }, platform = process.platform, env = process.env }) {
        this.clientId = clientId;
        this.#log = log;
        this.#platform = platform;
        this.#env = env;
    }
    /** Tries every candidate path until one completes a handshake. */
    async connect() {
        const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
        const candidates = probeSocketPaths({ platform: this.#platform, env: this.#env, uid });
        if (candidates.length === 0) {
            throw new Error('discord ipc: no candidate socket found — is Discord running?');
        }
        let lastError = null;
        for (const path of candidates) {
            try {
                const socket = await connectToPath(path);
                await this.#handshake(socket);
                this.#socket = socket;
                this.socketPath = path;
                this.connected = true;
                this.#log(`connected to ${path}`);
                return path;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            }
        }
        throw lastError ?? new Error('discord ipc: every candidate socket refused');
    }
    #handshake(socket) {
        return new Promise((resolve, reject) => {
            const decode = createFrameDecoder();
            const timer = setTimeout(() => {
                cleanup();
                socket.destroy();
                reject(new Error('discord ipc: handshake timed out'));
            }, READY_TIMEOUT_MS);
            const onData = (chunk) => {
                let frames;
                try {
                    frames = decode(chunk);
                }
                catch (error) {
                    cleanup();
                    socket.destroy();
                    reject(error instanceof Error ? error : new Error(String(error)));
                    return;
                }
                for (const frame of frames) {
                    if (frame.op === OP.CLOSE) {
                        cleanup();
                        socket.destroy();
                        reject(new Error(`discord ipc: closed during handshake (${frame.data.message ?? ''})`));
                        return;
                    }
                    if (frame.op === OP.FRAME && frame.data.evt === 'READY') {
                        cleanup();
                        this.#attach(socket);
                        resolve();
                        return;
                    }
                }
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            function cleanup() {
                clearTimeout(timer);
                socket.removeListener('data', onData);
                socket.removeListener('error', onError);
            }
            socket.on('data', onData);
            socket.once('error', onError);
            socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
        });
    }
    /** Wires the long-lived listeners once the handshake has succeeded. */
    #attach(socket) {
        const decode = createFrameDecoder();
        socket.on('data', (chunk) => {
            let frames;
            try {
                frames = decode(chunk);
            }
            catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                this.#log(`protocol error: ${failure.message}`);
                this.#teardown(failure);
                return;
            }
            for (const frame of frames) {
                this.#handleFrame(frame);
            }
        });
        socket.on('error', (error) => this.#teardown(error));
        socket.on('close', () => this.#teardown(new Error('discord ipc: socket closed')));
    }
    #handleFrame(frame) {
        if (frame.op === OP.PING) {
            this.#socket?.write(encodeFrame(OP.PONG, frame.data));
            return;
        }
        if (frame.op === OP.CLOSE) {
            this.#teardown(new Error(`discord ipc: server closed (${frame.data.message ?? ''})`));
            return;
        }
        if (frame.op !== OP.FRAME) {
            return;
        }
        const nonce = frame.data.nonce;
        const entry = nonce ? this.#pending.get(nonce) : undefined;
        if (!entry || !nonce) {
            return;
        }
        this.#pending.delete(nonce);
        clearTimeout(entry.timer);
        if (frame.data.evt === 'ERROR') {
            entry.reject(new Error(frame.data.data?.message ?? 'discord ipc: command rejected'));
        }
        else {
            entry.resolve(frame.data.data ?? null);
        }
    }
    #teardown(error) {
        if (!this.connected && !this.#socket) {
            return;
        }
        this.connected = false;
        const socket = this.#socket;
        this.#socket = null;
        for (const [nonce, entry] of this.#pending) {
            clearTimeout(entry.timer);
            entry.reject(error);
            this.#pending.delete(nonce);
        }
        socket?.destroy();
        this.onDisconnect?.(error);
    }
    #command(cmd, args) {
        const socket = this.#socket;
        if (!this.connected || !socket) {
            return Promise.reject(new Error('discord ipc: not connected'));
        }
        const nonce = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(nonce);
                reject(new Error(`discord ipc: ${cmd} timed out`));
            }, READY_TIMEOUT_MS);
            this.#pending.set(nonce, { resolve, reject, timer });
            socket.write(encodeFrame(OP.FRAME, { cmd, args, nonce }));
        });
    }
    /** `activity: null` clears the status without dropping the connection. */
    setActivity(activity) {
        return this.#command('SET_ACTIVITY', { pid: process.pid, activity: activity ?? undefined });
    }
    close() {
        const socket = this.#socket;
        this.connected = false;
        this.#socket = null;
        this.onDisconnect = null;
        for (const [nonce, entry] of this.#pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error('discord ipc: client closed'));
            this.#pending.delete(nonce);
        }
        if (socket) {
            try {
                socket.write(encodeFrame(OP.CLOSE, {}));
            }
            catch {
                // Socket already gone; destroying is all that is left to do.
            }
            socket.destroy();
        }
    }
}
//# sourceMappingURL=discord-ipc.mjs.map