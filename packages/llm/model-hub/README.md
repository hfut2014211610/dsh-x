---
description: "Model-centered provider authoring: declare providers and models, compile pi-ai routes, ordered failover, and the modelHub Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-hub

English | [中文](README.zh.md)

Model-centered provider authoring over `@deepseek-ai/dsh-llm-pi-ai`. The `dsh-x-model-hub` settings namespace declares providers and models separately, lets each model select its wire protocol, compiles the document into ordinary pi-ai routes, and exposes the `modelHub/*` Typert Remote methods consumed by the browser settings page. The namespace name remains stable so an existing DSH-X settings document is reused after installation.

The Web bundle mounts this package by default. An empty document is dormant: it registers the settings namespace and RPC gateway but creates no provider routes. Every committed update is validated before its complete owned route set is reconciled; a rejected update leaves the previous routes serving requests and exposes the failure to the settings page.

## Summary

This package lets deployments author model providers per model instead of per route: the `dsh-x-model-hub` namespace declares providers and models separately with per-model wire protocols, compiles them into ordinary pi-ai routes under a package-owned `_routes` ledger, fails over ordered placements after the retry budget, and serves the `modelHub/*` Remote for the browser page. Invalid updates never displace serving routes. Use it when models must move across providers, protocols, or fallbacks without hand-writing routes.

## Table of Contents

- [Configuration](#configuration)
- [Route compilation and ownership](#route-compilation-and-ownership)
- [Ordered failover](#ordered-failover)
- [Model Hub Remote](#model-hub-remote)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

```yaml
dsh-x-model-hub:
  providers:
    primary:
      displayName: Primary gateway
      baseURL: https://gateway.example/v1
      endpoints:
        anthropic-messages: https://gateway.example
      apiKeyEnv: PRIMARY_API_KEY
  models:
    example-large:
      provider: primary
      api: openai-completions
      contextWindow: 262144
      maxTokens: 32768
      fallbacks:
        - provider: backup
          api: anthropic-messages
```

Providers own endpoints, credentials, headers, and shared capability defaults. Models own the model id, protocol, capacities, modalities, reasoning-effort mapping, and ordered fallback placements. API keys are stored through the credential service; this settings document stores only a credential reference.

<a id="route-compilation-and-ownership"></a>
## Route compilation and ownership

Models are grouped by `(provider, api)`. A provider used with one protocol keeps its provider key as the route id; a provider used with several protocols produces `<provider>~<api>` route ids. `endpoints[api]` overrides `baseURL` for one protocol, which is required when an Anthropic SDK route must receive a root URL while an OpenAI-compatible route uses a `/v1` prefix.

The `_routes` field is the package-owned route ledger. Reconciliation creates, updates, and removes only ledgered routes and never changes a hand-authored pi-ai route. Route ids containing `~` are reserved for compiled routes. Changing a model's protocol may therefore change the provider id recorded by subsequent requests.

<a id="ordered-failover"></a>
## Ordered failover

The normal `llm-retry` policy spends the active route's retry budget first. After that policy delegates an eligible request failure, this package selects the next compiled placement and returns a retry decision. The agent loop records the provider change in its ordinary request header, so the selected fallback remains active for later steps in the same session. Context-window failures do not fail over. Requests that remain on one unchanged route preserve the adapter's normal provider-local KV-cache behavior.

<a id="model-hub-remote"></a>
## Model Hub Remote

The `modelHub/*` Remote reads and mutates the authoring document, stores credentials, imports suitable hand-authored pi-ai routes without overwriting existing entries, lists catalog-derived vendor presets, probes every compiled placement of one model, and changes the default model for future sessions. Probes issue an independent one-token streaming request and do not append session events.

<a id="model-experience"></a>
## Model Experience

None, as route compilation configures providers without adding prompt, tool, or result text of its own; adapters own the model-visible request.

#### KV Cache effect

None of its own; changing the compiled provider route or failing over may prevent reuse of a provider-local KV cache.

## Known Limitations and Deferred Work

- **Provider and model types are mirrored by the browser package** — `packages/client/ui-model-hub/src/client/types.ts` must change with the authoring types until the Remote generator emits a client-safe type entry.
- **Failover starts only at an agent request boundary** — partial streamed output is not spliced across providers.
- **Import is intentionally additive** — catalog-only routes, routes without a resolvable protocol or endpoint, conflicting provider endpoints, and duplicate model ids are reported and skipped.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Reconciliation only creates, updates, and removes ledgered `_routes` entries and never touches hand-authored pi-ai routes; route ids containing `~` are reserved for compiled routes. The browser package mirrors the authoring types in its own `types.ts` until the Remote generator emits a client-safe entry — update both sides together.

</details>
