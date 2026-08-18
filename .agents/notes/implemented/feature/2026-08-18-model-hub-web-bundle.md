# Agent Note: Model Hub ships in the Web bundle

Status: implemented

English | [中文](2026-08-18-model-hub-web-bundle.zh.md)

## Problem

Model Hub existed as two profile-installed packages under `personal/plugins`: the host authoring and failover logic, and the browser settings page. That topology depended on absolute local paths, source execution, and a separately built client bundle, so a packaged desktop installation omitted the feature even though the repository contained its source.

## Decision

Model Hub is a pair of release-member workspace packages: `@deepseek-ai/dsh-model-hub` under `packages/llm/model-hub` and `@deepseek-ai/dsh-client-ui-model-hub` under `packages/client/ui-model-hub`. The Web bundle declares both packages and mounts both rows by default; an empty authoring document is dormant and safe.

The host package keeps the `dsh-x-model-hub` settings namespace and `modelHub/*` Remote names so existing DSH-X settings and the client protocol retain their identities. It compiles into the public `@deepseek-ai/dsh-llm-pi-ai` API, and the pi-ai package exports the catalog materializer needed for vendor presets. The client package follows the normal client aggregate, `dsh.client` manifest, slot injection, build, invariant, and release-pack paths.

The release dependency closure starts at `@deepseek-ai/dsh-web-app`; its package manifest names both Model Hub packages, so profile healing and packed desktop staging resolve them without a profile-local install or network fetch.

## Verification

Package tests cover authoring schema and compilation, reconciliation ownership, fallback selection, probing, presets, import planning, the browser store, the built client registration, and both invariant companions. A keyless browser scenario boots the shipped Web composition, opens Settings → Model Hub, reaches the host Remote with an empty document, and snapshots the editable provider and model lists. Release verification and packed-runtime checks cover dependency closure and plain-Node loading.

## Alternatives considered

**Keep profile-installed personal packages.** Packaged applications cannot depend on one developer's absolute path, and the browser module would still require a separately built artifact and manual profile installation.

**Copy the personal source into desktop resources.** The host entry pointed at TypeScript source and would not load under the packaged plain-Node runtime; a copy also bypasses workspace constraints, invariants, documentation, and release packing.

**Merge Model Hub into the existing Models settings package.** The existing page edits adapter-owned provider profiles, while Model Hub owns a separate model-centered authoring document and ordered cross-provider failover. Keeping the host compiler and its browser projection as independent plugins preserves those responsibilities and lets deployments disable the additional authoring plane as one pair.

## Consequences

Every Web and desktop installation includes an additional Model Hub settings section and two release packages. Empty installations pay client-bundle and registration cost but create no routes or model requests. Maintainers must keep the browser's authoring type mirrors aligned with the host types until the Remote generator supplies a browser-safe declaration entry.
