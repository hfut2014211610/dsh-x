---
description: "Model Hub settings page: provider and model editing, compiled route preview, placement probing, and default-model selection over the host modelHub Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-hub

English | [中文](README.zh.md)

Browser settings plugin for Model Hub. The shipped Web bundle registers it as Settings → Model Hub beside Models, Agent Presets, and Usage. The page calls the host package's `modelHub/*` Remote and listens for settings invalidations; it does not import host implementation code.

## Summary

This package is the Model Hub settings page in the browser. It edits providers and models separately through the host package's `modelHub/*` Remote, previews compiled routes and fallback chains, probes model placements, imports suitable pi-ai routes, and sets the default model for future sessions. The Node entry is inert; the client bundle registers its settings section through slot injection. Use it when a deployment needs UI-managed model routing. It adds no model request content.

## Table of Contents

- [Page behavior](#page-behavior)
- [Runtime registration](#runtime-registration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="page-behavior"></a>
## Page behavior

The page edits providers and models separately. Provider forms cover vendor presets, display names, base and Anthropic-specific endpoints, credential references, and write-only API-key storage. Model forms cover catalog-derived presets, provider placement, protocol, capacities, modalities, reasoning levels, and ordered fallback placements. The list previews compiled routes and fallback chains, shows credential and reconcile status, probes model placements, imports suitable existing pi-ai routes, and can set the default model for future sessions.

An empty host document renders two editable empty lists. A read-only settings deployment keeps the page visible but disables mutations. RPC or validation failures remain visible on the page, while credentials are never returned to the browser after storage.

<a id="runtime-registration"></a>
## Runtime registration

The Node entry is an inert loader marker. The `./client` bundle registers the `settings.section` entry `model-hub` through `ctx.slots.inject`, so it tolerates independent activation order and is removed with its plugin fiber. The Web bundle declares both this package and `@deepseek-ai/dsh-model-hub`; no profile-local plugin installation is required.

<a id="model-experience"></a>
## Model Experience

None, as this page only edits settings the host already owns; it registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Advanced provider fields remain YAML-owned** — headers and compatibility flags are preserved by host mutations but are not editable in this page.
- **Model discovery is not exposed** — the page offers catalog presets and model probing, but it does not yet invoke the adapter's model-list discovery operation.
- **Host authoring types are mirrored locally** — update `src/client/types.ts` with `@deepseek-ai/dsh-model-hub` until the Remote generator supplies a browser-safe declaration entry.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Host authoring types are mirrored in `src/client/types.ts`; keep them in sync with `@deepseek-ai/dsh-model-hub` until the Remote generator supplies a browser-safe declaration entry.

</details>
