# @deepseek-ai/dsh-session-guide

English | [中文](README.zh.md)

## Summary

`session-guide` appends one short guidance line immediately after each real user message, once the session is promoted.

**DISABLED BY DEFAULT.** The composition mounts this row with `disabled: true`. Read the [Why it is off](#why-it-is-off) section before turning it on — the evidence behind this row's text is weaker than the evidence behind the rest of the preset.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Why it is off](#why-it-is-off)
- [Understand the implementation](#understand-the-implementation)
  - [Placement](#placement)
  - [One guidance per user turn](#one-guidance-per-user-turn)
  - [The complex-message dispatch](#the-complex-message-dispatch)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The guidance line](#the-guidance-line)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [The text is a starting point](#the-text-is-a-starting-point)
  - [The complex heuristic is crude](#the-complex-heuristic-is-crude)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

The plugin prepends its `agent/pre-step` listener, so it registers after the context gate and tool bootstrap and runs inside their transforms.

```yaml
- id: session-guide
  name: '@deepseek-ai/dsh-session-guide'
  disabled: true
```

The composition must mount the session projection registry; the plugin fails loudly without it.

### Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `text` | three-anchor text | The guidance line. |
| `complexText` | absent | Second line used when the user message looks complex. One line for every message when absent. |
| `complexPattern` | absent | Regex source marking a message complex. Compiled at mount. |
| `complexLengthThreshold` | `120` | Character count above which a message is complex. Consulted only with `complexText`. |
| `promoteOn` | `either` | Which durable signal promotes the session first. |
| `includeSubagents` | `false` | Whether subagents follow the same phase. |
| `enabled` | `true` | `false` keeps the row mounted and inert, for A/B without editing the row set. |

An unknown key, an empty `text` or `complexText`, an uncompilable `complexPattern`, and a non-positive threshold all fail when the row mounts.

### Subagents

A subagent (`delegationDepth > 0`) reads as promoted, so it receives guidance from its first turn. Set `includeSubagents: true` to make it wait for its own promotion signal.

## Why it is off

Three reasons, in order of weight.

**The mechanism is unverified here.** Nothing in this fork has measured the context dilution this row is supposed to counteract, let alone this remedy for it. `personal/probe/` exists to establish that baseline first; turning this on before it is measured replaces one unproven assumption with two.

**Upstream's own data says the effect inverts by model.** The recall and convergence anchors lift Flash, while the same anchors scored a Pro suite below the naked configuration. A default-on row would silently apply the harmful arm to half the routes.

**The published implementation of the idea does not run.** In `dsh-router-standard` v0.3.0, `preset/router-standard/router-bootstrap.mjs` calls `bandOf` and `extractText` in its `session/event` handler while importing neither, so the handler throws before injecting anything. The mechanism here is written from that preset's description, not ported from its code, and its numbers were never observed by anyone.

So: measure with `personal/probe/compare-presets.ts`, turn the row on, measure again.

## Understand the implementation

### Placement

The guidance enters through the `agent/pre-step` waterfall and is spliced immediately after the step's claimed message batch, at the same position and for the same reason as `@deepseek-ai/dsh-agent-instructions`: the user's own prompt precedes it, driver-appended runtime context follows it.

That position is why this is a suffix and not a system-prompt edit. A pre-step message is durable, so turn N's guidance is still in history at turn N+1 and the shared prefix only grows.

### One guidance per user turn

A step that claims no user message is a tool continuation: the guidance for that turn is already in history, so the plugin injects nothing.

For a step that does claim a user message, the guidance records which message it follows. A session projection holds the durable set of already-guided message ids, so a resume or reload finds its own guidance; a small in-process delta covers the gap before the loop's `session/event` fold reaches the unit.

Nothing is injected before promotion, and a `compaction/end` boundary demotes the session, so the first post-compaction request is clean too.

### The complex-message dispatch

Depth dispatch is consulted only when `complexText` is configured. The heuristic is crude on purpose — length plus an optional caller-supplied keyword pattern. Upstream ships a bilingual keyword list tuned on its own routes; baking that list in would import their tuning as if it were a finding, so the pattern is left to the operator.

### Failure behavior

Every failure injects nothing for that turn and warns once. Downstream listener errors propagate untouched.

## Further Exploration

- The promotion phase this plugin waits for: `packages/compaction/compaction-epoch`
- The gate that would strip the guidance while unpromoted: `packages/guard/context-gate`
- The placement rule it mirrors: `packages/context/agent-instructions`
- Waterfall semantics: `docs/cordis-primer.md`

## Model Experience

### The guidance line

Immediately after each real user message, once the session is promoted, the model receives one line recalling what it has already done, telling it not to repeat completed steps, not to spend reasoning on environment checks, and to produce when its information is complete. A configured `complexText` replaces that line for messages the operator marked complex.

### Token effect

The line is roughly forty tokens and is paid once per user turn for the whole session. It is a suffix, so it does not displace anything from the cached prefix; the cost is additive per turn.

### KV Cache effect

None. The guidance is spliced into the step's messages after the already-cached claimed batch, so the shared prefix is untouched and grows only by the guidance itself.

## Known Limitations and Deferred Work

### The text is a starting point

The default text reproduces the three anchors described by `dsh-router-standard`, whose published implementation does not run and whose effect inverts by model. Treat it as a hypothesis to measure, not a tuned string.

### The complex heuristic is crude

Length plus a keyword pattern is all this offers. A message can be short and complex, or long and simple; the row has no other signal, and no measurement yet says which of those mistakes matters more.

### No published invariant

The plugin owns one projection unit and a small in-process delta with no durable counterpart. There is no second observation that could diverge, so no `./invariant` source is published; the projection registry cross-checks the unit it owns.
