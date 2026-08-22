# Agent Note: Werewolf stage 2 — one-shot bot runner and observation projection

Status: implemented

English | [中文](2026-08-21-werewolf-bot-runner.zh.md)

## Problem

Stage 1 proved the deterministic rules but every bot decision was a scripted callback. Real play needs model-backed bots under the subagent seam's one-shot contract, and the acceptance criteria for that seam are strict: each child sees only its authorized observation, returns one structured envelope, cannot act illegally even when the model tries, retries without leaking the previous child's free text, and settles by a visible fallback instead of silent degradation. None of that can ride on the parent agent — the parent model must stay out of game input entirely.

## Decision

Three additions to `@deepseek-ai/dsh-werewolf`, all behind the existing event vocabulary:

1. **Observation projection is a pure function of authoritative folded state.** `projectWerewolfBotObservation` rejects a request unless its game and revision, phase identity, action plan, compiled-rule digest, pending actor, and complete prior context still match the current state. The prompt then derives its legal action and context from that state, carries public player ids beside seats and names, and obtains private knowledge from the registered role projector; teammates are supplied only when the compiled role declares `seesFactionTeammates`. Isolation tests compare serialized prompts against forbidden content rather than checking expected fields only.
2. **The runner treats model output as untrusted data at every boundary.** `runWerewolfBotDecision` starts a fresh child through `ctx.subagents.start()` with the object-rooted output schema derived from the authoritative closed spec vocabulary (the schema subset forces `enum` nodes to carry `type`), fixed persona, `toolFilter: { allow: [] }`, a delegation-depth cap of `delegationDepthOf(parent) + 1`, and the optional per-child route. Envelopes are parsed strictly (unknown keys reject), validated action-first — including public-speech phase and length rules — and delta-second. Each failure returns a detached `werewolf/bot-attempt-failed` payload with one exact category; a rejecting child result settles as `result-rejected` rather than an unhandled rejection. Retries reuse the logical decision id, increment the attempt number, and prepend only a one-line diagnostic — never the prior child's output.
3. **Fallback, cancellation, and cleanup are visible facts.** Cancellation races the child result and timeout rather than waiting for the timeout budget, then awaits disposal before returning `cancelled`. Every result path disposes before acceptance; disposal failure takes the `disposal` category and retries because the child did not prove quiescence. When another failure and disposal failure coincide, the retry diagnostic retains both while the durable attempt category is `disposal`. After the configured retry budget, `auto-action` commits a deterministic trustee action (first legal value per spec kind) with an engine-authored context delta and `trustee: true`; `pause-game` returns a pause request for the caller to append. A late result after timeout or disposal has no consumer and cannot alter anything. The runtime's validated schemastery `Config` is exposed through `botRunnerConfig()`, including `maxConcurrentBots`; the Session Host now validates `inheritsParentContext === false` before start and enforces that concurrency through its injected executor.

## Consequences

- The stage-2 acceptance proof holds in tests: decision N's accepted `contextAfter` is the `priorContext` decision N+1 receives, the sibling bot's context stays untouched, and the sibling's captured prompt never contains the first bot's private delta.
- One fresh child session exists per attempt, labeled `werewolf <phase> seat <n> attempt <k>`; the parent session's model history is untouched by construction.
- The runner returns detached payloads only; `WerewolfGameModule` now appends them through the common Session Host and owns retry-epoch and pause/resume integration.
- Keyless real-Loader coverage retains the complete authorized retry request snapshot and now also completes `quick-7` through the typed Host surface without a Host model call.
- `maxConcurrentBots` resolves to a deployment value; the common executor now honors it while the runner remains one decision per call.

## Alternatives considered

**Validate envelopes inside the commit path only.** The engine's commit already rejects illegal actions, but retry classification needs the exact category before the next child starts; validating in the runner keeps retries cheap and the log clean.

**A continuable child session per bot.** Rejected for the same reasons as the original proposal: no per-decision structured contract and a growing injection surface.

**Trust the provider's schema validation as the legality check.** The provider validates shape; legality (target membership, speech bounds) is game authority and stays in the engine's closed vocabulary, which also keeps the schema generator inside the enforced JSON-Schema subset.
