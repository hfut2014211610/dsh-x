# `@deepseek-ai/dsh-desktop-shell`

English | [中文](README.zh.md)

The desktop shell is the Electron sidecar window over the official dsh web runtime (Stage A of the desktop surface): it spawns `dsh --profile web` on loopback with an OS-assigned port, completes the readiness handshake, and renders the shipped web UI in a hardened window. All agent behavior stays in the existing plugin tree; the shell owns the window, tray, and process lifecycle, and renders the web UI without touching it.

## Runtime discovery

Each launch resolves a runtime through a validated chain, in order: an instance already serving on the deployment's default web origin (`http://127.0.0.1:13080` here; override with `DSH_DESKTOP_PROBE_ORIGIN`), recognized through a `host.describe` probe, then a `dsh` binary on `PATH` (validated through `--version`), the npx cache (`~/.npm/_npx`, `%LOCALAPPDATA%\npm-cache\_npx`), and finally the runtime bundled in the installer's `extraResources`. On-disk sources must present `@deepseek-ai/dsh`'s own package manifest before launch; a serving instance is attached, never spawned or killed. The selected source and version appear on the loading screen.

**An installed app skips the serving-instance source entirely.** A runtime it did not spawn is one it must not stop, so attaching would leave a server running after the user quits — the installed app always owns its runtime. Probing stays the default for a source checkout, where a `dsh web` left running in a terminal is the point, and an explicit `DSH_DESKTOP_PROBE_ORIGIN` still wins in both directions.

Spawned runtimes always run `web --host 127.0.0.1 --port 0`; readiness is the `dsh web:` URL line on stdout, then HTTP 200 on the index, then the `host.describe` echo — the window shows the web UI only after all three.

## Window and process lifecycle

The renderer runs with `nodeIntegration` off and `contextIsolation` plus the Chromium sandbox on; new windows and cross-origin navigation go to the system browser. Closing the window hides it to the tray while the runtime keeps serving agent work; quitting kills the spawned process tree (Windows `taskkill /T`, POSIX process-group signal) and leaves no orphans. One instance runs per user (single-instance lock).

Two faults are treated as one, because they mean the same thing to whoever is using the app: the runtime exited, and the runtime stopped answering. The second needs asking about — a wedged event loop or a hung write leaves a process that is alive, a socket that accepts, and a UI whose every request hangs — so a connected runtime is probed with the same `host.describe` handshake that admitted it, and a run of consecutive misses reports a fault the way an exit does. One miss never does; a laptop resuming from sleep drops one.

Faults are answered by a rolling budget rather than a lifetime count (`src/restart-policy.ts`): three restarts inside ten minutes, backing off 0s → 5s → 30s, and faults older than the window are forgotten, so a runtime that dies once an hour always restarts and one that dies on every launch stops on the loading screen with its log tail. The retry button restores the full budget, because a person asking for it is information the window does not have — they may have freed the port the loop was failing on.

A shell that is killed outright — task manager, a crash, a power cut — never runs the quit path, and the runtime it spawned keeps serving with nothing left to stop it. Each launch therefore records the pid and origin it owns and reads that note back before spawning anything (`src/owned-runtime.ts`). The reap kills only when the recorded pid is still alive AND a dsh still answers on that recorded origin: a pid alone is not an identity, and killing a reused one would take down a process this shell never started.

The bundled runtime ships as one archive (`resources/dsh-runtime.zip`) and the shell extracts it into its userData on first run (`src/bundled-runtime.ts`), because this electron-builder build strips `node_modules` from resource copies outright; the extracted tree runs under the Electron binary itself (`ELECTRON_RUN_AS_NODE` plus `--expose-internals` for the web profile's HMR row), so an installed app needs no system Node.js. The `PATH` and npx sources serve development machines that already have one.

## Updates

The tray offers **Check for updates…**, and one unattended check runs twenty seconds after a connection — after the window is useful, never during boot, where it would compete with the runtime for the same cold network. A check that finds nothing says nothing; only an available update interrupts anyone.

This does not use electron-updater, for a reason visible in the packaged tree: `electron-builder.yml` ships an explicit `files` list, so the asar carries `lib/`, the preload, and the loading screen and no `node_modules` at all — a runtime dependency added here would not be in the installed app. The second reason is macOS, where applying an update in place needs a signed app and this fork's macOS builds are unsigned.

What replaces it is `src/updater.ts`: the release list over the GitHub API (JSON, so finding an update needs no YAML parser), the version read from anywhere in the tag rather than a fixed `v` prefix (the release tooling here tags `dsh-v0.3.1`, which is exactly the shape a stock tag parser rejects), the installer preferred over the portable build of the same extension, and the download verified against the `sha512` in the `latest*.yml` electron-builder already emits beside the installers. A checksum mismatch refuses the install rather than warning — the next step hands the file to the OS to execute. A release published without a channel file downloads unverified and says which of the two happened. The installer runs only after the runtime is down, as the last thing the quit path does, because it replaces files this process is running from.

`publish` in [electron-builder.yml](electron-builder.yml) names this fork explicitly: the default is inferred from the package manifest's `repository`, which is upstream, and every installed app would check releases that never carry these builds.

## Data

The child environment is the shell's own environment, so `DSH_HOME` (default `~/.dsh`) passes through unchanged: sessions, plugins, credentials, and settings are shared with the browser surface and the shell creates no second data root.

## Development

`pnpm run dev:desktop` downloads the Electron binary (`desktop:prepare`; the workspace automations gate deliberately skips it), builds the repo artifacts, and opens the window through the same discovery chain as an install: it attaches to the deployment's serving instance when the probe origin answers, and otherwise spawns whatever validated `dsh` the machine provides (a repo checkout has no `dsh` shim — install one globally or stage a shim directory on `PATH` to exercise the spawn path). `pnpm run test:desktop` runs the keyless Playwright-on-Electron smoke: it attaches to a serving instance when the probe origin answers (and asserts quitting leaves that instance alive) or spawns the built CLI through a staged shim in an isolated `DSH_HOME` (and asserts quitting reaps it); on a node older than 22.19 — which cannot boot the runtime's `node:zlib` dependency — the spawn branch self-skips with that reason. Local packaging requires the bundled runtime directory first: `npm install --prefix apps/desktop/resources/dsh-runtime --omit=dev @deepseek-ai/dsh@<version>`, then `pnpm --filter @deepseek-ai/dsh-desktop-shell exec electron-builder` — see [electron-builder.yml](electron-builder.yml) and the desktop-release workflow.

The [desktop runtime surface note](../../personal/docs/notes/proposed/2026-08-15-desktop-runtime-surface.md) owns the two-stage design; [the Stage A implementation note](../../personal/docs/notes/implemented/2026-08-15-desktop-sidecar-shell.md) owns what landed.
