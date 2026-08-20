# @deepseek-ai/dsh-model-tuning

English | [中文](README.zh.md)

Per-model sampling defaults: the configuration surface the stock `llm-pi-ai` deliberately does not carry (per-model `temperature` / `maxTokens` / `stop` / `reasoningEffort`).

## How it works

- Registers the `dsh-x-model-tuning` settings namespace. The cordis patch's `config:` block is the composition base and the `dsh-x-model-tuning:` section of `$DSH_HOME/settings.yaml` is the user layer; they merge by key and a change takes effect on the next request.
- Matches an entry by `provider/model` on the `agent/request` waterfall — the sanctioned place to rewrite a request's configuration, the same mechanism `packages/core/agent/src/model-selection.ts` uses — and replaces the effective configuration. The values reach the logged request header, which is what keeps the model-visible ⟺ logged invariant intact.
- The `/model-tuning` slash command writes through the settings seam, so it gets validation, persistence, and hot reload for free.

## Loading

The Web bundle mounts this package by default; an empty `profiles` map is dormant and costs nothing. To mount it over another composition:

```sh
# One run (overlay):
pnpm dsh web --patch ./packages/llm/model-tuning/cordis.patch.yml

# Persistent: append the insert rows from cordis.patch.yml to
# ~/.dsh/profiles/<name>/cordis.patch.yml
```

## Configuration

```yaml
dsh-x-model-tuning:
  profiles:
    deepseek/deepseek-chat:      # key = provider/model, split at the first /
      temperature: 0.6           # 0..2
      maxTokens: 8192            # positive integer
      reasoningEffort: high      # off|minimal|low|medium|high|xhigh|max
      stop: ["<END>"]            # an empty array means no opinion
```

A field an entry declares overrides every request to that model; a field it omits passes through untouched, so a reasoning effort chosen in the UI survives unless the entry declares its own. A malformed key — no `/`, or an empty side — is refused at write time and named. An effort the model does not offer fails the request loud with `UNSUPPORTED_REASONING_EFFORT` from the adapter.

## Commands

```
/model-tuning                                          show the current entries
/model-tuning set <provider/model> <field> <value>     set one field (stop takes space-separated values)
/model-tuning unset <provider/model> [field]           drop one field, or the whole entry
```

## Tests

```sh
pnpm exec vitest run packages/llm/model-tuning
```

## Boundaries

- Only the four `LlmCallConfig` fields. Protocol, endpoint, context window, and thinking-level vocabulary belong to the stock `llm-pi-ai` section.
- Vendor-specific body parameters (`top_p`, `enable_search`, and the like) are not in the sanctioned request vocabulary, so this package cannot inject them. Needing one means writing an `LlmAdapter`, which is a much larger undertaking.
