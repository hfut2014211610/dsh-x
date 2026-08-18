# DSH-X

English | [中文](README.zh.md)

DSH-X is a personal fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — the plugin-based agent harness where everything is a plugin, built on Cordis. The fork tracks upstream `master` and carries its own product surface on top.

## What DSH-X adds

- **Desktop shell** — an Electron window over the `dsh --profile web` runtime, with runtime discovery, tray persistence, first-run bundled-runtime extraction, and installers for Windows (NSIS + portable) and macOS (dmg, arm64 + x64). Each release's installers embed a runtime built from that release tag itself, not from the npm registry ([apps/desktop](apps/desktop/README.md); [design note](personal/docs/notes/proposed/2026-08-15-desktop-runtime-surface.md)).
- **Anchored Standard preset** — [`anchored-standard`](apps/cli/config/agent-presets/anchored-standard/), ported from the community [`dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard) project: request #1 anchors on the Minimal two-tool, zero-injection condition; after the first durable reply or tool call the catalog promotes to an on-demand-unlocked resident set (`dev_tool_search` / `skill_search` / `skill_load`). Phase state derives from durable session events, and compaction boundaries re-enter the controlled phase.
- **Usage surface** — per-request model token usage as a session projection, a `/usage` report command, and the Model-usage settings panel in the web UI.
- **Personal layer** — local model-hub presets and plugins under [personal/](personal/README.md), and this deployment's default web port 13080.

## Install

Desktop installers ship on the [releases page](https://github.com/hfut2014211610/dsh-x/releases) (`dsh-v0.2.0` is the first release carrying them). Code signing applies only when the release secrets are configured; otherwise the installers are valid but unsigned.

## Run from source

```sh
git clone https://github.com/hfut2014211610/dsh-x.git
cd dsh-x
pnpm install
pnpm run build
pnpm dsh web
```

The web UI serves at `http://127.0.0.1:13080` in this deployment. To develop the desktop shell: `pnpm run dev:desktop`.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). For agents, follow [AGENTS.md](AGENTS.md).

Everything not listed above tracks upstream: merge from the `upstream` remote to absorb its changes.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
