# Working on this plugin

## Every change lands through a pull request

`main` publishes. A push to `main` whose `orca-plugin.json` version carries no
tag yet makes **Tag and release** run the gates, create that tag, and publish a
GitHub release from it — so a direct push to `main` is a release, intended or
not. Work on a branch, open a pull request, and leave the merge to a human.

The same goes for tags: never push one by hand unless you are deliberately
re-cutting an older commit. Merging a version bump is the release.

## Before you open the pull request

Run `npm test` — it builds and then runs the suite, which is what CI does. Two
failures catch most mistakes:

- **A stale `dist/`.** Orca installs the plugin directory as-is with no build
  step, so the compiled output is committed. Change anything under `src/` and
  `npm run build`, then commit `dist/` in the same change.
- **A version that disagrees with itself.** Four places carry it, the README
  install URL in every translation among them (see README → *Cutting a
  release*), and a test fails when they drift.

## Upstream is a moving target

`src/lib/orca-api.mts` is a hand-maintained transcription of Orca's plugin
contracts; Orca ships no types package for plugin authors. A type error there
after an upgrade is a real signal — read it before casting it away.

`orca-compatibility.json` pins the reviewed Git blob id of every upstream file
this plugin depends on, and the weekly **Orca compatibility** workflow fails on
any drift or any new stable release. When it fires: read the actual diff
upstream, reflect what matters in the code and in README → *Compatibility*, then
move the pin. `verifiedMain` is for ids that exist only on `main` and have been
read and judged harmless; clear an entry once the release catches up.

## The README is in four languages

`README.md` is the source; `README.ko.md`, `README.ja.md` and `README.zh-CN.md`
translate it. A change to the English README lands in all three in the same
pull request — a translation that lags reads as current and is not.

## House style

Comments explain *why*, not what. Match the surrounding density — these files
are commented where a reader would otherwise have to guess at a trade-off, and
bare everywhere else.
