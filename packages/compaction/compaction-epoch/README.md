# @deepseek-ai/dsh-compaction-epoch

English | [中文](README.zh.md)

## Summary

`compaction-epoch` owns one fact about a Session: whether it has left its bootstrap phase in the current compaction epoch. A compaction rewrites the model-visible surface — the conversation collapses into one summary and the workspace-instruction baseline is re-injected — so the first post-compaction request is a "second first request". The state is therefore epoch-aware: each `compaction/end` demotes again.

The state is a session projection, not per-process bookkeeping, so a resumed session folds the same phase from its durable log instead of restarting its bootstrap phase.

This package contributes only the fold and the read. The plugin rows that gate on it — the context gate, the tool bootstrap, the instruction hint, and the session guide — each apply their own promotion signal, so all of them share one fold.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Registering the unit](#registering-the-unit)
  - [Reading the phase](#reading-the-phase)
- [Understand the implementation](#understand-the-implementation)
  - [Why a projection](#why-a-projection)
  - [Why one unit serves four plugins](#why-one-unit-serves-four-plugins)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [Indirect effect on the first request](#indirect-effect-on-the-first-request)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Promotion signals are fixed to two event types](#promotion-signals-are-fixed-to-two-event-types)
  - [No published invariant](#no-published-invariant)

## Use this package

### Registering the unit

Call `registerPromotionEpoch` once per consumer row, passing `ctx.get('sessionProjections')`. The registry reference-counts the key, so rows that mount and unmount independently are safe.

```ts
import { registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'

const projections = ctx.get('sessionProjections')
if (projections === undefined) throw new Error('session projection registry is required')
const dispose = registerPromotionEpoch(projections)
ctx.effect(() => dispose)
```

Passing the service through `ctx.get` rather than declaring it in `inject` keeps a row mountable before the registry and preserves the row ordering the gating plugins depend on.

### Reading the phase

`promotionStatus` takes the agent the phase is read for, the promotion mode, and whether subagents follow the same phase.

```ts
const status = promotionStatus(projections, agent, 'either', false)
if (status.promoted) return decision
```

`status.boundary` carries the `compaction/end` sequence that opened the current epoch, or `null` before the session's first compaction. A consumer that must treat a compacted session differently from a fresh one reads it.

A subagent (`delegationDepth > 0`) reads as promoted unless `includeSubagents` is passed, so its first request keeps the full catalog and tool set.

## Understand the implementation

### Why a projection

The state is reconstructed from durable events rather than held in a process-local map, so a resumed or reloaded session does not restart its bootstrap phase. The registry owns the history read and the restore; this package contributes `init`, `apply`, and the state schema.

The fold runs in log order, so a `compaction/end` that arrives after a promotion simply resets the flags. No sequence comparison is needed: a signal that precedes the boundary was already cleared when that boundary arrived.

### Why one unit serves four plugins

The four consumer rows each choose a promotion mode, but a mode only selects between `tool/call` and `assistant/message`. Recording both flags in the fold keeps each mode a read rather than a second projection, and keeps one epoch authoritative for the whole session.

## Further Exploration

- The session projection Service Definition: `packages/session/session-projection/src/index.ts`
- The deprecation of synchronous Session history reads and the projection route it requires: `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`
- A plugin that folds its own projection: `packages/context/tmux-context/src/index.ts`

## Model Experience

### Indirect effect on the first request

This package emits no model-visible content. Its effect is that the consumer rows around it can keep a session's first request of each compaction epoch free of automatically injected context, which is a change to what those plugins send, not to anything sent here.

### Token effect

None directly. A gated first request reaches the model with no auto-injected runtime context and no appended step messages, which lowers the prompt for that one request.

### KV Cache effect

None directly. A gated first request presents a different prefix from the second request, so the prefix cache is cold for it. Once the session is promoted, later requests keep a stable prefix.

## Known Limitations and Deferred Work

### Promotion signals are fixed to two event types

`tool/call` and `assistant/message` are the only recorded signals. A consumer needing a third signal extends `PromotionEpoch` and its `apply`, which is a `stateVersion` change for the persisted unit.

### No published invariant

This package folds one unit and exposes two functions. There is no second observation of the epoch that could diverge from it, so no `./invariant` source is published; the projection registry owns the cross-checking for this key.
