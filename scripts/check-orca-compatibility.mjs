#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const BASELINE_URL = new URL('../orca-compatibility.json', import.meta.url)
const API_ROOT = 'https://api.github.com'

export function assessCompatibility(baseline, snapshot) {
  const findings = []
  if (snapshot.latestRelease !== baseline.verifiedRelease) {
    findings.push(
      `latest stable release is ${snapshot.latestRelease}; reviewed baseline is ${baseline.verifiedRelease}`
    )
  }

  const reviewedMain = baseline.verifiedMain?.contracts ?? {}
  for (const [path, expected] of Object.entries(baseline.contracts)) {
    const released = snapshot.releaseObjects[path]
    const main = snapshot.mainObjects[path]
    if (released !== expected) {
      findings.push(`${path} changed in ${snapshot.latestRelease}: ${expected} -> ${released ?? 'missing'}`)
    }
    // `main` runs ahead of the release, so a file can legitimately differ there
    // for weeks before it ships. `verifiedMain` records the unreleased object
    // ids that were read and judged harmless; anything else on main is drift.
    // A revert back to the released id is fine too — that is the baseline.
    const alsoAccepted = reviewedMain[path]
    if (main !== expected && main !== alsoAccepted) {
      const against = alsoAccepted ? `${expected} or reviewed ${alsoAccepted}` : expected
      findings.push(`${path} changed on main: ${against} -> ${main ?? 'missing'}`)
    }
  }

  // An override that no longer describes anything is worse than none: left in
  // place it would go on excusing whatever lands at that path next. Drift away
  // from a reviewed id is already reported above, so this only catches the
  // quiet case — main came back to the released id and the override is spent.
  for (const path of Object.keys(reviewedMain)) {
    if (!(path in baseline.contracts)) {
      findings.push(`verifiedMain reviews ${path}, which is not a pinned contract`)
      continue
    }
    if (snapshot.mainObjects[path] === baseline.contracts[path]) {
      findings.push(`verifiedMain for ${path} is obsolete: main matches the release again`)
    }
  }
  return findings
}

function requestHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'orca-discord-presence-compatibility-check',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const token = process.env['GITHUB_TOKEN']?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function githubJson(path) {
  const response = await fetch(`${API_ROOT}${path}`, { headers: requestHeaders() })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(
      `GitHub API ${response.status} for ${path}: ${detail}${hintFor(response.status)}`
    )
  }
  return response.json()
}

/**
 * The two ways this check fails for reasons that have nothing to do with
 * upstream: a token the API rejects, and no token at all on a shared address
 * whose unauthenticated budget is already spent. Both read as "compatibility
 * broke" unless the message says otherwise.
 */
function hintFor(status) {
  const authenticated = Boolean(process.env['GITHUB_TOKEN']?.trim())
  if (status === 401 && authenticated) {
    return '\nGITHUB_TOKEN was rejected. Unset it to try unauthenticated, or supply a valid token.'
  }
  if (status === 403 && !authenticated) {
    return '\nUnauthenticated requests are rate limited per address. Set GITHUB_TOKEN and retry.'
  }
  return ''
}

async function objectIdsAtRef(repository, ref, paths) {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const encodedPath = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const item = await githubJson(
        `/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
      )
      return [path, typeof item.sha === 'string' ? item.sha : null]
    })
  )
  return Object.fromEntries(entries)
}

export async function readUpstreamSnapshot(baseline) {
  const latest = await githubJson(`/repos/${baseline.upstream}/releases/latest`)
  if (typeof latest.tag_name !== 'string' || latest.tag_name.length === 0) {
    throw new Error('GitHub latest release response has no tag_name')
  }
  const paths = Object.keys(baseline.contracts)
  const [head, releaseObjects, mainObjects] = await Promise.all([
    githubJson(`/repos/${baseline.upstream}/commits/main`),
    objectIdsAtRef(baseline.upstream, latest.tag_name, paths),
    objectIdsAtRef(baseline.upstream, 'main', paths)
  ])
  return {
    latestRelease: latest.tag_name,
    mainCommit: typeof head.sha === 'string' ? head.sha : 'unknown',
    releaseObjects,
    mainObjects
  }
}

export async function runCompatibilityCheck() {
  const baseline = JSON.parse(await readFile(BASELINE_URL, 'utf8'))
  const snapshot = await readUpstreamSnapshot(baseline)
  const findings = assessCompatibility(baseline, snapshot)

  console.log(`Orca latest release: ${snapshot.latestRelease}`)
  console.log(`Reviewed release: ${baseline.verifiedRelease} (${baseline.verifiedAt})`)
  console.log(`Orca main: ${snapshot.mainCommit}`)
  console.log(`Tracked contracts: ${Object.keys(baseline.contracts).length}`)

  if (findings.length === 0) {
    console.log('Compatibility contracts are unchanged.')
    return
  }
  for (const finding of findings) {
    if (process.env['GITHUB_ACTIONS'] === 'true') {
      console.error(`::error title=Orca compatibility review required::${finding}`)
    } else {
      console.error(`- ${finding}`)
    }
  }
  process.exitCode = 1
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runCompatibilityCheck().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
