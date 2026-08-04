# Orca Discord Presence

Publishes what your [Orca](https://github.com/stablyai/orca) agent fleet is doing to your Discord status, next to the Orca logo.

```text
┌──────┐  Orca                                              ← minimal (default)
│ logo │  2 agents working · 1 blocked · across 2 worktrees
└──────┘  00:14 elapsed

┌──────┐  Orca · checkout-service · feat/ipc                ← full
│ logo │  2 agents working · 1 blocked · in checkout-service, web
└──────┘  00:14 elapsed
```

Line one is the **header**, and it is yours to set. Line two is the fleet. The timer measures the current stretch of work, not how long Orca has been open.

TypeScript, no runtime dependencies — the Discord Rich Presence IPC protocol is spoken directly over `node:net`.

## Requirements

- Orca `>= 1.4.0` with the plugin system enabled (Settings → Plugins)
- The Discord **desktop** app running on the same machine (the web client exposes no local IPC socket)

Nothing else. The plugin ships with a Discord application id and starts publishing as soon as an agent does something.

## Install

Settings → Plugins → *Add marketplace*, paste the URL, and accept the consent dialog:

```text
https://github.com/LuticaCANARD/orca-discord-presence.git#v0.1.0
```

The `#v0.1.0` matters: without it Orca reads the index off `main`, which moves. The dialog lists the [capabilities](#capabilities-requested) below. To hack on the plugin instead, see [Development](#development).

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
| `Discord Presence: Cycle Privacy Level` | `full` → `minimal` → `off` → … |
| `Discord Presence: Set Header` | Sets line one from the command's argument, or cycles the presets without one |
| `Discord Presence: Show Connection Status` | What is being published, the logo key, connection state, socket path, and the last error |

All of them persist. **Show Connection Status** is the first thing to reach for when something looks wrong — it reports why the last publish failed.

## Configuration

Every setting has a working default; this section is for changing them.

### The header

The **Set Header** command is the way in that does not involve a text editor:

- **With an argument** — the argument becomes the header, so a keybinding or automation can set it outright: `"My Fleet"`, or `{ "header": "My Fleet" }`. An empty string hides the header.
- **With no argument** — it cycles the presets, which is all the command palette can drive on its own:

  `Orca` → `{workspace}` → `{workspace} · {branch}` → *hidden* → `Orca` → …

`{workspace}` and `{branch}` are resolved at publish time, not frozen into the setting, and that distinction is the whole point. A header of `checkout-service` keeps publishing that name after a drop to `minimal`; `{workspace}` blanks out and falls back to `Orca`. A token that resolves to nothing takes its separator with it, so the line never trails a stray middle dot.

### The logo

`largeImage` is an **art asset key**, not a file path — Discord renders artwork uploaded to the application the presence is published through. The shipped application hosts the Orca logo under the key `orca`, which is why the logo needs no configuration.

Point `clientId` at your own application and that stops being true: the key `orca` means nothing there until you upload artwork under that name. Upload a logo as `orca`, or set `largeImage` to whichever key you used.

### Publishing under your own Discord application

The line *above* the header reads *"Playing \<application name\>"*, and that name belongs to the Discord application, not to this plugin — Rich Presence IPC has no field for it. That is what `header` exists for: it is the topmost line a plugin can control. To change the *"Playing …"* line itself, publish through an application of your own:

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Name it whatever the status should read as
3. Copy the **Application ID** from *General Information* into `clientId`
4. Upload artwork under *Rich Presence → Art Assets*, then set `largeImage` to its key

A Rich Presence application id is a public identifier — it travels in every client's IPC traffic and grants nothing on its own. The sensitive half is the OAuth client secret, which Rich Presence never needs and this plugin never asks for. That is why an id ships in the source.

### The settings file

Orca has no UI for per-plugin settings yet, so anything the commands do not cover is written by hand:

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
  "largeText": "Orca"
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

Every key is optional, and `""` means *off* rather than *default*. Restart Orca, or disable and re-enable the plugin, to pick the file up.

## Capabilities requested

| Capability | Why |
| --- | --- |
| `workspace:read` | Focused workspace name and branch, for `full` privacy |
| `events:subscribe` | Worktree lifecycle and agent status changes — the data being published |
| `storage` | Fleet state survives worker reaps (see below) |
| `settings:own` | The plugin's own `enabled` / `privacy` / `clientId` / `header` / artwork keys |
| `notifications:show` | Command feedback |

`secrets` and `terminal:send` are deliberately **not** requested.

## Known limitations

**The status is ephemeral by design.** Orca reaps a plugin worker after 5 minutes with no in-flight work (`PLUGIN_WORKER_IDLE_REAP_MS`) and re-forks it on the next event. A worker cannot keep itself alive — only host→worker traffic refreshes the idle clock. So the presence appears while your fleet is active, disappears after a few quiet minutes, and returns on the next agent event. Fleet state is persisted to plugin storage so nothing is lost across the gap, and statuses older than six hours are dropped rather than rehydrated as if still live.

**The focused workspace is polled, not pushed.** Orca emits no focus-change event, so `full` privacy refreshes the workspace and branch every 30 seconds. Switching worktrees can take that long to show up.

**Command arguments depend on the host.** **Set Header** accepts a string or `{ header }` when Orca passes one through; if it does not, the preset cycle is the whole interface and free-form headers go in the settings file.

**Linux socket discovery is heuristic.** Orca's worker environment is an allowlist that omits `XDG_RUNTIME_DIR`, so `/run/user/<uid>` is reconstructed from `process.getuid()`. Flatpak and Snap layouts are probed too.

**The plugin API is EXPERIMENTAL upstream.** Orca's own docs promise no compatibility until `pluginApi` v1 freezes. Opening a local socket is possible today only because the capability model has no `net:*` kind yet — the source notes scoped kinds are planned. A future Orca may gate this, and the plugin would need a declared capability to keep working.

**Discord rate limits `SET_ACTIVITY`.** Updates are debounced (1.5s) with a 4s floor between publishes, and identical payloads are skipped entirely.

## Development

```bash
git clone https://github.com/LuticaCANARD/orca-discord-presence.git
cd orca-discord-presence
npm install
npm run build      # tsc → dist/
npm test           # build + node --test (64 tests)
npm run typecheck  # no emit
```

Settings → Plugins → *Add development plugin* and pick the checkout directory to load it into Orca.

```text
orca-plugin.json            manifest (validated against the host schema by a test)
orca-marketplace.json       marketplace index — lets this repo be its own source
src/main.mts                worker entry: activate/deactivate, commands, events
src/lib/orca-api.mts        hand-maintained types for Orca's plugin worker API
src/lib/presence-model.mts  pure state model — events in, activity payload out
src/lib/discord-ipc.mts     Rich Presence IPC client over node:net
src/lib/socket-path.mts     socket discovery across platforms and sandboxes
```

`dist/` **is committed on purpose.** Orca installs a plugin directory as-is with no build step on the host side, so the compiled entry has to be in the repository. CI fails the build when `dist/` and `src/` disagree.

Orca ships no types package for plugin authors, so `src/lib/orca-api.mts` transcribes the host's contracts (`plugin-host-api.ts`, `plugin-events.ts`, `plugin-capabilities.ts`). A type error there after an Orca upgrade is a real signal — read it before casting it away.

### Cutting a release

Four places carry the version, and a test fails if they disagree:

1. `package.json` → `version`
2. `orca-plugin.json` → `version`
3. `orca-marketplace.json` → `plugins[].source.ref` (as `v<version>`)
4. `README.md` → the install URL's `#v<version>` fragment

Then `npm run build`, commit, and push a matching tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The release workflow re-runs typecheck, build, the stale-`dist/` check and the tests, verifies the tag matches the manifest, and publishes a GitHub release.

The marketplace listing pins a **release tag**, not `main` — a branch ref would re-resolve to whatever HEAD happens to be on the next marketplace refresh, quietly moving users onto unreleased commits. A test enforces that the ref is a tag and that it matches the manifest version.

## License

MIT
