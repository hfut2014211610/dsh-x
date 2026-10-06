# @deepseek-ai/dsh-tool-bootstrap

English | [中文](README.zh.md)

## Summary

`tool-bootstrap` keeps a session's first model request of each compaction epoch on the Minimal preset's REAL tool schema — the persistent `bash` shell plus `str_replace_editor` — then narrows the catalog to a minimal resident set once the session has produced its first durable promotion signal.

Injected-context control is NOT this plugin's concern. The companion `@deepseek-ai/dsh-context-gate` plugin owns it, keyed to the same promotion phase.

Mount it right AFTER the context-gate row. Waterfall after-next transforms apply in reverse registration order, so this row must register before any plugin that touches the same assembly.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Understand the implementation](#understand-the-implementation)
  - [The three phases](#the-three-phases)
  - [The resident set](#the-resident-set)
  - [The optional output cap](#the-optional-output-cap)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [Tool catalog across a session](#tool-catalog-across-a-session)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [file tools are not resident](#file-tools-are-not-resident)
  - [The unlock set is per session](#the-unlock-set-is-per-session)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

Add the row directly after the context-gate row:

```yaml
- id: tool-bootstrap
  name: '@deepseek-ai/dsh-tool-bootstrap'
  config:
    bootstrapTools: [bash, str_replace_editor]
```

The plugin declares no service injections, so it applies before the tools that populate the catalog. The composition must mount the session projection registry; the plugin fails loudly without it, because it cannot decide a phase without it.

### Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `bootstrapTools` | required | Tool names exposed on the controlled first request of each epoch. An empty list fails at mount. |
| `promoteOn` | `either` | Which durable signal promotes: `tool-call`, `assistant-message`, or `either`. |
| `bootstrapMaxTokens` | omitted | First-request output cap. Omit to let the adapter default flow. |
| `compactionTools` | none | Tools added to the controlled phase after a compaction, before re-promotion. |
| `includeSubagents` | `false` | Whether subagents follow the controlled phase instead of starting resident. |

An unknown key, an empty `bootstrapTools`, and a non-positive `bootstrapMaxTokens` all fail when the row mounts.

### Subagents

A subagent (`delegationDepth > 0`) starts on the resident set: its first request already sees the full catalog. Set `includeSubagents: true` to put it through the controlled phase as well. Keep this flag equal to the companion context-gate row's flag — a mismatch lets a delegation reintroduce an uncontrolled first request.

## Understand the implementation

### The three phases

**Controlled** (before any promotion signal): the catalog is exactly `bootstrapTools`.

**Resident** (after a promotion signal): the bootstrap pair, the three discovery tools, and whatever the model unlocked.

**Compacted** (after a `compaction/end`, before a new promotion signal): the bootstrap pair plus `compactionTools`. The model is mid-task and needs to keep working, but still faces a small catalog.

### The resident set

Promotion does NOT dump the whole Standard catalog at once — that dump pulls the trajectory back to standard-like behavior. The resident set is the bootstrap pair plus `dev_tool_search`, `skill_search`, `skill_load`, plus every name the model passed to `dev_tool_search`. Heavier Standard tools are one `dev_tool_search` call away.

The unlocked names are a session projection folded from durable `tool/call` events, so resume and reload keep them. A `tool/call` records the raw JSON string the model produced, so unreadable arguments — malformed JSON, a non-object, a `toolNames` that is not an array of non-empty strings — contribute nothing rather than failing the request.

### The optional output cap

On the official endpoint the first request's `max_tokens` also dominated the trajectory anchor at 1024, while the Minimal tool schema anchors at 256000 WITHOUT any cap. The cap is therefore opt-in. When set, the listener prepends so a later listener cannot override the first-round budget, and the cap is stripped again after promotion — the next request's seed proposal carries the previous header's `maxTokens` forward, so the release must be explicit. A budget that is not the cap this plugin set is left alone.

### Failure behavior

A missing tool in the controlled phase degrades to the full catalog with a one-time warning, because a composition drift must never brick every request of a session. A missing tool in the resident phase warns and filters anyway. Any other failure of the filter exposes the full catalog. Downstream listener errors propagate untouched.

## Further Exploration

- The shared promotion state: `packages/compaction/compaction-epoch`
- The companion injection gate: `packages/guard/context-gate`
- Waterfall semantics: `docs/cordis-primer.md`

## Model Experience

### Tool catalog across a session

The first request of each compaction epoch offers the model exactly two tools: a persistent shell and a str_replace_editor. At the first promotion signal the catalog widens to those two plus `dev_tool_search`, `skill_search`, `skill_load`, and any tool the model has already unlocked. After a compaction it narrows back to the two, plus `compactionTools` when the deployment configured them.

### Token effect

A two-tool schema sends fewer tool definitions than a Standard-family schema, which is the saving the first request sees. Tool schemas are cached in the prompt prefix, so the effect is largest on the first request and on the request after a compaction.

### KV Cache effect

The controlled phase's two-tool prefix differs from the resident phase's wider prefix, so the first promoted request after a narrowing or widening starts a new prefix. `bootstrapMaxTokens` changes the request's output budget, not the prefix.

## Known Limitations and Deferred Work

### file tools are not resident

`read`, `write`, `edit`, `glob`, `grep`, `todo`, and `ask` are deliberately absent from the resident set: bash plus str_replace_editor cover file work. A deployment that prefers them can list them in `compactionTools` or bootstrap them explicitly.

### The unlock set is per session

Unlocked names are folded per session, so a new session starts from the discovery tools again. The fold reads `tool/call` events only; an unlock the model performed but never called leaves no trace to recover.

### No published invariant

The plugin registers a catalog filter, an optional request filter, and two projections whose state it does not own beyond registration. There is no second observation of any of them that could diverge, so no `./invariant` source is published; the projection registry cross-checks the two units it owns.
