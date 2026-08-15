# Agent Note: Usage statistics fold from the session log and surface in the settings interface

Status: implemented

English | [中文](2026-08-14-usage-stats-session-projection-and-command.zh.md)

## Problem

The harness reported token consumption only as session-granular totals: token-meter's `tokenUsage` unit accumulates provider buckets and session-stats publishes wall times, but no surface answers "what did each model request cost" — per-request input/cache/output splits, the route a request ran on, and its latency. Codex/zcode-style usage panels need exactly that request-granular view, and the requested presentation is a settings-interface page every web user can open, not a per-session command.

## Decision

Two packages, one seam each:

- **Data** (`@deepseek-ai/dsh-usage-stats`, packages/session/usage-stats): a `usageStats` session-projection unit folds existing log events into one record per model request — `assistant/chunk` usage reports create or update the step's record early (a request that streamed usage and then failed stays billed), `assistant/message` settles it with the final usage and `llmMs` (`step/start` → message, the boundary session-stats already sums), and `request/context` supplies the dispatched provider/model and context window (last-wins, logged only on route change). No new session event, no runtime interception, no `SESSION_FORMAT_VERSION` movement: everything reconstructs from the durable log, so the projection rides the registry's watermark cache, persisted checkpoints, and change feed for free. The `./client` face mirrors the types for browser consumers.
- **Presentation** (`@deepseek-ai/dsh-client-ui-settings-usage`, packages/client/ui-settings-usage): a Usage section in the settings interface (slot `settings.section`, id `usage`, order 25) aggregating the session-list rows' `usageStats` projection values into one GLOBAL view — a statistics-window selector (7 days / 28 days / 90 days / all, default 28) bounding every figure, a whole-list summary strip, a day-bucketed dot heatmap (one dot per window day, capped at 28; intensity graded in quadrants of the window's busiest day; each dot carries a hover tooltip naming its relative day and buckets, cells aria-hidden so goldens carry no wall-clock dates), and a detail table with one aggregate row per model. Switching the window re-aggregates the store's last good rows offline. The panel is session-blind: sessions contribute their requests, never their identity, and the per-session/per-request drill-down an earlier iteration rendered was dropped for this model-level view. The store reads one `session.list` page; every row already carries its projection block, so no new host endpoint exists.

The session-list carrier is the load-bearing choice: `session.list` serves projection values for attached sessions from the live registry cut and for cold sessions from the persisted projection cache, so a settings-scope panel (which holds no session) sees every session without `useProjection`'s session scope. The web-app bundle mounts the host unit beside session-stats; the base bundle stays without it (no consumer there).

## Alternatives considered

- **A `/usage` command** (`CommandResult.text` Markdown): built first, then replaced per review direction — a command is per-session UI text, not a settings surface; the fold carried over unchanged.
- **Per-session rows with expandable per-turn bars and a per-request table**: built second, then replaced per review direction — the requested view is global with the model as the only breakdown axis; the global aggregation and the day-bucketed heatmap replaced the session drill-down.
- **`useProjection('usageStats')` in the panel**: rejected — the projections face exists only inside a session scope (`SessionProvider` subtree); the settings modal is session-less by construction.
- **Intercept `llm/stream`** for per-request latency and usage: rejected — runtime interception duplicates what the log already records and breaks replay equivalence; the projection seam already drives state from committed events.
- **Extend token-meter's `tokenUsage` unit** with per-request records: rejected — that unit's value is O(1) bucket totals; a growing request array would change its contract for every existing consumer, while a separate key costs nothing.

## Consequences

- `usageStats` records replace, not accumulate, repeated usage samples for one step (the token-meter adjacency invariant), so a retried step reports its final attempt; auxiliary LLM calls (title, search) stay unbilled because their events carry no usage.
- The panel reads exactly the list rows the sidebar reads: cold-session freshness is checkpoint-bound (`asOfSeq` discloses it in the intro line), one list page bounds the totals, and an open panel does not stream an active session's newest requests (refresh on open/reset/demand).
- The web e2e (`apps/web/tests/usage-settings.e2e.ts`) seeds a three-request, two-model session with a projection-cache row: `seedSession` now folds the seed once through the booted host's registry via a store-detached `prepare`d session and checkpoints through the host's own cache service, so the cold row carries title and usageStats with zero host-side log loads. Older fixtures that predate the identified-message envelope skip the cache step (their cold rows carry no projections, exactly the prior behavior).
- Hand-written seeds may stamp event times relative to the run instant (`{{now}}` / `{{now-<ms>}}`, landed as JSON numbers): day-windowed views and their goldens never age out of a fixed recorded timestamp, and `assertFixtureInventory` stands the tokens in before its parse-based header scrub.
- `realizeSeedFixture` now JSON-escapes the substituted workspace path, fixing seeded fixtures on backslash hosts (Windows) where a bare join corrupted the header line's JSON.
- Cross-session aggregation stays client-side; any server-side global fold would be a new persistence decision.
