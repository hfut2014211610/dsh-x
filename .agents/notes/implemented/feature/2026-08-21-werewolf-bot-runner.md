# Agent Note: Werewolf stage 2 — Bot runner and observation projection

Status: implemented

English | [中文](2026-08-21-werewolf-bot-runner.zh.md)

## Problem

Stage 1 proved the deterministic rules but every bot decision was a scripted callback. Real play needs model-backed bots under an isolated decision contract: each Bot sees only its authorized observation, returns one structured envelope, cannot act illegally even when the model tries, retries without promoting rejected free text into game state, and settles by a visible fallback instead of silent degradation. None of that can ride on the parent agent — the parent model must stay out of game input entirely.

## Decision

Three additions to `@deepseek-ai/dsh-werewolf`, all behind the existing event vocabulary:

1. **Observation projection is a pure function of authoritative folded state.** `projectWerewolfBotObservation` rejects a request unless its game and revision, phase identity, action plan, compiled-rule digest, pending actor, and complete prior context still match the current state. The prompt then derives its legal action and context from that state, carries public player ids beside seats and names, and obtains private knowledge from the registered role projector; teammates are supplied only when the compiled role declares `seesFactionTeammates`. Isolation tests compare serialized prompts against forbidden content rather than checking expected fields only.
2. **The runner treats model output as untrusted data at every boundary.** `runWerewolfBotDecision` accepts the Host's fixed-Agent executor and sends the prompt through `turnBot()`; its standalone face can still start a fresh child through `ctx.subagents.start()` with the object-rooted output schema derived from the authoritative closed spec vocabulary (the schema subset forces `enum` nodes to carry `type`), fixed persona, `toolFilter: { allow: [] }`, a delegation-depth cap of `delegationDepthOf(parent) + 1`, and the optional per-child route. The prompt requires exactly the root keys `action` and `contextDelta`, states the current phase's exact action object, rejects action aliases such as `kind`, `text`, or `target`, maps a text action's `value` to the public statement, and limits the delta to changed subjective fields instead of the full prior context. Envelopes are parsed strictly (unknown keys reject), validated action-first — including public-speech phase and length rules — and delta-second. When a text-phase envelope has an invalid action object but an explicit legal `publicSpeech` string, the runner canonicalizes the action to `{ value: publicSpeech }` before the same validators run; this accepts an unambiguous presentation alias without accepting hidden reasoning or bypassing speech bounds. Each failure returns a detached `werewolf/bot-attempt-failed` payload with one exact category; a rejecting child result settles as `result-rejected` rather than an unhandled rejection. Retries reuse the logical decision id and increment the attempt number. A fixed Session receives the one-line rejection diagnostic and the compact output contract because it retains the preceding observation; a standalone retry carries the complete observation because it has no prior turn.
3. **Fallback, cancellation, and cleanup are visible facts.** Cancellation races the child result and timeout rather than waiting for the timeout budget, then awaits disposal before returning `cancelled`. Every result path disposes before acceptance; disposal failure takes the `disposal` category and retries because the child did not prove quiescence. When another failure and disposal failure coincide, the retry diagnostic retains both while the durable attempt category is `disposal`. After the configured retry budget, `auto-action` commits a deterministic trustee action (first legal value per spec kind) with an engine-authored context delta and `trustee: true`; `pause-game` returns a pause request for the caller to append. A late result after timeout or disposal has no consumer and cannot alter anything. The runtime's validated schemastery `Config` is exposed through `botRunnerConfig()`, including `maxConcurrentBots`; the Session Host now validates `inheritsParentContext === false` before start and enforces that concurrency through its injected executor.

## Consequences

- The stage-2 acceptance proof holds in tests: decision N's accepted `contextAfter` is the `priorContext` decision N+1 receives, the sibling bot's context stays untouched, and the sibling's captured prompt never contains the first bot's private delta.
- Hosted games keep one fixed hidden Agent Session per Bot seat; the standalone face creates a fresh child per attempt. Neither path adds game input to the Host model history.
- The runner returns detached payloads only; `WerewolfGameModule` now appends them through the common Session Host and owns retry-epoch and pause/resume integration.
- Keyless real-Loader coverage retains the complete authorized retry request snapshot and now also completes `quick-7` through the typed Host surface without a Host model call.
- `maxConcurrentBots` resolves to a deployment value; the common executor now honors it while the runner remains one decision per call.

## Alternatives considered

**Validate envelopes inside the commit path only.** The engine's commit already rejects illegal actions, but retry classification needs the exact category before the next child starts; validating in the runner keeps retries cheap and the log clean.

**Use only a continuable child session per Bot.** Hosted games select this path to retain strategy, but the standalone face remains useful for isolated runner tests and providers with native per-call schema enforcement. Both paths use the same game-owned validation before commit.

**Trust the provider's schema validation as the legality check.** The provider validates shape; legality (target membership, speech bounds) is game authority and stays in the engine's closed vocabulary, which also keeps the schema generator inside the enforced JSON-Schema subset.
