# Agent Note: Two-stage desktop runtime surface: Electron sidecar shell then embedded host

Status: proposed

English | [中文](2026-08-15-desktop-runtime-surface.zh.md)

## Problem

dsh ships two surfaces only: `web` (the browser application) and `headless` (a one-shot runner with no UI). A user who wants a desktop application gets a browser tab plus a manually started process today. The desktop shape carries obligations the web surface does not: double-click launch without Node.js or CLI prerequisites, an owned window and tray that survive tab closure, OS-native directory picking, notifications, and path opening, and installable artifacts with signing and updates.

The community fills this gap with external wrappers: Electron or Tauri shells that spawn `dsh web` as a child process and load the resulting loopback URL. That shape leaves the HTTP carrier in place, so every desktop user still runs a listening web server with the full browser trust fence, and desktop-native capabilities stay bolted onto the shell outside the composition — invisible to profiles, bundles, and `dsh plugin`. The largest such wrapper states explicitly that delivering its desktop layer through the official plugin mechanism is its unmet roadmap item.

The architecture anticipates this surface. The [GUI layering and RPC protocol note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) names the Electron goal — "A future Electron application reuses the same web client packages over an IPC fetch carrier" — and lists an IPC bridge subclass as a hypothetical carrier row; `dsh-host-webserver` documents that Electron loads dist over `file://` and carries fetch over an IPC bridge. What does not exist yet is the decision: which shell, how the runtime is sourced, how the stages land, and what happens to the trust fence when the HTTP surface disappears.

## Proposal

Add the desktop surface in two stages. Both stages keep the official web UI untouched: the desktop shell renders the shipped dist, and all agent behavior stays in the existing plugin tree. Decisions locked up front: Electron at the latest stable line; the sidecar shape stays permanently as the fallback and remote-connection mode; Windows ships first with code-signing budget (Windows signing first, Apple Developer ID notarization second); the desktop profile accepts plugin installation through the existing `dsh plugin` machinery.

### Stage A — sidecar shell (shippable 1.0)

`apps/desktop` is a new app bin beside `apps/cli` and `apps/web`: an Electron main process, preload, and packaged shell. It spawns the official `dsh --profile web` as a child process and loads the printed URL in a hardened BrowserWindow. No existing package changes.

- Runtime discovery chain: an instance already serving on the deployment's default web origin (`127.0.0.1:13080` in this deployment; the shipped profile default is 3080) → `dsh` on PATH → the npx cache (`~/.npm/_npx`, `%LOCALAPPDATA%\npm-cache\_npx`) → the bundled runtime shipped in the installer's `extraResources`. Each source is validated (`package.json` name and version) before launch, and the selection is shown in the connection UI.
- Port and readiness: spawn with `--port 0`, parse the `dsh web:` URL line from stdout, poll the index for HTTP 200, then complete the `host.describe` handshake before the window shows.
- Security baseline: bind only `127.0.0.1`; renderer runs with `nodeIntegration` off, `contextIsolation` and the Chromium sandbox on; new windows and cross-origin navigation open in the system browser; Cordis HMR's `--expose-internals` goes only to the child process.
- Data: pass through `DSH_HOME` unchanged (default `~/.dsh`); sessions, plugins, credentials, and settings are shared with the browser surface, and the shell creates no second data root.
- Shell UX: loading screen with stages, logs, and retry; close hides to tray while agent work continues; single-instance lock; process-tree kill on exit (Windows `taskkill /T`); one automatic restart on crash.
- Packaging: electron-builder matrix, Windows x64 NSIS + portable first, then macOS arm64/x64 DMG, then Linux x64 AppImage/deb; a GitHub Actions release workflow with a packaged smoke test per artifact; signing secrets wired for Windows first.

Stage A exits when the Windows installer double-click launches, shares `~/.dsh`, and exits with no orphan processes, and the Stage B gate spike below passes.

### Stage B gate — embedded-host spike

Before building Stage B, verify that an Electron main (or `utilityProcess`) boots a minimal Cordis tree through built `dsh-app-boot`: the embedded Node satisfies dsh engines and the session persistence SQLite dependency; native addons (landlock runner, win32 dialog bindings) load after Electron ABI rebuild; Loader bare-specifier resolution works with `bareModuleBaseUrl`. If any check fails, Stage B keeps the host in a real Node child process and moves the bridge onto that process's stdio/IPC transport — the composition below is unchanged, only the carrier's physical location moves.

### Stage B — desktop runtime plugin

`packages/bundle/desktop` (`@deepseek-ai/dsh-desktop-app`) rides `dsh-base` the way `dsh-web-app` does, and `desktop` joins `web` and `headless` in `PROFILE_TEMPLATES`. `dsh plugin --profile desktop add` works unchanged through the existing profile machinery.

Composition differences from the web bundle:

| Row | Desktop treatment |
|---|---|
| webserver / frontend-static / web-runtime / browser trust fence | Not mounted — there is no HTTP surface |
| `dsh-host-desktop` (new) | Boots the Cordis tree through `dsh-app-boot` inside the Electron main, assembles the boot manifest, registers IPC routes |
| `dsh-host-apiproxy` | Unchanged; its carrier changes |
| `dsh-client-desktop-connection` (new) | The desktop carrier: an `AbstractApiClient` subclass whose `doFetch` rides `ipcRenderer.invoke`, plus two IPC channels carrying the mux/host downlink pair |
| client roster | Same packages; the boot manifest rides preload/contextBridge instead of index taps, and client bundles ride `BootSeams.loadBundle` over IPC |

Consequences:

- No listening port. The loopback/trusted-host/Origin/DNS-rebinding fence the [api browser-trust boundary note](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) documents protects a network carrier; the embedded desktop composition has none, so it mounts none of that fence. The note stays authoritative for web and remote carriers.
- The wire protocol is unchanged. The four-quadrant message union, zod validation, and rpcId discipline ride the IPC carrier byte-identically; carrier-equivalence tests pin this.
- Desktop-native capabilities become registered plugins, not shell bolt-ons: an Electron `dialog.showOpenDialog` backend on the [directory-picker seam](../../implemented/feature/2026-07-27-native-workspace-directory-picker.md); `shell.openPath` for `host.openPath`; OS notifications from the Electron main subscribed to turn-end events. Each is removable from the profile.
- `embeddedHost` in the bundle config toggles the shape: embedded (the Stage B default) or the retained Stage A sidecar, which also serves remote-instance connection over `/api` with `--trusted-host`.

### Repository fit

New packages follow house rules: ESM, `@deepseek-ai/dsh-<name>`, a per-package invariant, a README with the Model Experience section, tsconfig aggregate registration, and the coverage gate for client packages. The label taxonomy already groups browser and Electron graphical interfaces under one `area/web` domain. Desktop e2e runs Playwright-on-Electron in the keyless replay mode beside the web lane.

## Alternatives considered

**Tauri shell instead of Electron.** Stage B embeds the Cordis host in the shell's main process; Tauri's main process is Rust, so the host would remain a Node sidecar and every IPC bridge would cross a Rust↔Node serialization boundary on top of the wire envelope. The community's one well-executed Tauri wrapper validates the sidecar shape, not the embedded one. Electron keeps one shell technology across both stages.

**Skip Stage A and land the embedded host directly.** That holds a shippable artifact hostage to the embedded-host spike: Electron Node engine, native-module ABI, Loader resolution, and packaging are all unvalidated until late. Stage A ships the product surface, the installers, the release workflow, and the process-lifecycle code Stage B keeps as its fallback, so a failed spike relocates the carrier instead of stalling the project.

**Stage A only, permanently.** The web server, its port, and the trust fence stay on every desktop install; desktop-native capabilities remain outside the composition, invisible to `dsh plugin` and profiles; and the community gap — a desktop surface delivered through the official plugin mechanism — stays open. That gap is what this proposal exists to close.

**Reuse the browser trust fence in embedded mode.** The fence is a reachability policy for a network carrier. Embedded mode has no network carrier: the renderer talks to the host over in-process IPC. Mounting the fence would add a dead security mechanism whose presence reads as protection.

**Deliver the shell as an external community-style wrapper.** That shape cannot make desktop capabilities plugins, cannot share the release and signing pipeline, and forks the mental model of what a dsh surface is. The point of this decision is that the desktop surface is a composition, not a wrapper.

## Acceptance criteria

Stage A:

- The Windows installer launches on double-click, reaches the official web UI, shares `~/.dsh` with the browser surface, and exits with no orphan processes; macOS and Linux artifacts follow on the same workflow.
- The runtime discovery chain selects each of its four sources under documented conditions and reports the selected source and version.
- Renderer hardening holds: no `nodeIntegration`, `contextIsolation` on, external navigation leaves the app.
- A Playwright-on-Electron smoke runs keyless in CI.

Stage B:

- `dsh --profile desktop --dump-config` prints a composition without webserver rows, and the running desktop app binds no TCP port.
- The same RPC corpus passes byte-identical wire assertions over the IPC carrier and the in-process carrier.
- Client plugin HMR works in the desktop window without refresh through the `dev:web` watcher.
- Each desktop-native plugin (directory picker, path open, notifications) is removable from the profile, and its absence degrades loudly, never silently.
- The sidecar fallback and remote-instance connection still work when `embeddedHost` is off.
- Repository gates pass: typecheck, lint, coverage, doc-sync, hygiene, and the desktop e2e lane.

## Risks

Electron's embedded Node moves with each stable line; a dsh engine bump or native-addon ABI break can strand a pinned shell. Pinning the Electron line at release time plus the retained Stage A sidecar bounds this: worst case the desktop app ships in sidecar mode until the embedded host catches up.

Upstream RC churn can change the CLI flags, the stdout URL line, or the boot manifest shape Stage A parses. Discovery and readiness pin their contracts with integration tests against the built app, and the bundled-runtime source fixes one known-good pairing per release.

`file://` boot and IPC bundle transport touch the edges of the [client plugin loading model](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md) (index taps, script execution, CSP). `BootSeams` exists for exactly this environment; the residual risk is HMR and module-table corner cases, contained by the carrier-equivalence and HMR acceptance tests.

Code signing adds recurring cost and secret management (Windows first, then Apple notarization). Unsigned fallback builds must keep working so CI never depends on certificate presence.

This note realizes the Electron carrier anticipated by the [GUI layering and RPC protocol note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) and the [client plugin loading model](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md); when Stage B lands, the former's hypothetical IPC-bridge row becomes real and its "no such shell exists" fact is updated in the same change. The [api browser-trust boundary note](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) remains authoritative for every network carrier.
