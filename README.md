# DSH-X

English | [中文](README.zh.md)

DSH-X is a personal fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — the plugin-based agent harness where everything is a plugin, built on Cordis. The fork tracks upstream `master` and carries its own product surface on top.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## What DSH-X adds

- **Desktop shell** — an Electron window over the `dsh --profile web` runtime, with runtime discovery, tray persistence, first-run bundled-runtime extraction, and installers for Windows (NSIS + portable) and macOS (dmg, arm64 + x64). Each release's installers embed a runtime built from that release tag itself, not from the npm registry ([apps/desktop](apps/desktop/README.md); [design note](personal/docs/notes/proposed/2026-08-15-desktop-runtime-surface.md)).
- **Anchored Standard preset** — [`anchored-standard`](packages/preset/agent-presets/presets/anchored-standard/), ported from the community [`dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard) project: request #1 anchors on the Minimal two-tool, zero-injection condition; after the first durable reply or tool call the catalog promotes to an on-demand-unlocked resident set (`dev_tool_search` / `skill_search` / `skill_load`). Phase state derives from durable session events, and compaction boundaries re-enter the controlled phase.
- **Usage surface** — per-request model token usage as a session projection, a `/usage` report command, and the Model-usage settings panel in the web UI.
- **Personal layer** — local model-hub presets and plugins under [personal/](personal/README.md), and this deployment's default web port 13080.

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

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

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). For agents, follow [AGENTS.md](AGENTS.md).

Everything not listed above tracks upstream: merge from the `upstream` remote to absorb its changes.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
