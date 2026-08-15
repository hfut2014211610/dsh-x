# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

Model usage settings plugin, browser half. It registers the Usage page in the settings interface: a GLOBAL view of model token consumption assembled from every session-list row's `usageStats` projection value — the host folds per-request records (token buckets, dispatched route, model wall time), so the page aggregates them client-side without a new host endpoint, and it is session-blind by design: sessions contribute their requests, never their identity. A statistics-window selector (7 days / 28 days / 90 days / all, default 28) bounds every figure: the summary strip totals sessions, requests, input/cache-read/cache-write/output/reasoning tokens, and model wall time over the window; the day-bucketed dot heatmap draws one dot per window day (capped at 28) with intensity graded in quadrants of the window's busiest day, and each dot carries a hover tooltip naming its relative day and that day's prompt/output totals; the detail table carries one aggregate row per model. Switching the window re-aggregates the last good rows offline — no wire traffic. Missing buckets render as `—`, never 0: an absent count is a reporting gap, not a measured zero.

The page only reads: it loads on open, refetches after a connection reset, and refreshes on demand; there is no write surface. Values arrive exactly as the projection seam serves them — attached sessions live, cold sessions as stale as their last persisted projection checkpoint (`asOfSeq` says how stale) — and the intro line says so.

## Model Experience

None, as the section renders a browser read-only panel over wire-delivered projection values; nothing here reaches a model request.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **One list page, not full pagination** — the store reads a single `session.list` page; deployments whose first page cannot hold every session under-report the totals until pagination support is added.
- **No live push into the panel** — the projection seam pushes per-session frames to conversation surfaces, but the settings scope holds no session, so the panel refetches on open/reset/demand rather than streaming; an open panel does not follow an active session's newest requests.
- **Cold-session freshness is checkpoint-bound** — detached sessions show their last persisted projection checkpoint; the panel says so once, in the intro line, rather than per row.
- **The heatmap is day-grained and capped at 28 dots** — intra-day intensity collapses into one dot per day, the 90-day and all-time windows still draw 28 dots (their totals and model rows span the full window), and tooltip day names are relative so no wall-clock date ever renders.
- **Auxiliary LLM calls are unbilled and unmarked** — title-generation and search-LLM consumption stays outside `usageStats` (their events log no usage), so the panel cannot even flag the gap.
