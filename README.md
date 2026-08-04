# Orca Discord Presence

Publishes what your [Orca](https://github.com/stablyai/orca) agent fleet is doing to your Discord status, next to the Orca logo.

```
[logo]  Orca                                        ← minimal (default)
        2 agents working · 1 blocked · across 2 worktrees

[logo]  Orca · checkout-service · feat/ipc          ← full
        2 agents working · 1 blocked · in checkout-service, web
```

The first line is the **header** (configurable, `Orca` by default) followed by the focused workspace and its branch; the second is the fleet, naming the workspaces the agents are working in.

Written in TypeScript, no runtime dependencies — the Discord Rich Presence IPC protocol is spoken directly over `node:net`.

## Requirements

- Orca `>= 1.4.0` with the plugin system enabled (Settings → Plugins)
- The Discord **desktop** app running on the same machine (the web client exposes no local IPC socket)

No configuration is needed to get started — the plugin ships with a Discord application id and starts publishing as soon as an agent does something.

## Install

**From a marketplace source** (recommended):

Settings → Plugins → *Add marketplace* and paste:

```
https://github.com/LuticaCANARD/orca-discord-presence.git
```

Orca reads `orca-marketplace.json` from that repository, resolves the entry to an exact commit, and shows the consent dialog listing the capabilities below.

The listing pins a **release tag**, not `main` — a branch ref would re-resolve to whatever HEAD happens to be on the next marketplace refresh, quietly moving users onto unreleased commits. A test enforces that the ref is a tag and that it matches the manifest version.

**From a local checkout** (for development):

```bash
git clone https://github.com/LuticaCANARD/orca-discord-presence.git
cd orca-discord-presence
npm install && npm run build
```

Then Settings → Plugins → *Add development plugin* and pick the checkout directory.

## Configuration (optional)

Orca has no UI for per-plugin settings yet, so write them into the plugin's own settings file:

| Platform | Path |
| --- | --- |
| Linux | `~/.config/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| macOS | `~/Library/Application Support/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| Windows | `%APPDATA%\Orca\plugins-data\lutica-canard.discord-presence\settings.json` |

```json
{
  "privacy": "minimal",
  "enabled": true,
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
| `header` | `"Orca"` | Leading segment of the first line; supports `{workspace}` / `{branch}`; `""` drops it |
| `largeImage` | `"orca"` | Art asset key for the logo; `""` publishes no image |
| `largeText` | `"Orca"` | Tooltip shown when hovering the logo |

Every key is optional. Restart Orca (or disable and re-enable the plugin) to pick the file up. Run **Show Connection Status** to see the header and logo key currently in effect.

### Changing the header without leaving Orca

The **Discord Presence: Set Header** command writes the same setting, so the settings file is a convenience rather than the only way in:

- **With an argument** — the argument is the new header, so a keybinding or automation can set it outright: `"My Fleet"`, or `{ "header": "My Fleet" }`. An empty string hides the header.
- **With no argument** — the command cycles the presets, which is what the command palette can do on its own since Orca has no text input for commands:

  `Orca` → `{workspace}` → `{workspace} · {branch}` → *hidden* → `Orca` → …

`{workspace}` and `{branch}` are placeholders resolved at publish time, not literals frozen into the setting. That distinction is the point: a header of `checkout-service` keeps publishing that name after a drop to `minimal`, while `{workspace}` blanks out and falls back to `Orca`. A token that resolves to nothing takes its separator with it, so the line never reads as a stray middle dot.

### The logo, and what Discord will actually render

`largeImage` is an **art asset key**, not a file path: Discord renders artwork that was uploaded to the application the presence is published through. The shipped application carries the Orca logo under the key `orca`, which is why no configuration is needed.

Point `clientId` at your own application and that changes — the key `orca` means nothing there until you upload artwork under that name. Either upload a logo as `orca`, or set `largeImage` to whatever key you did use.

### Publishing under your own Discord application

The line above the header reads *"Playing \<application name\>"*, and that name comes from the Discord application the presence is published through — not from this plugin, and it cannot be set over Rich Presence IPC. That is what `header` exists for: it is the topmost line this plugin does control. To change the *"Playing …"* line itself, publish through your own application:

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Name it whatever the status should read as
3. Copy the **Application ID** from *General Information* into `clientId`
4. Upload artwork under *Rich Presence → Art Assets*, then set `largeImage` to its key

A Rich Presence application id is a public identifier — it travels in every client's IPC traffic and grants nothing on its own. The sensitive half is the OAuth client secret, which Rich Presence never needs and this plugin never asks for. That is why an id ships in the source.

Run **Show Connection Status** to see whether you are on the shipped application or your own.

## Privacy

**The default is `minimal`, and that is deliberate.** Branch names routinely carry ticket ids and client names, and a status that published them the moment you enabled the plugin would be a bad default.

| Level | Published |
| --- | --- |
| `full` | Header, focused workspace and branch, agent counts, and the names of the workspaces agents are working in — `Orca · checkout-service · feat/ipc` / `2 agents working · in checkout-service, web` |
| `minimal` *(default)* | Header and agent counts only — no workspace names, no branch. Busy worktrees are counted, never named, and `{workspace}` / `{branch}` in the header blank out |
| `off` | Nothing; the status is cleared |

Cycle levels at runtime with the **Discord Presence: Cycle Privacy Level** command. The `minimal` masking is covered by tests asserting that no project, branch, or workspace name reaches the payload.

Workspace names come from the worktree's directory name (its branch is the fallback). Only worktrees Orca announced while the plugin was running can be named — anything else is counted instead, so a `full` status degrades to `across 2 worktrees` rather than going blank. Long lists collapse: `in api, cli, docs +2`.

## Commands

| Command | Effect |
| --- | --- |
| `Discord Presence: Toggle` | Enable/disable publishing; persists |
| `Discord Presence: Cycle Privacy Level` | `full` → `minimal` → `off` → … |
| `Discord Presence: Set Header` | Sets the first line from the command's argument, or cycles the presets without one; persists |
| `Discord Presence: Show Connection Status` | Notification with the line being published, the logo key, connection state, and socket path |

## Capabilities requested

| Capability | Why |
| --- | --- |
| `workspace:read` | Focused workspace name and branch for the `full` privacy level |
| `events:subscribe` | Worktree lifecycle and agent status changes — the data being published |
| `storage` | Fleet state survives worker reaps (see below) |
| `settings:own` | The plugin's own `clientId` / `privacy` / `enabled` / `header` / artwork keys |
| `notifications:show` | Command feedback |

`secrets` and `terminal:send` are deliberately **not** requested.

## Known limitations

**The status is ephemeral by design.** Orca reaps a plugin worker after 5 minutes with no in-flight work (`PLUGIN_WORKER_IDLE_REAP_MS`) and re-forks it on the next event. A worker cannot keep itself alive — only host→worker traffic refreshes the idle clock. So the presence appears while your fleet is active, disappears after a few quiet minutes, and returns on the next agent event. Fleet state is persisted to plugin storage so nothing is lost across the gap.

**Linux socket discovery is heuristic.** Orca's worker environment is an allowlist that omits `XDG_RUNTIME_DIR`, so `/run/user/<uid>` is reconstructed from `process.getuid()`. Flatpak and Snap layouts are probed too. If Discord is running but the plugin cannot find it, run *Show Connection Status* — it reports the last error.

**The plugin API is EXPERIMENTAL upstream.** Orca's own docs say there are no compatibility promises until `pluginApi` v1 freezes. In particular, opening a local socket is possible today because the capability model has no `net:*` kind yet — the source notes scoped kinds are planned. A future Orca may gate this, and this plugin would need a declared capability to keep working.

**Discord rate limits `SET_ACTIVITY`.** Updates are debounced (1.5s) with a 4s floor between publishes, and identical payloads are skipped entirely.

## Development

```bash
npm install
npm run build      # tsc → dist/
npm test           # build + node --test (63 tests)
npm run typecheck  # no emit
```

`dist/` **is committed on purpose.** Orca installs a plugin directory as-is with no build step on the host side, so the compiled entry has to be in the repository. CI verifies that `dist/` matches the sources.

### Cutting a release

Three places carry the version and a test fails if they disagree:

1. `package.json` → `version`
2. `orca-plugin.json` → `version`
3. `orca-marketplace.json` → `plugins[].source.ref` (as `v<version>`)

Then `npm run build`, commit, and push a matching tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The release workflow re-runs typecheck, build, the stale-`dist/` check and the tests, verifies the tag matches the manifest, and publishes a GitHub release.

Layout:

```
orca-plugin.json          manifest (validated against the host schema by a test)
orca-marketplace.json     marketplace index — lets this repo be its own source
src/main.mts              worker entry: activate/deactivate, commands, events
src/lib/orca-api.mts      hand-maintained types for Orca's plugin worker API
src/lib/presence-model.mts  pure state model — events in, activity payload out
src/lib/discord-ipc.mts   Rich Presence IPC client over node:net
src/lib/socket-path.mts   socket discovery across platforms and sandboxes
```

Orca ships no types package for plugin authors, so `src/lib/orca-api.mts` transcribes the host's contracts (`plugin-host-api.ts`, `plugin-events.ts`, `plugin-capabilities.ts`). A type error there after an Orca upgrade is a real signal — read it before casting it away.

## License

MIT
