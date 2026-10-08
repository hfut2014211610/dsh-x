# @deepseek-ai/dsh-ued-mode

English | [中文](README.zh.md)

## Summary

`ued-mode` contributes the UED-mode policy section to the system prompt: the concurrency model for iterative UI design work, plus the two hazards that concurrency creates and that no tool's own contract covers.

Design work arrives as many small revision instructions rather than one generation request, so this preset's value is that each revision runs in its own continuable child while the parent session stays answerable.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
- [Understand the implementation](#understand-the-implementation)
  - [The two hazards](#the-two-hazards)
  - [Why this is policy](#why-this-is-policy)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The policy section](#the-policy-section)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [The policy is advisory](#the-policy-is-advisory)
  - [The tool names must match the composition](#the-tool-names-must-match-the-composition)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

The section is inserted at order 90: after the deployment persona and before tool guidance, so it frames the work rather than the available tools. Mount it alongside the persona row in a UED composition.

```yaml
- id: ued-mode
  name: '@deepseek-ai/dsh-ued-mode'
  config:
    delegationTool: subagent
    maxActiveThreads: 4
```

### Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `delegationTool` | required | The model-facing name of this preset's subagent tool instance. |
| `maxActiveThreads` | required, at least 1 | How many design threads may run at once. |

Both fields are required, and an empty tool name fails at mount. An unknown key fails at mount too: a typo in `delegationTool` would otherwise reach the prompt as a tool the model is told to call and cannot find.

## Understand the implementation

### The two hazards

**Lost writes.** `documents` guards writes by version, so a losing edit fails with `DOCUMENT_STALE_VERSION` instead of clobbering. The recovery is re-reading and re-applying on top of the current content; writing back what was read before the failure is exactly the lost update the guard exists to prevent.

**Conflicting intent.** The guard says nothing about two threads told to restyle the same button. Both succeed, and the later write silently replaces the earlier one. Nothing in the runtime can detect that, so the policy sends the model back to the user before it happens.

### Why this is policy

Neither hazard is a tool defect, so no tool contract can express either fix. That is why this is a prompt section rather than a wrapper: the model is told the recovery procedure, the ordering preference, and the one case where it must ask a human.

The section also fixes the artifact rules — one self-contained HTML file per screen, edited only through the document tools — and the settlement rule: a thread keeps working after the turn ends, so its artifact must not be read to check on it before its notice arrives.

## Further Exploration

- The prompt registry this contributes to: `packages/core/system-prompt`
- The subagent tools the policy names: `packages/subagent/tool-subagent`
- The version-guarded document tools: `packages/writing/tool-documents`
- Design note: `personal/docs/notes/proposed/2026-08-18-ued-mode.md`

## Model Experience

### The policy section

The model reads the artifact rules, the concurrency model with this deployment's own tool name and thread cap, the settlement rule, and a three-step conflict procedure ending in an instruction to stop and ask the user before two threads change the same visual element.

### Token effect

The section is roughly 500 words and sits in the system prompt for every request of a UED session. It is the reason the concurrency model produces coherent multi-thread artifacts rather than clobbering each other, so it is paid for on every request rather than once.

### KV Cache effect

The text is fixed for a deployment — only the tool name and the cap vary — so it is part of the stable prefix and costs nothing beyond its first occurrence. A deployment that changes either value changes the prefix once.

## Known Limitations and Deferred Work

### The policy is advisory

Nothing enforces the conflict procedure. A model that ignores "stop and ask the user" still produces a silently clobbered prototype; the section only makes the right action the one the model reads.

### The tool names must match the composition

`delegationTool` is checked for presence and emptiness but not against the mounted tools: nothing verifies that a tool of that name exists in the same composition. A row naming an instance the composition does not mount yields a policy telling the model to call a tool it cannot see.

### No published invariant

The plugin registers one prompt section and holds no state. There is no second observation of the registration that could diverge, so no `./invariant` source is published; the prompt registry owns disposal for every section it accepts.