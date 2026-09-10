---
description: "Plugin mutation half: turn configured Loader entries on or off through one generated Remote, durable across restarts."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-control

English | [中文](README.zh.md)

The write half of the plugin surface. `PluginControlGateway` registers the `pluginControl` service and publishes one generated direct Remote, `pluginControl/setEnabled`, which turns one already-configured Loader entry on or off. [`plugin-inventory`](../plugin-inventory/README.md) reads the tree; this package changes it.

One `ctx.loader.update` is the whole operation. The Loader owns both the running tree and the profile it was read from, so that single call starts or stops the fiber and writes the change back — which is what makes it outlive a restart. Anything this package kept beside that would be a second truth to keep synchronized. An entry id the tree no longer holds is reported as `found: false` rather than thrown: the caller acts on a snapshot it read moments earlier, and an entry removed in between is an ordinary race.

The split from the inventory is deliberate on both counts. Reading the tree and rewriting it are different authorities, so a deployment can mount the projection without the mutation. And this fork keeps its edits to upstream files down to what cannot live anywhere else, which a new package can.

The service is Remote-only and declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Summary

This package is the write half of the plugin surface: one generated Remote, `pluginControl/setEnabled`, that turns an already-configured Loader entry on or off through a single `ctx.loader.update`, which both flips the running fiber and writes the profile back so the change outlives restarts. Unknown entry ids report `found: false` instead of throwing. The service is Remote-only with no same-process merge. Use it when a client must enable or disable composed entries without touching the tree directly.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this Host-only control surface registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Configured entries only** — the service enables and disables what the profile already declares. It cannot add an entry for a plugin the profile has never mentioned, nor remove one.
- **No resolution check** — enabling an entry whose module cannot be imported reports success, because the Loader accepts the configuration change and the import failure surfaces afterwards as the entry's own Fiber phase.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

One `ctx.loader.update` is the whole operation: the Loader owns the running tree and the profile it was read from, so keep nothing beside it or it becomes a second truth to synchronize.

</details>
