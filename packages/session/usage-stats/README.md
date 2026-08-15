# @deepseek-ai/dsh-usage-stats

English | [中文](README.zh.md)

Function plugin registering the `usageStats` projection unit: one record per model request — the provider-reported token accounting, the dispatched provider/model, and the model wall time — folded from the durable session log and served through the session-projection seam (registry snapshot, change feed, and every projection carrier: history tail pages, `session/projection` push frames, session list rows). The reference consumer is the web settings usage panel (`dsh-client-ui-settings-usage`), which reads the per-session values the session-list rows carry; nothing here reaches a model request.

## Fold semantics

- One record exists per step that reported usage or assembled a message. An `assistant/chunk` usage report creates or updates the step's record early, so a request that streamed usage and then failed stays billed; the `assistant/message` settles the same record with the final usage and `llmMs` (`step/start` → message, the boundary session-stats sums).
- Matching checks only the last record: usage reports for one turn/step are adjacent in a legal log (the invariant token-meter's replacement slot relies on), so a repeated sample replaces the step's earlier value instead of double counting it. A message without usage keeps an earlier chunk's sample.
- `provider`/`model` ride the latest `request/context` (logged only on route or capacity change), which is the route the step actually dispatched on; both are null before the first context lands. `contextWindow` follows the same last-wins rule and is null when never advertised.
- `time` is the record's latest contributing event's time, kept for external consumers; `usage` is null when no report reached the log, and such a record still counts as a request and still carries its timing.

## Composition

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers. Mounted in the web-app bundle, where the settings usage panel consumes it; other assemblies serve no `usageStats` key and clients read that as capability absence.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Auxiliary LLM calls are unbilled** — `session/title-llm-request` and `web/deepseek-search-llm-request` log no usage, so title generation and search-LLM consumption stay outside these figures until those events carry accounting.
- **`cacheWriteTokens` stays absent on DeepSeek** — the adapter has no wire field to fill it from, so the bucket reads empty on DeepSeek sessions and only pi-ai-backed routes can populate it.
- **A retried step reports its final attempt** — retries stay inside one step, and replacement semantics keep the last usage sample, so earlier failed attempts of the same step that somehow reported usage are overwritten rather than summed.
- **Session-scoped records, no cross-session fold** — the unit describes one session's whole log; the settings panel aggregates list rows client-side, and any server-side global aggregation would need a new persistence layer.
- **Cold-session freshness is checkpoint-bound** — detached sessions surface their last persisted projection checkpoint (`asOfSeq` says how stale); attached sessions are live.
