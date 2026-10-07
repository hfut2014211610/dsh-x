# @deepseek-ai/dsh-tool-dev-search

English | [中文](README.zh.md)

## Summary

`tool-dev-search` registers one model-facing tool, `dev_tool_search`, which searches the full assembled catalog by keyword and returns matching tool names, and which unlocks tools by exact name.

It exists because the anchored preset's promoted phase keeps only a minimal resident set instead of dumping the whole Standard catalog at once. This tool is how the model reaches everything else.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Arguments](#arguments)
- [Understand the implementation](#understand-the-implementation)
  - [What the model sees first](#what-the-model-sees-first)
  - [Search](#search)
  - [Unlock](#unlock)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The discovery round trip](#the-discovery-round-trip)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Unlock takes effect on the next request](#unlock-takes-effect-on-the-next-request)
  - [Search sees one scope](#search-sees-one-scope)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

This is one of the three discovery tools that stay resident after promotion, so it belongs in the same composition as the tool bootstrap that keeps it resident.

```yaml
- id: tool-dev-search
  name: '@deepseek-ai/dsh-tool-dev-search'
```

The tools registry must exist before this tool registers; the plugin declares it as an injection, so mounting it without a registry leaves the row inert rather than failing.

### Arguments

| Argument | Type | Effect |
| --- | --- | --- |
| `query` | string | Search keywords. Every token must appear in a tool's name or description. |
| `toolNames` | string array | Exact tool names to unlock. |

Both are optional. A call with neither returns a usage hint. A call with only `toolNames` confirms the unlock and skips the search. Arguments are model-produced JSON, so a non-string `query` and a non-array `toolNames` contribute nothing rather than failing the call.

## Understand the implementation

### What the model sees first

The tool description is an INDEX rather than a catalog: it lists the capability areas the minimal resident set cannot cover — internet search, delegation, workflows, iterative loops, goals, images, background jobs, multi-agent control, task tracking, and asking the user — and tells the model to call this tool FIRST instead of working around them with bash.

That way the model knows what exists without a full catalog dump.

### Search

Search lowercases the query, splits it on non-alphanumeric characters, and keeps every schema whose name plus description contains all of the resulting tokens. At most 25 matches are returned; a truncated list says so and suggests narrowing.

The executing agent IS the viewing scope. Preset tools register into the agent-scope layer of the registry, and a scope-less read sees only the global layer — every preset-provided tool would be invisible. Each match contributes its name and the first 90 characters of its first description line.

A search that throws reports one line naming the failure instead of failing the call.

### Unlock

An unlock is not a registry mutation. It is recorded as this call's own durable `tool/call` arguments, and the companion tool-bootstrap filter folds those names out of the log, which makes the unlock resume-safe: a reloaded session still has them.

## Further Exploration

- The catalog filter that consumes unlocks: `packages/tool/tool-bootstrap`
- The resident set this tool belongs to: `packages/guard/context-gate`
- Tool registration and execution: `packages/core/tools`

## Model Experience

### The discovery round trip

The model calls `dev_tool_search` with keywords, receives up to 25 matching tool names with one-line descriptions, and calls it again with the exact names it wants. From the next request on those tools appear in the catalog for the rest of the session.

### Token effect

The index in the tool description is paid on every request, because it is part of the schema. A search returns at most 25 one-line matches, which bounds the round-trip cost; without the index the model would have to guess whether a capability exists at all.

### KV Cache effect

The tool is resident across the whole session, so its schema is in the cached prefix from the second request onward and does not invalidate the prefix as more tools are unlocked. The unlock itself changes the tool list, which does start a new prefix — once per unlock call.

## Known Limitations and Deferred Work

### Unlock takes effect on the next request

The call that unlocks a tool still runs with the catalog it had when the request began. The deployment can only widen the catalog for subsequent requests.

### Search sees one scope

Search reads the executing agent's scope, so a tool registered outside that scope is invisible to it. That is the correct layering for a preset tool, and it means a tool mounted globally is searchable while one mounted into a different agent's scope is not.

### No published invariant

The plugin registers one tool and holds no state. There is no second observation of the registration that could diverge, so no `./invariant` source is published; the tools registry owns disposal for every registration it accepts.