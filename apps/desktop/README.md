# `@deepseek-ai/dsh-desktop-shell`

English | [中文](README.zh.md)

The desktop shell is the Electron sidecar window over the official dsh web runtime (Stage A of the desktop surface): it spawns `dsh --profile web` on loopback with an OS-assigned port, completes the readiness handshake, and renders the shipped web UI in a hardened window. All agent behavior stays in the existing plugin tree; the shell owns the window, tray, and process lifecycle, and renders the web UI without touching it.

## Runtime discovery

Each launch resolves a runtime through a validated chain, in order: an instance already serving on the deployment's default web origin (`http://127.0.0.1:13080` here; override with `DSH_DESKTOP_PROBE_ORIGIN`), recognized through a `host.describe` probe, then a `dsh` binary on `PATH` (validated through `--version`), the npx cache (`~/.npm/_npx`, `%LOCALAPPDATA%\npm-cache\_npx`), and finally the runtime bundled in the installer's `extraResources`. On-disk sources must present `@deepseek-ai/dsh`'s own package manifest before launch; a serving instance is attached, never spawned or killed. The selected source and version appear on the loading screen.

Spawned runtimes always run `web --host 127.0.0.1 --port 0`; readiness is the `dsh web:` URL line on stdout, then HTTP 200 on the index, then the `host.describe` echo — the window shows the web UI only after all three.

## Window and process lifecycle

The renderer runs with `nodeIntegration` off and `contextIsolation` plus the Chromium sandbox on; new windows and cross-origin navigation go to the system browser. Closing the window hides it to the tray while the runtime keeps serving agent work; quitting kills the spawned process tree (Windows `taskkill /T`, POSIX process-group signal) and leaves no orphans. An unexpected runtime exit restarts it once automatically; a second exit stops on the loading screen with the runtime's log tail and a retry button. One instance runs per user (single-instance lock).

The bundled runtime ships as one archive (`resources/dsh-runtime.zip`) and the shell extracts it into its userData on first run (`src/bundled-runtime.ts`), because this electron-builder build strips `node_modules` from resource copies outright; the extracted tree runs under the Electron binary itself (`ELECTRON_RUN_AS_NODE` plus `--expose-internals` for the web profile's HMR row), so an installed app needs no system Node.js. The `PATH` and npx sources serve development machines that already have one.

## Data

The child environment is the shell's own environment, so `DSH_HOME` (default `~/.dsh`) passes through unchanged: sessions, plugins, credentials, and settings are shared with the browser surface and the shell creates no second data root.

## Development

`pnpm run dev:desktop` downloads the Electron binary (`desktop:prepare`; the workspace automations gate deliberately skips it), builds the repo artifacts, and opens the window through the same discovery chain as an install: it attaches to the deployment's serving instance when the probe origin answers, and otherwise spawns whatever validated `dsh` the machine provides (a repo checkout has no `dsh` shim — install one globally or stage a shim directory on `PATH` to exercise the spawn path). `pnpm run test:desktop` runs the keyless Playwright-on-Electron smoke: it attaches to a serving instance when the probe origin answers (and asserts quitting leaves that instance alive) or spawns the built CLI through a staged shim in an isolated `DSH_HOME` (and asserts quitting reaps it); on a node older than 22.19 — which cannot boot the runtime's `node:zlib` dependency — the spawn branch self-skips with that reason. Local packaging requires the bundled runtime directory first: `npm install --prefix apps/desktop/resources/dsh-runtime --omit=dev @deepseek-ai/dsh@<version>`, then `pnpm --filter @deepseek-ai/dsh-desktop-shell exec electron-builder` — see [electron-builder.yml](electron-builder.yml) and the desktop-release workflow.

The [desktop runtime surface note](../../personal/docs/notes/proposed/2026-08-15-desktop-runtime-surface.md) owns the two-stage design; [the Stage A implementation note](../../personal/docs/notes/implemented/2026-08-15-desktop-sidecar-shell.md) owns what landed.
