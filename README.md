# Orca Discord Presence

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Publishes what your [Orca](https://github.com/stablyai/orca) agent fleet is doing to your Discord status, next to the Orca logo.

```text
┌──────┐  Orca                                                    ← minimal (default)
│ logo │  2 agents working · 1 blocked · across 2 worktrees   (3 of 5)
└──────┘  12:40 elapsed

┌──────┐  Orca · checkout-service · feat/ipc                      ← full
│ logo │  2 agents working · 1 wrapping up · in checkout-service, web   (3 of 5)
└──────┘  12:40 elapsed
```

Line one is the **header**, and it is yours to set. Line two is [the fleet](#the-fleet-line), ending in Discord's own party gauge: busy agents out of the agents Orca has announced. The timer measures [the current stretch of work](#the-elapsed-timer), not how long Orca has been open.

TypeScript, no runtime dependencies — the Discord Rich Presence IPC protocol is spoken directly over `node:net`.

## Requirements

- Orca `>= 1.4.246` with the plugin system enabled (Settings → Plugins) — last verified against Orca `1.4.274`, see [Compatibility](#compatibility)
- The Discord **desktop** app running on the same machine (the web client exposes no local IPC socket)

Nothing else. The plugin ships with a Discord application id and starts publishing as soon as an agent does something.

## Install

**New in v0.4.0.** Edit privacy, header, and artwork in Orca’s plugin settings. Changes apply while the plugin runs. In `full` mode, the Discord card updates when the focused workspace changes.

Open **Settings → Plugins → Add plugin → From a Git URL…**, paste the release URL, and approve the requested permissions.

```text
https://github.com/LuticaCANARD/orca-discord-presence.git#v0.4.0
```

If you install through **Catalog sources…**, enter the repository URL in **Git URL** and `v0.4.0` in **Git ref**. Choose **Add source**, then open **Discord Presence** in the catalog to install it.

**Upgrading from v0.3.1.** Update Orca to 1.4.246 or later first. If you use the catalog pinned to `v0.3.1`, add the `v0.4.0` source so Orca can offer the new version. Review the updated permissions if Orca prompts you.

[Release notes](https://github.com/LuticaCANARD/orca-discord-presence/releases/tag/v0.4.0)

## What gets published

### The fleet line

An agent counts as busy while it is `working`, `blocked`, or `waiting`. Orca renders the last two identically — "agent needs user attention" — so a fleet sitting on permission prompts keeps the timer running instead of reading as idle, and each gets its own segment because being stuck and being asked are different news.

`working` is Orca's **combined** state, and that word hides something: a pane reads `working` while the main agent *or any live subagent* works, so an agent that has finished while its subagent keeps running still counts. The host now reports the main agent's own state beside the combined one, so those panes are split out as `1 wrapping up` and subtracted from the working count — three working panes, one of them a subagent's tail, read as `2 agents working · 1 wrapping up`, never as four agents. A host that sends no main-agent fact says nothing either way, and its panes stay plain working agents.

Turns that *ended badly* are deliberately absent. The host reports a verdict on the main agent's last finished turn (`failure`, a proven `interruption`, a `cancellation` somebody asked for), but a failure count on a public profile is noise minutes after it stopped being news. **Show Connection Status** reports recent failures instead, where they are actionable.

### The elapsed timer

The timer counts from when the fleet's current stretch of work began. Two answers to that exist, and the host's is better: `mainAgent.stateStartedAt` is stamped when the agent's own state began, where this plugin can only know when it *noticed*. The difference is exactly the interesting case — Orca reaps an idle plugin worker after five minutes and re-forks it on the next event, and the plugin can be enabled while agents are already running. The host's stamp survives both; a locally observed one restarts the clock at zero.

So the earliest still-busy agent's own stamp wins, with the local observation as fallback. Panes that are only wrapping up do not anchor it — their stamp dates the main agent's `done`, not the start of the work the subagent is finishing. The stamp comes from the machine the agent runs on, which for an SSH host is not this one, so a value more than a minute in the future or more than a day old is discarded rather than published as a timer counting down from the future. **Show Connection Status** says which of the two the timer is using.

### The party gauge

Discord renders `(3 of 5)` beside the status line: busy agents out of the panes Orca has reported a status for. It carries no names, so it publishes at `full` and `minimal` alike, and disappears when nothing is busy — `(0 of 5)` reads as a broken party rather than as an idle fleet. The party id that accompanies it is random per worker and joinless: Rich Presence needs a join secret to put a **Join** button on your profile, which this plugin never sends.

## Privacy

**The default is `minimal`, and that is deliberate.** Branch names routinely carry ticket ids and client names, and a status that published them the moment you enabled the plugin would be a bad default.

| Level | Published |
| --- | --- |
| `full` | Header, focused workspace, branch, agent counts, and the workspaces agents are working in |
| `minimal` *(default)* | Header and agent counts. Busy worktrees are counted, never named; `{workspace}` and `{branch}` in the header blank out |
| `off` | Nothing; the status is cleared |

Cycle levels with the **Cycle Privacy Level** command. The `minimal` masking is not a convention — tests assert that no project, branch, or workspace name reaches the payload at that level.

Workspace names come from the worktree's directory name, falling back to its branch. Only worktrees Orca announced while the plugin was running can be named, so a `full` status degrades to `across 2 worktrees` rather than going blank, and long lists collapse to `in api, cli, docs +2`.

## Commands

| Command | Effect |
| --- | --- |
| `Discord Presence: Toggle` | Enable/disable publishing |
| `Discord Presence: Cycle Privacy Level` | Sets the level from the command's argument, or cycles `full` → `minimal` → `off` → … without one |
| `Discord Presence: Set Header` | Sets line one from the command's argument, or cycles the presets without one |
| `Discord Presence: Reconnect` | Drops the Discord connection and publishes again immediately |
| `Discord Presence: Show Connection Status` | What is being published, the logo and badge keys, turns that recently ended badly, connection state, socket path, and the last error |

All of them persist. **Show Connection Status** is the first thing to reach for when something looks wrong — it reports why the last publish failed.

**Reconnect** is for the case the backoff cannot cover: Discord started after Orca, or restarted while the fleet was quiet. The plugin retries on its own, but only while its worker is alive, and Orca reaps an idle worker after five minutes (see [Known limitations](#known-limitations)). Running the command re-forks the worker *and* makes that fork connect straight away.

### Shortcuts

Every command shows up under **Settings → Shortcuts → Plugins**, where you can record a chord for the ones you reach for — `Toggle` and `Cycle Privacy Level` being the likely two.

**The plugin ships no default chords, deliberately.** A manifest keybinding is *instructional content* to Orca: declaring one binds your consent to the plugin's file tree, so every release would arrive as *Needs review* in Settings → Plugins, and a chord that collided with another plugin's would disable **both** plugins' commands. A shortcut you record yourself is an override — it survives updates and costs neither.

## Configuration

Every setting has a working default; this section is for changing them.

### The header

The **Set Header** command is the way in that does not involve a text editor:

- **With an argument** — the argument becomes the header, so a keybinding or automation can set it outright: `"My Fleet"`, or `{ "header": "My Fleet" }`. An empty string hides the header.
- **With no argument** — it cycles the presets, which is all the command palette can drive on its own:

  `Orca` → `{workspace}` → `{workspace} · {branch}` → *hidden* → `Orca` → …

`{workspace}` and `{branch}` are resolved at publish time, not frozen into the setting, and that distinction is the whole point. A header of `checkout-service` keeps publishing that name after a drop to `minimal`; `{workspace}` blanks out and falls back to `Orca`. A token that resolves to nothing takes its separator with it, so the line never trails a stray middle dot.

### The logo and the badge

`largeImage` is an **art asset key**, not a file path — Discord renders artwork uploaded to the application the presence is published through. The shipped application hosts the Orca logo under the key `orca`, which is why the logo needs no configuration.

Point `clientId` at your own application and that stops being true: the key `orca` means nothing there until you upload artwork under that name. Upload a logo as `orca`, or set `largeImage` to whichever key you used.

`smallImage` is the badge in the logo's corner, and it is **off by default** — the shipped application hosts artwork under no key but `orca`, so a default would publish an empty square. Upload a badge to your own application and name its key to turn it on; a badge with no logo to sit on is dropped rather than published alone.

### Publishing under your own Discord application

The line *above* the header reads *"Playing \<application name\>"*, and that name belongs to the Discord application, not to this plugin — Rich Presence IPC has no field for it. That is what `header` exists for: it is the topmost line a plugin can control. To change the *"Playing …"* line itself, publish through an application of your own:

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Name it whatever the status should read as
3. Copy the **Application ID** from *General Information* into `clientId`
4. Upload artwork under *Rich Presence → Art Assets*, then set `largeImage` to its key

A Rich Presence application id is a public identifier — it travels in every client's IPC traffic and grants nothing on its own. The sensitive half is the OAuth client secret, which Rich Presence never needs and this plugin never asks for. That is why an id ships in the source.

### The settings file

Open **Settings → Plugins → Discord Presence** to edit the settings. Changes made in Orca take effect while the plugin runs.

You can also edit the stored JSON directly. Restart Orca or reload the plugin after a direct file edit.

| Platform | Path |
| --- | --- |
| Linux | `~/.config/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| macOS | `~/Library/Application Support/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| Windows | `%APPDATA%\Orca\plugins-data\lutica-canard.discord-presence\settings.json` |

```json
{
  "enabled": true,
  "privacy": "minimal",
  "clientId": "1234567890123456789",
  "header": "Orca",
  "largeImage": "orca",
  "largeText": "Orca",
  "smallImage": "",
  "smallText": ""
}
```

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Publish at all |
| `privacy` | `"minimal"` | See [Privacy](#privacy) |
| `clientId` | shipped id | The Discord application to publish through |
| `header` | `"Orca"` | Line one; takes `{workspace}` and `{branch}`; `""` hides it |
| `largeImage` | `"orca"` | Art asset key for the logo; `""` publishes no image |
| `largeText` | `"Orca"` | Tooltip when hovering the logo |
| `smallImage` | `""` *(off)* | Art asset key for the badge in the logo's corner |
| `smallText` | `""` | Tooltip when hovering the badge |

Every key is optional, and `""` means *off* rather than *default*. Restart Orca, or disable and re-enable the plugin, to pick the file up.

## Capabilities requested

| Capability | Why |
| --- | --- |
| `workspace:read` | Focused workspace context and workspace events |
| `agent:read` | Agent status changes |
| `storage:own` | Fleet state survives worker reaps (see below) |
| `settings:own` | The plugin's own `enabled` / `privacy` / `clientId` / `header` / artwork keys |
| `notifications:show` | Command feedback |

`secrets:own` and `terminal:send` are deliberately **not** requested.

## Compatibility

Reviewed the plugin contracts in Orca [v1.4.274](https://github.com/stablyai/orca/releases/tag/v1.4.274) and Orca `main` at `bc471d51`. Manifest format 2 requires Orca 1.4.246 or later for this plugin’s settings and focus event.

In `full` privacy, Orca’s `workspace.changed` event updates the workspace and branch on the Discord card, subject to the usual publish delay. The same context is read on startup, **Show Connection Status**, and **Reconnect**.

`orca-compatibility.json` records the reviewed Git blob IDs. Run `npm run check:orca-compatibility` to compare the latest stable release and `main` against the baseline. The same check runs weekly on GitHub.

## Known limitations

**The status is ephemeral by design.** Orca reaps a plugin worker after 5 minutes with no in-flight work (`PLUGIN_WORKER_IDLE_REAP_MS`) and re-forks it on the next event. A worker cannot keep itself alive — only host→worker traffic refreshes the idle clock. So the presence appears while your fleet is active, disappears after a few quiet minutes, and returns on the next agent event. Fleet state is persisted to plugin storage so nothing is lost across the gap, and statuses older than six hours are dropped rather than rehydrated as if still live.

The palette and recorded shortcuts invoke the commands without arguments. Set a custom header in the plugin settings.

**The work-start stamp comes from the agent's own host.** `mainAgent.stateStartedAt` is stamped by the machine the agent runs on, so an SSH host with a skewed clock would otherwise move Discord's timer. Stamps more than a minute ahead of this machine or more than a day old are rejected in favour of the locally observed moment; a clock wrong by less than that shifts the elapsed reading by however much it is wrong.

**Linux socket discovery is heuristic.** Orca's worker environment is an allowlist that omits `XDG_RUNTIME_DIR`, so `/run/user/<uid>` is reconstructed from `process.getuid()`. Flatpak and Snap layouts are probed too.

**The plugin API is EXPERIMENTAL upstream.** Orca's own docs promise no compatibility until `pluginApi` v1 freezes. Opening a local socket is possible today only because the capability model has no `net:*` kind yet — the source notes scoped kinds are planned. A future Orca may gate this, and the plugin would need a declared capability to keep working.

**Discord rate limits `SET_ACTIVITY`.** Updates are debounced (1.5s) with a 4s floor between publishes, and identical payloads are skipped entirely.

**The worker's own log is in Settings.** When **Show Connection Status** is not enough, Settings → Plugins → *View logs* shows what the worker logged — failed connects, capability denials, and rejected events all land there.

## Development

```bash
git clone https://github.com/LuticaCANARD/orca-discord-presence.git
cd orca-discord-presence
npm install
npm run build      # tsc → dist/
npm test           # build + node --test
npm run typecheck  # no emit
```

Settings → Plugins → *Add development plugin* and pick the checkout directory to load it into Orca.

```text
orca-plugin.json            manifest (validated against the host schema by a test)
orca-marketplace.json       marketplace index — lets this repo be its own source
orca-compatibility.json     reviewed Orca release and plugin-contract object ids
scripts/check-orca-compatibility.mjs
                            latest-release and main contract drift check
src/main.mts                worker entry: activate/deactivate, commands, events
src/lib/orca-api.mts        hand-maintained types for Orca's plugin worker API
src/lib/presence-model.mts  pure state model — events in, activity payload out
src/lib/discord-ipc.mts     Rich Presence IPC client over node:net
src/lib/socket-path.mts     socket discovery across platforms and sandboxes
orca-compatibility.json     reviewed upstream blob ids — the baseline the weekly check compares against
scripts/check-orca-compatibility.mjs  the check itself (also runs as a workflow)
.github/actions/verify-build  the gates, shared by CI and both release paths
.github/workflows/          CI, tag-and-release, release, orca-compatibility
```

The installed tree is hashed and capped at 2,000 files and 50 MiB, which this repository (37 tracked files, under half a megabyte) is in no danger of reaching — worth knowing only because the compiled output ships inside it.

`dist/` **is committed on purpose.** Orca installs a plugin directory as-is with no build step on the host side, so the compiled entry has to be in the repository. CI fails the build when `dist/` and `src/` disagree.

Orca ships no types package for plugin authors, so `src/lib/orca-api.mts` transcribes the host's contracts (`plugin-host-api.ts`, `plugin-events.ts`, `plugin-capabilities.ts`). A type error there after an Orca upgrade is a real signal — read it before casting it away.

### Cutting a release

**Bumping the version is the release.** Four places carry it, and a test fails if they disagree:

1. `package.json` → `version`
2. `orca-plugin.json` → `version`
3. `orca-marketplace.json` → `plugins[].source.ref` (as `v<version>`)
4. `README.md` and its translations (`README.ko.md`, `README.ja.md`, `README.zh-CN.md`) → the install URL's `#v<version>` fragment

Run `npm run build`, commit every file the bump touched, and merge to `main`. **Tag and release** then reads the manifest version, stops if that tag already exists, runs the gates, and only then creates the tag and publishes the release — so a tag never points at a tree that failed its own checks, and nothing is tagged from a laptop. A version `0.4.0-rc.1` publishes as a pre-release.

The old route still works: push a `v*` tag yourself and **Release** verifies it against the manifest and publishes it. Reach for it to re-cut a release from an older commit, not for ordinary ones.

| Workflow | Trigger | Does |
| --- | --- | --- |
| **CI** | every push to `main`, every PR | The gates |
| **Tag and release** | push to `main` | Tags and publishes a version that has no tag yet |
| **Release** | a `v*` tag pushed by hand | Verifies the tag against the manifest and publishes it |
| **Orca compatibility** | Mondays, or on demand | Reads upstream and fails on anything unreviewed |

The gates themselves — typecheck, build, a `dist/` that agrees with `src/`, and the tests — live once in `.github/actions/verify-build` so none of the three paths can quietly drift from the others.

The marketplace listing pins a **release tag**, not `main` — a branch ref would re-resolve to whatever HEAD happens to be on the next marketplace refresh, quietly moving users onto unreleased commits. A test enforces that the ref is a tag and that it matches the manifest version.

## License

MIT
