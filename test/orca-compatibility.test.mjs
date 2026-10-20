import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assessCompatibility } from '../scripts/check-orca-compatibility.mjs'

const baseline = JSON.parse(
  await readFile(new URL('../orca-compatibility.json', import.meta.url), 'utf8')
)

function nextPatchRelease(release) {
  const [major, minor, patch] = release.replace(/^v/, '').split('.')
  return `v${major}.${minor}.${Number(patch) + 1}`
}

/** The snapshot the baseline describes: the release as pinned, and main with
 *  whatever unreleased object ids were reviewed on top. */
function matchingSnapshot() {
  return {
    latestRelease: baseline.verifiedRelease,
    mainCommit: 'a'.repeat(40),
    releaseObjects: { ...baseline.contracts },
    mainObjects: { ...baseline.contracts, ...(baseline.verifiedMain?.contracts ?? {}) }
  }
}

test('the Orca compatibility baseline is complete and pinned to Git object ids', () => {
  assert.equal(baseline.upstream, 'stablyai/orca')
  assert.match(baseline.verifiedRelease, /^v\d+\.\d+\.\d+$/)
  assert.match(baseline.verifiedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Object.keys(baseline.contracts).length >= 10)
  for (const [path, objectId] of Object.entries(baseline.contracts)) {
    assert.ok(path.startsWith('src/'), path)
    assert.match(objectId, /^[0-9a-f]{40}$/, path)
  }
})

test('an unchanged release and main pass the compatibility assessment', () => {
  assert.deepEqual(assessCompatibility(baseline, matchingSnapshot()), [])
})

test('a new stable release requires review even when the contracts match', () => {
  const snapshot = matchingSnapshot()
  // Derived from the baseline, not hardcoded: pinning a literal here makes the
  // test fail on the next review for a reason that has nothing to do with it.
  snapshot.latestRelease = nextPatchRelease(baseline.verifiedRelease)
  assert.deepEqual(assessCompatibility(baseline, snapshot), [
    `latest stable release is ${snapshot.latestRelease}; reviewed baseline is ${baseline.verifiedRelease}`
  ])
})

test('the reviewed-main baseline is pinned to Git object ids too', () => {
  const reviewed = baseline.verifiedMain?.contracts ?? {}
  for (const [path, objectId] of Object.entries(reviewed)) {
    assert.ok(path in baseline.contracts, `${path} is not a pinned contract`)
    assert.match(objectId, /^[0-9a-f]{40}$/, path)
    assert.notEqual(objectId, baseline.contracts[path], `${path} needs no main override`)
  }
  if (Object.keys(reviewed).length > 0) {
    assert.match(baseline.verifiedMain.commit, /^[0-9a-f]{7,40}$/)
  }
})

test('an unreleased change already reviewed on main is not reported again', () => {
  // main runs ahead of the release for weeks; re-reporting a reviewed refactor
  // every Monday would train everyone to ignore the check.
  const path = 'src/shared/plugins/plugin-manifest.ts'
  const snapshot = matchingSnapshot()
  assert.notEqual(snapshot.mainObjects[path], baseline.contracts[path], 'fixture sanity')
  assert.deepEqual(assessCompatibility(baseline, snapshot), [])
})

test('main drifting past a reviewed id is reported against both ids', () => {
  const path = 'src/shared/plugins/plugin-manifest.ts'
  const snapshot = matchingSnapshot()
  snapshot.mainObjects[path] = 'd'.repeat(40)
  const findings = assessCompatibility(baseline, snapshot)
  assert.equal(findings.length, 1)
  assert.ok(findings[0].includes('changed on main'))
  assert.ok(findings[0].includes(baseline.verifiedMain.contracts[path]), 'names the reviewed id')
})

test('a spent main override is reported so it cannot excuse the next change', () => {
  const path = 'src/shared/plugins/plugin-manifest.ts'
  const snapshot = matchingSnapshot()
  // The refactor was reverted, or the release caught up: nothing left to excuse.
  snapshot.mainObjects[path] = baseline.contracts[path]
  assert.deepEqual(assessCompatibility(baseline, snapshot), [
    `verifiedMain for ${path} is obsolete: main matches the release again`
  ])
})

test('released and unreleased contract drift name the exact file', () => {
  const snapshot = matchingSnapshot()
  const [path] = Object.keys(baseline.contracts)
  snapshot.releaseObjects[path] = 'b'.repeat(40)
  snapshot.mainObjects[path] = 'c'.repeat(40)
  const findings = assessCompatibility(baseline, snapshot)
  assert.equal(findings.length, 2)
  assert.ok(findings.every((finding) => finding.includes(path)))
  assert.ok(findings.some((finding) => finding.includes(baseline.verifiedRelease)))
  assert.ok(findings.some((finding) => finding.includes('on main')))
})
