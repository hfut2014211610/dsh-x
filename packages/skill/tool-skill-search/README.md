# @deepseek-ai/dsh-tool-skill-search

English | [中文](README.zh.md)

## Summary

`tool-skill-search` replaces the skill catalog that `@deepseek-ai/dsh-tool-skill` injects into the prompt with two small tools: `skill_search` for finding skills and `skill_load` for activating one.

The catalog is roughly 9KB with many skills, and its presence perturbs the trajectory: the upstream reproduction measured 0/9 sessions anchored with the catalog present against roughly 81% without it. This package removes the injection entirely.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Arguments](#arguments)
  - [Visibility](#visibility)
- [Understand the implementation](#understand-the-implementation)
  - [Search](#search)
  - [Load](#load)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [Discovery instead of a catalog](#discovery-instead-of-a-catalog)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [This row replaces the tool-skill row](#this-row-replaces-the-tool-skill-row)
  - [Search is substring matching](#search-is-substring-matching)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

These are two of the three discovery tools that stay resident after promotion, so they belong with the tool bootstrap that keeps them resident.

```yaml
- id: tool-skill-search
  name: '@deepseek-ai/dsh-tool-skill-search'
```

**Do not also mount `dsh-tool-skill`.** The two are alternatives: mounting both brings the catalog injection back and defeats the whole point.

The agent, tools, and skills services must all exist. The plugin declares them as injections, so a composition without a skills registry leaves the row unmounted rather than half-working.

### Arguments

| Tool | Argument | Type | Effect |
| --- | --- | --- | --- |
| `skill_search` | `query` | string, required | Search keywords. Every token must appear in a skill's name, description, or when-to-use text. An empty query lists every visible skill. |
| `skill_load` | `name` | string, required | Exact kebab-case skill name from `skill_search` results. |

Arguments are model-produced JSON, so a non-string value reads as empty: search then matches everything visible, and load then reports no such skill.

### Visibility

Only skills whose invocation is model-invocable reach the model, the same rule `dsh-tool-skill` applied. A user-only skill never appears in `skill_search` results and is refused by `skill_load`, naming the reason.

Discovery reads the registry scoped to the calling agent, so a skill contributed into another agent's scope is not visible here.

## Understand the implementation

### Search

The query is lowercased and split on non-alphanumeric characters, and a skill matches when every resulting token appears in its tokenized name, description, and when-to-use text together. At most 20 skills are listed, each as its name and the first line of its description; a longer match set reports how many were left out.

### Load

`skill_load` resolves the exact name through the registry, checks the model-invocation rule, and queues the rendered skill body into the agent's non-waking next-step inbox under the shared `skill-invocation` source — the same injection `dsh-tool-skill` produced. The body is rendered by the harness's own `renderSkillContent`, so the model sees one canonical `<skill_content>` shape whichever path loaded the skill.

Both tools report an unavailable registry as one line of text rather than failing the call.

## Further Exploration

- The catalog injection this replaces: `packages/skill/tool-skill`
- The resident set these tools belong to: `packages/tool/tool-bootstrap`
- Skill registry and providers: `packages/skill/skill`

## Model Experience

### Discovery instead of a catalog

The model is told that no catalog exists in its prompt and is instructed to call `skill_search` first when a task looks like it matches a skill. It receives up to 20 names with one-line descriptions, then calls `skill_load` with the exact name; that skill's instructions arrive for the next request.

### Token effect

The saving is the whole catalog: roughly 9KB with many skills, previously repeated on the first step of every turn and after every promotion and compaction. This package spends that instead on two short tool descriptions plus the specific bodies the model asks for.

### KV Cache effect

Removing the catalog changes the prompt prefix, which is the point: the anchored first request and the post-promotion request both start from a stable short prefix. Loading a skill adds its body to the next request's messages, so that request's prefix grows by exactly the skill the model asked for.

## Known Limitations and Deferred Work

### This row replaces the tool-skill row

The package cannot enforce that `dsh-tool-skill` is absent from the same composition. Mounting both restores the catalog injection and the row's stated benefit disappears, with nothing at runtime saying so.

### Search is substring matching

Tokens are matched as substrings of the whole tokenized text, so an English word matches inside a longer one and a query in another script matches nothing. There is no stemming, no fuzzy matching, and no ranking beyond registration order.

### No published invariant

The plugin registers two tools and holds no state. There is no second observation of the registrations that could diverge, so no `./invariant` source is published; the tools registry owns disposal for every registration it accepts.