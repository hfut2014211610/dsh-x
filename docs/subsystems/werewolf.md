# Werewolf

English | [中文](werewolf.zh.md)

A deterministic, event-sourced single-player Werewolf runtime core owned by [dsh-werewolf](../../packages/game/werewolf) (`ctx.werewolf`) with the classic role, phase, and victory definitions in [dsh-werewolf-classic](../../packages/game/werewolf-classic). The engine is the only authority for role assignment, legal actions, effect application, phase transitions, and victory; model output is untrusted input at a structured-output boundary that arrives with the stage-2 bot integration. Stage 1 ships the registries, rule compiler, durable events, reducer, phase engine, and bot continuity context; the bot runner, session projections, and the dedicated game view arrive with later stages of the [delivery plan](../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md).

Source: [`packages/game/werewolf/src/`](../../packages/game/werewolf/src/)

## Rule sets and definition registries

`ctx.werewolf` owns four trusted same-process registries — rule sets, roles, phases, and victory conditions — keyed by exact `{ id, version }` (rule sets by `{ id, revision }`). Registrations are effects on the calling fiber; duplicate identifiers at one version fail at registration. A rule set is plain JSON configuration over these registries ([`WerewolfRuleSetInputV1`](../../packages/game/werewolf/src/types.ts)): it names registered definitions at exact versions, supplies data-only options, and carries closed-union policies (`voteTie`, `wolfTie`, `deadHuman`, `maxDays`, `speechMaxChars`). Configuration contains no JavaScript, selectors, callbacks, or expression language; new mechanics arrive as plugins that register definitions, after which rule sets use them without engine changes.

`resolveWerewolfRuleSet()` is the only operation that resolves registry references, parses options through each definition's own parser, enforces cross-field invariants (deck counts sum to `playerCount`, every required role binding finds a matching phase occurrence, non-repeatable phases never repeat in one list), and returns the immutable `WerewolfCompiledRuleSetV1` with a stable SHA-256 digest over canonical JSON. `werewolf/game-started` records the complete normalized rule set, digest, and definition versions, so resume and fork replay the recorded snapshot instead of reinterpreting an active game through a newer deployment.

## Durable game events

The parent session log is the authoritative game record; every werewolf event is log-only and never enters the model surface or derived history. Nine event types cover the full lifecycle — `game-started`, `phase-opened`, `human-action`, `bot-attempt-failed` (changes no revision), `bot-decision`, `phase-resolved`, `game-paused`, `game-resumed`, and terminal `game-ended`. Every payload starts with `{ version, gameId, gameRevision }`; state-changing revisions are contiguous and increase by one. `werewolf/phase-resolved` carries the complete declarative resolution (eliminations, preventions, resource and role-state replacements, private notices, announcements, votes), so the reducer applies only recorded effects during replay and never re-runs role or phase plugins. The complete payload declarations live in [`events.ts`](../../packages/game/werewolf/src/events.ts) and the [persistence event catalog](../persistence-catalog.md).

## Engine and lifecycle

The phase engine is pure: each step computes the next events and folds them through the same reducer replay uses, so live play and replay share one code path. One cycle walks the recorded `setup`, `night`, and `day` phase lists in order; a phase opens with an immutable action plan (closed action-spec vocabulary: `player-target`, `choice`, `text`, `compound`) or skips; resolution applies in a fixed record order. Tie policies are engine-owned for votes (`no-elimination`, `revote-once`, `seeded-random`) and phase-owned for the night kill. Victory is evaluated after setup and every resolution: conditions claim at priorities, the lowest priority with a claim wins, equal outcomes merge evidence, and divergent outcomes at one priority are an invariant failure. `maxDays` without another result ends the game as a tie; only `abortGame` produces an `aborted` result.

## Bot continuity context

Every seat owns one durable subjective `WerewolfBotContextV1` inside the game's event stream — beliefs, commitments, strategy, memory summary, and the last decision identity under configured character and array limits. A context is not game truth: it can never make an illegal action legal or turn a belief into knowledge. Each accepted decision records the prior context revision, the action, the validated delta, and the full computed `contextAfter`, so every decision is an independent checkpoint while the delta explains the permitted change. Profiles are assigned deterministically from the game seed and are immutable for the game.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwerewolf--werewolfruntime"></a>

### `ctx.werewolf` — `WerewolfRuntime`

The Werewolf extension surface: registration of rule sets, roles, phases, and victory conditions, plus rule-set compilation against the current registry state.

```ts cordis-catalog
/**
 * Register one role version on the calling fiber.
 *
 * @param definition - the role definition to register.
 * @returns a disposer removing exactly this registration.
 */
registerRole(definition: WerewolfRoleDefinition): () => void

/**
 * Register one phase version on the calling fiber.
 *
 * @param definition - the phase definition to register.
 * @returns a disposer removing exactly this registration.
 */
registerPhase(definition: WerewolfPhaseDefinition): () => void

/**
 * Register one victory-condition version on the calling fiber.
 *
 * @param definition - the victory-condition definition to register.
 * @returns a disposer removing exactly this registration.
 */
registerVictoryCondition(definition: WerewolfVictoryConditionDefinition): () => void

/**
 * Register one immutable `{ id, revision }` rule-set pair on the calling
 * fiber.
 *
 * @param input - the parsed rule-set input to register.
 * @returns a disposer removing exactly this registration.
 */
registerRuleSet(input: WerewolfRuleSetInputV1): () => void

/**
 * Compile one rule set against the current registries.
 *
 * @param input - the raw or parsed rule-set input.
 * @returns the immutable compiled rule set with its digest.
 */
resolveRuleSet(input: JsonValue): WerewolfCompiledRuleSetV1

/**
 * Every registered rule-set input, keyed `${id}@${revision}`.
 *
 * @returns the registered rule-set inputs.
 */
listRuleSets(): ReadonlyMap<string, WerewolfRuleSetInputV1>
```

Source: [`packages/game/werewolf/src/runtime.ts:34`](../../packages/game/werewolf/src/runtime.ts)
<!-- END GENERATED cordis-surface -->
