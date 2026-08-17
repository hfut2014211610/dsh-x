# Agent Note: Packed desktop runtime source and installer release upload

Status: implemented

English | [中文](2026-08-17-desktop-packed-runtime.zh.md)

## Problem

The desktop release workflow installs the bundled dsh runtime from the npm registry (`@deepseek-ai/dsh@<version>`), which requires that version to be published. This fork cuts releases it cannot publish to npm (the `@deepseek-ai` scope belongs to the upstream org), so a fork release tag could never produce installers carrying its own runtime: dispatching the existing workflow resolves to the registry's latest upstream build, and the resulting artifacts would carry this fork's shell around upstream's runtime. The workflow also only uploaded workflow-run artifacts, leaving the release-attachment step manual.

## Decision

`desktop-release.yml` gains two dispatch inputs. `runtime` selects the runtime source: `npm` (unchanged registry install) or `packed`, which packs the dsh and vendor families plus the landlock entry package from the same commit and installs the stage from those tarballs — the hermetic-consumer discipline of `verify-packed-install`, with `scripts/release/desktop-runtime.ts` computing the manifest. `release-tag`, when set, makes each packaging job attach its installers to that existing release with `gh release upload --clobber` under the job's `GITHUB_TOKEN`.

`desktop-runtime.ts` maps only the @deepseek-ai dependency closure of `@deepseek-ai/dsh` (dependencies plus peer dependencies, transitively) — never every packed tarball, because the family also carries the desktop shell and the web app, whose dependency trees would pull Electron into the runtime stage. The stage install keeps the registry path's flag set (`--omit=dev`, optionals enabled): koffi and landlock ship native prebuilts as optional platform packages, and omitting optionals forces a source build (measured: koffi fails without CMake).

The landlock entry package (`@deepseek-ai/node-addon-landlock-run`, a plain dependency of `dsh-sandbox-local`) is not part of either packed family; the workflow builds its TypeScript and packs it separately, exactly as `release.yml`'s verify step does.

The stage install keeps the registry path's flag set (`--omit=dev`, optionals enabled): koffi and landlock ship native prebuilts as optional platform packages, and omitting optionals forces a source build (measured: koffi fails without CMake). On win32 the manifest reader resolves the SYSTEM bsdtar by absolute path — a PATH `tar` may be GNU tar, which rejects `D:` drive-letter arguments as remote-host syntax and, on the workflow's Windows runner, killed the closure step silently under pwsh (native non-zero exits do not stop a pwsh step), shipping an empty runtime archive; both assembly steps now prove the stage holds `node_modules/@deepseek-ai/dsh/package.json` before anything zips it.

## Alternatives considered

**Dispatch the existing workflow with an upstream version.** Rejected: the installers would be labeled with this fork's version while embedding upstream's runtime — the release's headline feature (the anchored preset lives in the runtime package) would be absent from its own installers.

**Build installers fully from source in the workflow.** Rejected: it already builds the shell from source; only the runtime came from the registry. The packed source reuses the release family's own pack tooling instead of inventing a second runtime build.

**Map every packed tarball into the stage.** Rejected (measured during the port): the closure-free map installs the desktop shell and web app tarballs as stage dependencies, dragging Electron into the runtime archive.

**`--omit=optional` on the stage install, as `verify-packed-install` uses.** Rejected for this consumer: koffi distributes native prebuilts as optional platform packages; omitting them triggers a source build that fails on machines without CMake. The registry path never omitted optionals either.

## Consequences

- A fork release tag can produce installers whose runtime is exactly that tag's code, with no npm publication in the loop; `dsh-v0.2.0` is the first release carrying installers built this way.
- The packed stage still resolves external dependencies and native prebuilts from the npm registry, so it is hermetic only over the `@deepseek-ai` surface — a registry outage or a removed prebuilt still fails the install, same as the npm path.
- `--clobber` makes the upload idempotent for re-dispatched runs of the same release.
- The runtime closure is recomputed per run from the packed manifests, so a new family member enters the runtime only through a dependency edge, never by default.
