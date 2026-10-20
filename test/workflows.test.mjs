/**
 * The release pipeline's wiring, asserted where it is cheap to assert: the
 * gates live in one place, every path to a release runs them, and the tag comes
 * from the manifest rather than from a number somebody typed into YAML.
 *
 * Deliberately string-level. A YAML parser is not a dependency this plugin
 * needs, and these are the invariants that would actually rot.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

const GATES_PATH = '.github/actions/verify-build/action.yml'
const GATES_USE = 'uses: ./.github/actions/verify-build'
const STALE_DIST_ERROR = "::error::dist/ is stale"

test('the shared gates cover what a release must not ship without', () => {
  const gates = read(GATES_PATH)
  assert.match(gates, /using: composite/)
  for (const step of ['npm ci', 'npm run typecheck', 'npm run build', 'node --test']) {
    assert.ok(gates.includes(step), `the gates must run ${step}`)
  }
  assert.ok(gates.includes(STALE_DIST_ERROR), 'the gates must reject a stale dist/')
})

test('every path to a release runs the gates, and none re-implements them', () => {
  for (const workflow of ['ci.yml', 'release.yml', 'tag-and-release.yml']) {
    const source = read(`.github/workflows/${workflow}`)
    assert.ok(source.includes(GATES_USE), `${workflow} must use the shared gates`)
    // A second copy of a gate is how the three paths start disagreeing about
    // what "green" means.
    assert.ok(
      !source.includes(STALE_DIST_ERROR),
      `${workflow} re-implements the stale-dist gate instead of using the action`
    )
  }
})

test('the automatic release takes its tag from the manifest', () => {
  const source = read('.github/workflows/tag-and-release.yml')
  assert.ok(
    source.includes("require('./orca-plugin.json').version"),
    'the tag must come from the manifest version'
  )
  // Skipping the push when the tag exists is what makes every push to main
  // safe to re-run; without it a merge would try to re-tag a shipped version.
  assert.match(source, /rev-parse -q --verify "refs\/tags\/\$tag"/)
  assert.ok(source.includes('contents: write'), 'tagging needs write permission')
  assert.ok(source.includes('concurrency:'), 'two pushes must not race to tag')
  assert.ok(
    !/v\d+\.\d+\.\d+/.test(source),
    'no literal version belongs in the release workflow'
  )
})

test('a hand-pushed tag is still checked against the manifest', () => {
  const source = read('.github/workflows/release.yml')
  assert.ok(source.includes('does not match orca-plugin.json'))
  assert.ok(source.includes('--verify-tag'), 'never create a release for a tag that is not there')
})
