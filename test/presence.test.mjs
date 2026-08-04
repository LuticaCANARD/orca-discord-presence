import assert from 'node:assert/strict'
import test from 'node:test'

import { createFrameDecoder, encodeFrame, OP } from '../dist/lib/discord-ipc.mjs'
import { candidateSocketPaths, posixRuntimeBases } from '../dist/lib/socket-path.mjs'
import {
  applyAgentStatus,
  applyWorktreeCreated,
  applyWorktreeRemoved,
  buildActivity,
  createPresenceState,
  deserializeState,
  describeActivity,
  nextPrivacy,
  pruneStale,
  serializeState,
  STALE_STATUS_MS,
  summarize
} from '../dist/lib/presence-model.mjs'

test('encodeFrame writes an 8-byte little-endian header', () => {
  const frame = encodeFrame(OP.HANDSHAKE, { v: 1 })
  assert.equal(frame.readInt32LE(0), OP.HANDSHAKE)
  assert.equal(frame.readInt32LE(4), frame.length - 8)
  assert.deepEqual(JSON.parse(frame.subarray(8).toString('utf8')), { v: 1 })
})

test('decoder reassembles a frame split across chunks', () => {
  const decode = createFrameDecoder()
  const frame = encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY' })
  assert.deepEqual(decode(frame.subarray(0, 5)), [])
  assert.deepEqual(decode(frame.subarray(5, 11)), [])
  const done = decode(frame.subarray(11))
  assert.equal(done.length, 1)
  assert.equal(done[0].op, OP.FRAME)
  assert.deepEqual(done[0].data, { cmd: 'SET_ACTIVITY' })
})

test('decoder splits multiple frames coalesced into one chunk', () => {
  const decode = createFrameDecoder()
  const chunk = Buffer.concat([
    encodeFrame(OP.PING, { n: 1 }),
    encodeFrame(OP.FRAME, { evt: 'READY' })
  ])
  const frames = decode(chunk)
  assert.equal(frames.length, 2)
  assert.equal(frames[0].op, OP.PING)
  assert.equal(frames[1].data.evt, 'READY')
})

test('decoder rejects an implausible frame length instead of buffering forever', () => {
  const decode = createFrameDecoder()
  const bogus = Buffer.alloc(8)
  bogus.writeInt32LE(OP.FRAME, 0)
  bogus.writeInt32LE(64 * 1024 * 1024, 4)
  assert.throws(() => decode(bogus), /refusing frame/)
})

test('linux runtime bases include the uid path even without XDG_RUNTIME_DIR', () => {
  const bases = posixRuntimeBases({ env: { TMPDIR: '/tmp' }, uid: 1000 })
  assert.ok(bases.includes('/run/user/1000'), `missing uid base: ${bases.join(', ')}`)
})

test('candidate paths cover flatpak and snap layouts', () => {
  const paths = candidateSocketPaths({ platform: 'linux', env: {}, uid: 1000 })
  assert.ok(paths.includes('/run/user/1000/discord-ipc-0'))
  assert.ok(paths.includes('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0'))
  assert.ok(paths.includes('/run/user/1000/snap.discord/discord-ipc-0'))
})

test('windows candidates are named pipes', () => {
  const paths = candidateSocketPaths({ platform: 'win32' })
  assert.equal(paths.length, 10)
  assert.equal(paths[0], '\\\\?\\pipe\\discord-ipc-0')
})

test('summarize counts panes by state and distinct busy worktrees', () => {
  const state = createPresenceState()
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  applyAgentStatus(state, { paneKey: 'b', worktreeId: 'w2', state: 'working', receivedAt: 1 })
  applyAgentStatus(state, { paneKey: 'c', worktreeId: 'w2', state: 'blocked', receivedAt: 1 })
  applyAgentStatus(state, { paneKey: 'd', worktreeId: null, state: 'done', receivedAt: 1 })
  const summary = summarize(state)
  assert.equal(summary.working, 2)
  assert.equal(summary.blocked, 1)
  assert.equal(summary.done, 1)
  assert.equal(summary.activeWorktrees, 2)
})

test('a later status for the same pane replaces the earlier one', () => {
  const state = createPresenceState()
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'done', receivedAt: 2 })
  assert.equal(summarize(state).working, 0)
  assert.equal(summarize(state).done, 1)
})

test('unknown states are ignored rather than counted', () => {
  const state = createPresenceState()
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'exploded', receivedAt: 1 })
  assert.equal(summarize(state).panes, 0)
})

test('removing a worktree drops its panes', () => {
  const state = createPresenceState()
  applyWorktreeCreated(state, { worktreeId: 'w1', path: '/repos/app', branch: 'main' })
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  applyWorktreeRemoved(state, { worktreeId: 'w1', path: '/repos/app' })
  assert.equal(summarize(state).panes, 0)
  assert.equal(summarize(state).worktrees, 0)
})

test('stale statuses are pruned', () => {
  const now = 1_000_000_000
  const state = createPresenceState()
  applyAgentStatus(state, { paneKey: 'fresh', worktreeId: 'w', state: 'working', receivedAt: now })
  applyAgentStatus(state, {
    paneKey: 'old',
    worktreeId: 'w',
    state: 'working',
    receivedAt: now - STALE_STATUS_MS - 1
  })
  pruneStale(state, now)
  assert.equal(summarize(state).working, 1)
})

test('state round-trips through storage serialization', () => {
  const state = createPresenceState()
  applyWorktreeCreated(state, { worktreeId: 'w1', path: '/repos/app', branch: 'feat/x' })
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'blocked', receivedAt: 7 })
  const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(state))))
  assert.deepEqual(summarize(restored), summarize(state))
  assert.equal(restored.worktrees.get('w1').branch, 'feat/x')
})

test('deserialize tolerates garbage', () => {
  assert.equal(summarize(deserializeState(null)).panes, 0)
  assert.equal(summarize(deserializeState({ panes: { a: 'nope' } })).panes, 0)
  assert.equal(summarize(deserializeState({ worktrees: 5 })).worktrees, 0)
})

test('describeActivity reads naturally at each fleet size', () => {
  const state = createPresenceState()
  assert.equal(describeActivity(summarize(state)), 'No agents running')

  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'done', receivedAt: 1 })
  assert.equal(describeActivity(summarize(state)), 'Fleet idle')

  applyAgentStatus(state, { paneKey: 'b', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  assert.equal(describeActivity(summarize(state)), '1 agent working')

  applyAgentStatus(state, { paneKey: 'c', worktreeId: 'w2', state: 'working', receivedAt: 1 })
  assert.equal(describeActivity(summarize(state)), '2 agents working · across 2 worktrees')

  applyAgentStatus(state, { paneKey: 'd', worktreeId: 'w2', state: 'blocked', receivedAt: 1 })
  assert.equal(describeActivity(summarize(state)), '2 agents working · 1 blocked · across 2 worktrees')
})

test('minimal privacy publishes no project or branch name', () => {
  const state = createPresenceState()
  applyWorktreeCreated(state, { worktreeId: 'w1', path: '/repos/secret-client', branch: 'feat/acme-migration' })
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  const activity = buildActivity({
    state,
    focus: { displayName: 'secret-client', branch: 'feat/acme-migration' },
    privacy: 'minimal',
    startedAt: 1000
  })
  const encoded = JSON.stringify(activity)
  assert.ok(!encoded.includes('secret-client'), encoded)
  assert.ok(!encoded.includes('acme'), encoded)
  assert.equal(activity.state, '1 agent working')
})

test('full privacy publishes project and branch', () => {
  const state = createPresenceState()
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  const activity = buildActivity({
    state,
    focus: { displayName: 'orca', branch: 'main' },
    privacy: 'full',
    startedAt: 1000
  })
  assert.equal(activity.details, 'orca · main')
  assert.equal(activity.timestamps.start, 1000)
})

test('off privacy publishes nothing at all', () => {
  const state = createPresenceState()
  applyAgentStatus(state, { paneKey: 'a', worktreeId: 'w1', state: 'working', receivedAt: 1 })
  assert.equal(buildActivity({ state, focus: null, privacy: 'off', startedAt: 1 }), null)
})

test('full privacy degrades when the host has no focus context', () => {
  const state = createPresenceState()
  applyWorktreeCreated(state, { worktreeId: 'w1', path: '/repos/app', branch: 'main' })
  const activity = buildActivity({ state, focus: null, privacy: 'full', startedAt: 0 })
  assert.equal(activity.details, 'app')
  assert.equal(activity.timestamps, undefined)
})

test('over-long fields are clamped to what Discord accepts', () => {
  const state = createPresenceState()
  const activity = buildActivity({
    state,
    focus: { displayName: 'x'.repeat(200), branch: 'y'.repeat(200) },
    privacy: 'full',
    startedAt: 0
  })
  assert.ok(activity.details.length <= 128, String(activity.details.length))
})

test('privacy cycles through every level and returns', () => {
  assert.equal(nextPrivacy('full'), 'minimal')
  assert.equal(nextPrivacy('minimal'), 'off')
  assert.equal(nextPrivacy('off'), 'full')
})
