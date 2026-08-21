# Agent Note: Werewolf stage 2 — one-shot bot runner and observation projection

Status: implemented

English | [中文](2026-08-21-werewolf-bot-runner.zh.md)

## Problem

Stage 1 proved the deterministic rules but every bot decision was a scripted callback. Real play needs model-backed bots under the subagent seam's one-shot contract, and the acceptance criteria for that seam are strict: each child sees only its authorized observation, returns one structured envelope, cannot act illegally even when the model tries, retries without leaking the previous child's free text, and settles by a visible fallback instead of silent degradation. None of that can ride on the parent agent — the parent model must stay out of game input entirely.

## Decision

Three additions to `@deepseek-ai/dsh-werewolf`, all behind the existing event vocabulary:

1. **Observation projection is a pure function of the folded state.** `projectWerewolfBotObservation` builds the complete `WerewolfBotPromptV1`: the actor's role and private knowledge come from the registered role projector, teammates are supplied only when the compiled role declares `seesFactionTeammates`, the public state carries roster facts plus a configured trailing timeline slice, and the legal action serializes the closed spec vocabulary. Isolation tests compare serialized prompts against forbidden content (another seat's role or faction, a sibling's context) rather than checking expected fields only.
2. **The runner treats model output as untrusted data at every boundary.** `runWerewolfBotDecision` starts a fresh child through `ctx.subagents.start()` with the object-rooted output schema derived from the closed spec vocabulary (the schema subset forced `enum` nodes to carry `type`), the fixed persona, `toolFilter: { allow: [] }`, a delegation-depth cap of `delegationDepthOf(parent) + 1`, and the optional per-child route. Envelopes are parsed strictly (unknown keys reject), validated action-first and delta-second, and each failure appends a detached `werewolf/bot-attempt-failed` payload with one exact category; a rejecting child result settles as `result-rejected` rather than an unhandled rejection. Retries reuse the logical decision id, increment the attempt number, and prepend only a one-line diagnostic — never the prior child's output.
3. **Fallback and cancellation are visible facts.** After the configured retry budget, `auto-action` commits a deterministic trustee action (first legal value per spec kind) with an engine-authored context delta and `trustee: true`; `pause-game` returns a pause request for the caller to append. Caller-signal cancellation disposes the in-flight child and returns `cancelled`; a late result after timeout or disposal cannot alter anything because the attempt already settled. The runtime gained a validated schemastery `Config` (provider name, per-child route, retry budget, timeout, fallback policy, context limits, concurrency, timeline bound) exposed through `botRunnerConfig()`; game start will assert the provider's four capabilities before the first event once the stage-3 controller wires session flow.

## Consequences

- The stage-2 acceptance proof holds in tests: decision N's accepted `contextAfter` is the `priorContext` decision N+1 receives, the sibling bot's context stays untouched, and the sibling's captured prompt never contains the first bot's private delta.
- One fresh child session exists per attempt, labeled `werewolf <phase> seat <n> attempt <k>`; the parent session's model history is untouched by construction.
- The runner returns detached payloads only — the stage-3 controller owns appending them, the retry-epoch budget, and pause/resume durability.
- `maxConcurrentBots` is validated configuration but serial execution in tests; the parallel coordinator that honors it lands with the stage-3 controller.

## Alternatives considered

**Validate envelopes inside the commit path only.** The engine's commit already rejects illegal actions, but retry classification needs the exact category before the next child starts; validating in the runner keeps retries cheap and the log clean.

**A continuable child session per bot.** Rejected for the same reasons as the original proposal: no per-decision structured contract and a growing injection surface.

**Trust the provider's schema validation as the legality check.** The provider validates shape; legality (target membership, speech bounds) is game authority and stays in the engine's closed vocabulary, which also keeps the schema generator inside the enforced JSON-Schema subset.
