# @deepseek-ai/dsh-context-gate

English | [中文](README.zh.md)

## Summary

`context-gate` keeps a session's first model request of each compaction epoch free of automatically injected context. It does this by intercepting the harness's two unified injection paths rather than by denying known sources, so it also covers sources that do not exist yet.

Mount it as the FIRST row of a composition. Waterfall transforms apply in reverse registration order, so registering first makes this gate the outermost transform and nothing mounted later re-injects past it.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Understand the implementation](#understand-the-implementation)
  - [Two interception paths](#two-interception-paths)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [First request of an epoch](#first-request-of-an-epoch)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Skill invocations survive by default](#skill-invocations-survive-by-default)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

Add the row first in the composition. The plugin declares no service injections, so it applies before the context-injecting plugins and its pre-step listener prepends to the waterfall.

```yaml
- id: context-gate
  name: '@deepseek-ai/dsh-context-gate'
```

The composition must mount the session projection registry; the plugin fails loudly when it is absent, because it cannot gate anything without it.

### Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `promoteOn` | `either` | Which durable signal opens the gate: `tool-call`, `assistant-message`, or `either`. |
| `includeSubagents` | `false` | Whether subagents follow the gate instead of starting fully injected. |
| `enabled` | `true` | Whether both interception paths run. `false` disables the gate without changing the row set. |
| `allowKinds` | `['skill-invocation']` | Message `source.kind` names allowed beyond the claimed batch. An explicitly empty array keeps ONLY the claimed batch. |

An unknown key fails when the row mounts. Schemastery passes unknown keys through, so the plugin checks them itself rather than letting a typo silently disable a setting.

### Subagents

A subagent (`delegationDepth > 0`) reads as promoted by default: its first request already sees full context. Set `includeSubagents: true` to gate it too, so its first request is clean and its own first reply or tool call opens the gate. Keep this flag equal to the companion tool-bootstrap row.

## Understand the implementation

### Two interception paths

**Runtime context** (`system-prompt/assemble`): the assembled `contexts` are blanked while unpromoted. That covers the whole `SystemPrompt.context()` family — sandbox and approval policy snapshots, any third-party context provider — without enumerating it. The loop's own snapshot projection then emits no message during the gate, and at the first promoted request it emits exactly ONE fresh snapshot, because it diffs against a snapshot that never existed.

**Step messages** (`agent/pre-step`): the payload's `messages` is the batch this step CLAIMED from the inbox, which is the baseline every injection appends to. While unpromoted the gate keeps that baseline plus the kind allowlist and strips everything appended, whatever its source. Identity is by object or by id, because a listener may replace a claimed message with a copy.

Durable history, compaction summaries included, never passes through this gate: it enters the request via the session surface, not the pre-step waterfall.

### Failure behavior

Both filters degrade to "keep everything" on their own failures, because a gate bug must never eat the user's context. Downstream listener errors propagate untouched: only each filter's own logic is guarded. A failure warns once.

## Further Exploration

- The shared promotion state: `packages/compaction/compaction-epoch`
- A plugin that folds its own projection: `packages/context/tmux-context/src/index.ts`
- Waterfall semantics: `docs/cordis-primer.md`

## Model Experience

### First request of an epoch

The gated request reaches the model with no auto-injected runtime context and no appended step messages. At the first promoted request the model receives one fresh runtime-context snapshot and, from then on, every injection.

### Token effect

The gated request carries a shorter prompt. The saving is bounded by what the runtime-context family and the appended step messages would have contributed, which grows with the deployment's policy snapshots and third-party providers.

### KV Cache effect

The gated request presents a different prefix from the following request, so its prefix cache is cold. From the first promoted request onward the prefix is stable again, which is why the gate opens on a durable signal rather than after a fixed number of steps.

## Known Limitations and Deferred Work

### Skill invocations survive by default

`skill-invocation` is allowed through the gate by default because a user-initiated gesture is not an automatic injection, and the per-step claim would otherwise lose the skill content. Set `allowKinds: []` to strip it as well.

### No published invariant

The plugin registers two waterfall listeners and holds no state of its own; the promotion phase it reads belongs to the shared projection. There is no second observation of either that could diverge, so no `./invariant` source is published.
