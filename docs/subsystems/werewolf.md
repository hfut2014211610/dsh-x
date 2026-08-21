# Werewolf

English | [中文](werewolf.zh.md)

A deterministic, event-sourced single-player Werewolf runtime owned by [dsh-werewolf](../../packages/game/werewolf) (`ctx.werewolf`), with classic definitions in [dsh-werewolf-classic](../../packages/game/werewolf-classic) and the reusable Session Host in [dsh-game](../../packages/game/game) (`ctx.games`). The engine is the only authority for roles, legal actions, effects, phases, and victory; model output remains untrusted structured input. Stages 1–3 ship the deterministic core, fresh one-shot bots with durable per-seat context, one dedicated Host Agent and Session per game, atomic command batches, typed Host methods, human-authorized projection, and terminal replay. The dedicated Web game view remains in the [delivery plan](../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md).

Source: [`packages/game/werewolf/src/`](../../packages/game/werewolf/src/)

## Rule sets and definition registries

`ctx.werewolf` owns four trusted same-process registries — rule sets, roles, phases, and victory conditions — keyed by exact `{ id, version }` (rule sets by `{ id, revision }`). Registrations are effects on the calling fiber; duplicate identifiers at one version fail at registration. A rule set is plain JSON configuration over these registries ([`WerewolfRuleSetInputV1`](../../packages/game/werewolf/src/types.ts)): it names registered definitions at exact versions, supplies data-only options, and carries closed-union policies (`voteTie`, `wolfTie`, `deadHuman`, `maxDays`, `speechMaxChars`). Configuration contains no JavaScript, selectors, callbacks, or expression language; new mechanics arrive as plugins that register definitions, after which rule sets use them without engine changes.

`resolveWerewolfRuleSet()` is the only operation that resolves registry references, parses options through each definition's own parser, enforces cross-field invariants (deck counts sum to `playerCount`, every required role binding finds a matching phase occurrence, non-repeatable phases never repeat in one list), and returns the immutable `WerewolfCompiledRuleSetV1` with a stable SHA-256 digest over canonical JSON. `werewolf/game-started` records the complete normalized rule set, digest, and definition versions, so resume and fork replay the recorded snapshot instead of reinterpreting an active game through a newer deployment.

## Durable game events

The parent session log is the authoritative game record; every werewolf event is log-only and never enters the model surface or derived history. Nine event types cover the full lifecycle — `game-started`, `phase-opened`, `human-action`, `bot-attempt-failed` (changes no revision), `bot-decision`, `phase-resolved`, `game-paused`, `game-resumed`, and terminal `game-ended`. Every payload starts with `{ version, gameId, gameRevision }`; state-changing revisions are contiguous and increase by one. `werewolf/phase-resolved` carries the complete declarative resolution (eliminations, preventions, resource and role-state replacements, private notices, announcements, votes), so the reducer applies only recorded effects during replay and never re-runs role or phase plugins. The complete payload declarations live in [`events.ts`](../../packages/game/werewolf/src/events.ts) and the [persistence event catalog](../persistence-catalog.md).

## Engine and lifecycle

The phase engine is pure: each step computes the next events and folds them through the same reducer replay uses, so live play and replay share one code path. One cycle walks the recorded `setup`, `night`, and `day` phase lists in order; a phase opens with an immutable action plan (closed action-spec vocabulary: `player-target`, `choice`, `text`, `compound`) or skips; resolution applies in a fixed record order. Tie policies are engine-owned for votes (`no-elimination`, `revote-once`, `seeded-random`) and phase-owned for the night kill. Victory is evaluated after setup and every resolution: conditions claim at priorities, the lowest priority with a claim wins, equal outcomes merge evidence, and divergent outcomes at one priority are an invariant failure. `maxDays` without another result ends the game as a tie; only `abortGame` produces an `aborted` result.

## One-shot bot runner and observation projection

`projectWerewolfBotObservation` first proves that the request still matches the folded game's id and revision, open phase and action plan, compiled rule digest, pending actor, and exact current continuity context. It then builds the actor's authorized view: role and private knowledge via the registered role projector (teammates only when the role declares `seesFactionTeammates`), public roster ids and facts plus a configured trailing timeline slice, and legal action and prior context derived from authoritative state. `runWerewolfBotDecision` starts a fresh child on the configured provider with an object-rooted schema, fixed bot persona, `toolFilter: { allow: [] }`, delegation-depth cap, and optional child route. The provider must advertise every requested capability and `inheritsParentContext === false`. Structured results remain untrusted and are validated action-first, then context-delta-second. Failed attempts retain exact categories; cancellation races result and timeout and disposes the child before returning. Retry exhaustion takes a deterministic trustee action or pauses the game. The Session Host's `GameAiExecutor` supplies the exact Host parent and operation signal, enforces `maxConcurrentBots`, preserves result order, and never invokes the Host model.

## Session Host, commands, and human projection

`WerewolfGameModule` is the thin domain adapter registered on `ctx.games`. `start` validates the exact rule-set revision and isolated subagent provider before a Host exists. The common provider creates `game-<GameId>`, atomically commits `game/command-receipt` with `werewolf/game-started`, and drives phases until a human form, pause, or result. `submitAction`, `resume`, and `abortGame` carry a caller request id and expected revision. Equal duplicate payloads return the current view after automatic advancement; another payload under the same key conflicts, and a new stale request rejects. All mutations are serialized per game.

`Session.appendBatch()` validates JSON, the complete surface transition, and synchronous registered invariants against shadow prefixes before changing the live log. Rejection leaves events, surface, observers, and revision unchanged. Success makes the complete batch visible before publishing its events in order. Common receipts and Werewolf events are log-only.

`WerewolfGameGateway` exposes typed `start`, `getView`, `getReplay`, `submitAction`, `resume`, and `abortGame`. It resolves the version-1 local principal internally; requests cannot select a Session, participant, player, or seat. `WerewolfHumanViewV1` projects public facts plus only the bound human's role, entitled teammates, resources, notices, and current form. Final views reveal roles after the result. `getReplay` rejects active games and returns authorized checkpoints instead of raw events, bot contexts, or child prompts.

## Bot continuity context

Every seat owns one durable subjective `WerewolfBotContextV1` inside the game's event stream — beliefs, commitments, strategy, memory summary, and the last decision identity under configured character and array limits. A context is not game truth: it can never make an illegal action legal or turn a belief into knowledge. Each accepted decision records the prior context revision, the action, the validated delta, and the full computed `contextAfter`, so every decision is an independent checkpoint while the delta explains the permitted change. Profiles are assigned deterministically from the game seed and are immutable for the game.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgames--gameservice-abstract-seam"></a>

### `ctx.games` — `GameService` (abstract seam)

Shared game Host contract implemented by the default Session provider.

```ts cordis-catalog
/**
 * Register one exact module version as a caller-owned effect.
 * @param module - domain adapter to register.
 * @returns disposer that removes this exact registration.
 */
abstract registerModule(module: GameModule): () => void

/**
 * Resolve the version-1 loopback principal.
 * @returns authenticated local principal.
 */
abstract resolvePrincipal(): LocalGamePrincipalV1

/**
 * Create a dedicated Host, commit start atomically, and auto-advance.
 * @param request - module, idempotency key, initial revision, and module input.
 * @returns current authorized projection after automatic advancement.
 */
abstract start<TView>(request: { moduleId: string requestId: GameRequestId expectedGameRevision: 0 input: JsonValue }): Promise<GameProjection<TView>>

/**
 * Return the current authorized view.
 * @param gameId - game to read.
 * @param principalId - authenticated caller.
 * @returns current authorized projection.
 */
abstract getView<TView>(gameId: GameId, principalId: PrincipalId): Promise<GameProjection<TView>>

/**
 * Return the authorized module replay.
 * @param gameId - game to replay.
 * @param principalId - authenticated caller.
 * @returns module-defined authorized replay.
 */
abstract getReplay<TReplay>(gameId: GameId, principalId: PrincipalId): Promise<TReplay>

/**
 * Commit one human action and auto-advance.
 * @param request - authorized compare-and-set action.
 * @returns current authorized projection after automatic advancement.
 */
abstract submitAction<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number action: JsonValue }): Promise<GameProjection<TView>>

/**
 * Resume one paused game and auto-advance.
 * @param request - authorized compare-and-set resume request.
 * @returns current authorized projection after automatic advancement.
 */
abstract resume<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number }): Promise<GameProjection<TView>>

/**
 * Record an aborted terminal result.
 * @param request - authorized compare-and-set abort request.
 * @returns terminal authorized projection.
 */
abstract abortGame<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number }): Promise<GameProjection<TView>>

/**
 * Resolve one game to its dedicated live Host Session.
 * @param gameId - game to inspect.
 * @returns indexed Host Session, when known to this process.
 */
abstract getHostSession(gameId: GameId): Session | undefined
```

Types: [Session](session.md)

Source: [`packages/game/game/src/service.ts:26`](../../packages/game/game/src/service.ts)

<a id="ctxwerewolf--werewolfruntime"></a>

### `ctx.werewolf` — `WerewolfRuntime`

The Werewolf extension surface: registration of rule sets, roles, phases, and victory conditions, plus rule-set compilation against the current registry state.

```ts cordis-catalog
/**
 * The resolved bot runner settings the stage-2 runner consumes.
 *
 * @returns the deployment-resolved runner configuration.
 */
botRunnerConfig(): WerewolfBotRunnerConfigV1

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

Source: [`packages/game/werewolf/src/runtime.ts:63`](../../packages/game/werewolf/src/runtime.ts)

<a id="ctxwerewolfgame--werewolfgamegateway"></a>

### `ctx.werewolfGame` — `WerewolfGameGateway`

Registers the Werewolf module and exposes the UI-facing typed methods.

```ts cordis-catalog
/**
 * Start one local single-player game.
 * @param request - rule selection, seed, and caller idempotency key.
 * @returns current human-authorized projection.
 */
@Remote('start') async start(request: WerewolfStartRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Read the current view for the locally authenticated principal.
 * @param request - game identity.
 * @returns current human-authorized projection.
 */
@Remote('getView') async getView(request: { gameId: string }): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Read the terminal authorized replay.
 * @param request - game identity.
 * @returns replay containing authorized checkpoints.
 */
@Remote('getReplay') async getReplay(request: { gameId: string }): Promise<WerewolfReplayV1>

/**
 * Submit one action for the current human form.
 * @param request - phase-bound compare-and-set action.
 * @returns current human-authorized projection after automatic advancement.
 */
@Remote('submitAction') async submitAction(request: WerewolfSubmitActionRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Resume one paused game.
 * @param request - compare-and-set resume request.
 * @returns current human-authorized projection after automatic advancement.
 */
@Remote('resume') async resume(request: WerewolfHostMutationRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Abort one running or paused game.
 * @param request - compare-and-set abort request.
 * @returns terminal human-authorized projection.
 */
@Remote('abortGame') async abortGame(request: WerewolfHostMutationRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>
```

Source: [`packages/game/werewolf/src/host.ts:23`](../../packages/game/werewolf/src/host.ts)

<a id="game-events"></a>

### `game/*` events

<a id="gameprojection-invalidated--emit"></a>

#### `game/projection-invalidated` — emit

Announce that authorized readers must re-read one game projection. The event deliberately carries no identity or hidden view data.

```ts cordis-catalog
/**
 * Announce that authorized readers must re-read one game projection.
 * The event deliberately carries no identity or hidden view data.
 * @param gameId - changed game.
 * @param gameRevision - committed domain revision.
 * @mode emit
 */
'game/projection-invalidated'(gameId: GameId, gameRevision: number): void
```

Source: [`packages/game/game/src/service.ts:21`](../../packages/game/game/src/service.ts)
<!-- END GENERATED cordis-surface -->
