# @deepseek-ai/dsh-client-ui-model-hub

English | [中文](README.zh.md)

Browser settings plugin for Model Hub. The shipped Web bundle registers it as Settings → Model Hub beside Models, Agent Presets, and Usage. The page calls the host package's `modelHub/*` Remote and listens for settings invalidations; it does not import host implementation code.

## Page behavior

The page edits providers and models separately. Provider forms cover vendor presets, display names, base and Anthropic-specific endpoints, credential references, and write-only API-key storage. Model forms cover catalog-derived presets, provider placement, protocol, capacities, modalities, reasoning levels, and ordered fallback placements. The list previews compiled routes and fallback chains, shows credential and reconcile status, probes model placements, imports suitable existing pi-ai routes, and can set the default model for future sessions.

An empty host document renders two editable empty lists. A read-only settings deployment keeps the page visible but disables mutations. RPC or validation failures remain visible on the page, while credentials are never returned to the browser after storage.

## Runtime registration

The Node entry is an inert loader marker. The `./client` bundle registers the `settings.section` entry `model-hub` through `ctx.slots.inject`, so it tolerates independent activation order and is removed with its plugin fiber. The Web bundle declares both this package and `@deepseek-ai/dsh-model-hub`; no profile-local plugin installation is required.

## Model Experience

### Browser configuration

#### What the model sees

Nothing. The `modelHub/*` calls configure host routes but add no prompt, message, or Tool text.

#### Token effect

None; this package adds no model request content.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Advanced provider fields remain YAML-owned** — headers and compatibility flags are preserved by host mutations but are not editable in this page.
- **Model discovery is not exposed** — the page offers catalog presets and model probing, but it does not yet invoke the adapter's model-list discovery operation.
- **Host authoring types are mirrored locally** — update `src/client/types.ts` with `@deepseek-ai/dsh-model-hub` until the Remote generator supplies a browser-safe declaration entry.
