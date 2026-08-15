# Agent Note: The desktop sidecar shell — Stage A of the desktop runtime surface

Status: implemented

English | [中文](2026-08-15-desktop-sidecar-shell.zh.md)

## Problem

The desktop surface proposal ([desktop runtime surface](../../proposed/architecture/2026-08-15-desktop-runtime-surface.md)) lands in two stages and Stage A must ship first: a double-clickable Electron shell over the official web runtime, before any embedded-host work begins. Stage A needed a home for the shell that changes no existing package, follows the app-bin conventions (`apps/cli`, `apps/web`), and survives every repository gate — including the constraints gate that treats every `apps/*` package as a published release member.

## Decision

`apps/desktop` (`@deepseek-ai/dsh-desktop-shell`) is the sidecar shell: an Electron main process, a sandboxed preload bridging the loading screen, and the packaged loading UI. The main process resolves a runtime through the validated four-source chain (a serving instance on the deployment's default web origin — `127.0.0.1:13080` here, overridable through `DSH_DESKTOP_PROBE_ORIGIN` — then `dsh` on PATH, the npx cache, and the installer-bundled runtime), spawns it as `web --host 127.0.0.1 --port 0`, and gates the window on three readiness signals: the `dsh web:` URL line, HTTP 200 on the index, and the `host.describe` rpcId echo (`src/discovery.ts`, `src/sidecar.ts`, `src/rpc-probe.ts`).

Security posture: loopback-only bind, `nodeIntegration` off, `contextIsolation` and the Chromium sandbox on, external navigation and window opens routed to the system browser, and one allowed file URL (the loading screen itself). Lifecycle: tray persistence on close, single-instance lock, one automatic restart after an unexpected runtime exit, process-tree teardown on quit (Windows `taskkill /T`, POSIX process-group signal in `src/process-tree.ts`). The child environment is inherited verbatim, so `DSH_HOME` passes through unchanged and the shell owns no second data root.

The bundled runtime runs under the Electron binary through `ELECTRON_RUN_AS_NODE`, so an installed app needs no system Node.js — the PATH and npx sources exist for development machines that already have one. The Electron binary download is opt-in (`allowBuilds: electron: false` plus `pnpm run desktop:prepare`), so every other CI lane's `pnpm install` stays as fast as before.

## Consequences

- The shell is a release member like every `apps/*` package: published to npm with the family (`files` policy registered in `scripts/check-workspace-constraints.ts`), while the installable binaries come from the electron-builder matrix in `desktop-release.yml` — Windows x64 NSIS + portable first, macOS and Linux jobs staged behind the same workflow until the signing budget covers them.
- The keyless CI signal is the Playwright-on-Electron smoke (`vitest.desktop.config.ts`), which adapts to the serving-instance probe: when a dsh answers the deployment's default origin, the shell must attach and quitting must leave that instance alive (an attached runtime is not ours to kill); when nothing answers, the shell must spawn the built CLI through a staged npm-style shim in an isolated `DSH_HOME` and quitting must leave no surviving listener. A lane node older than 22.19 cannot boot the runtime's `node:zlib` dependency and self-skips the spawn branch with that reason. The release workflow additionally smokes the packaged `win-unpacked` executable against the bundled runtime alone.
- Discovery, readiness, and teardown are pure injected-dependency modules with unit suites; the Electron glue (`src/main.ts`) is deliberately thin and covered by the two smoke lanes rather than unit tests (apps are outside the per-file coverage gate, which stays untouched).
- Attaching to an already-serving instance never kills it: teardown is conditional on ownership, and the sidecar handle records whether the shell spawned the process.
- Contracts the shell parses are pinned by tests: the `dsh web:` URL line shape, the `host.describe` rpcId echo, and the `dsh --version` grammar. If upstream changes any of them, the desktop suites fail before a release ships a shell that cannot connect.
- Stage B (the embedded-host plugin composition) remains open behind its gate spike in the proposal; when it lands, the sidecar stays as the fallback and remote-connection mode.

## Alternatives considered

The proposal's own alternatives — Tauri, skipping Stage A, Stage A only forever, reusing the browser trust fence, and an external community wrapper — are recorded and weighed in [the desktop runtime surface note](../../proposed/architecture/2026-08-15-desktop-runtime-surface.md) and stay authoritative. Stage A additionally chose tsc output over a tsdown bundle for the main process: the entry is plain ESM with one external (`electron`) that electron-builder resolves through node_modules, so a bundler adds a build step and an externalization list without deleting any code.
