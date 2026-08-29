# Werewolf

English | [中文](werewolf.zh.md)

A deterministic, event-sourced single-player Werewolf runtime owned by [dsh-werewolf](../../packages/game/werewolf) (`ctx.werewolf`), with classic definitions in [dsh-werewolf-classic](../../packages/game/werewolf-classic) and the reusable Session Host in [dsh-game](../../packages/game/game) (`ctx.games`). The engine is the only authority for roles, legal actions, effects, phases, and victory; model output remains untrusted structured input. The delivered mode includes the deterministic core, one fixed context-preserving Bot Agent per non-human seat, one dedicated Host Agent and Session per game, atomic command batches, typed Host methods, human-authorized projection, terminal replay, and a dedicated Web game view.

Source: [`packages/game/werewolf/src/`](../../packages/game/werewolf/src/)

## Rule sets and definition registries

`ctx.werewolf` owns four trusted same-process registries — rule sets, roles, phases, and victory conditions — keyed by exact `{ id, version }` (rule sets by `{ id, revision }`). Registrations are effects on the calling fiber; duplicate identifiers at one version fail at registration. A rule set is plain JSON configuration over these registries ([`WerewolfRuleSetInputV1`](../../packages/game/werewolf/src/types.ts)): it names registered definitions at exact versions, supplies data-only options, and carries closed-union policies (`voteTie`, `wolfTie`, `deadHuman`, `maxDays`, `speechMaxChars`). Configuration contains no JavaScript, selectors, callbacks, or expression language; new mechanics arrive as plugins that register definitions, after which rule sets use them without engine changes.

`resolveWerewolfRuleSet()` is the only operation that resolves registry references, parses options through each definition's own parser, enforces cross-field invariants (deck counts sum to `playerCount`, every required role binding finds a matching phase occurrence, non-repeatable phases never repeat in one list), and returns the immutable `WerewolfCompiledRuleSetV1` with a stable SHA-256 digest over canonical JSON. `werewolf/game-started` records the complete normalized rule set, digest, and definition versions, so resume and fork replay the recorded snapshot instead of reinterpreting an active game through a newer deployment.

## Durable game events

The parent session log is the authoritative game record; every werewolf event is log-only and never enters the model surface or derived history. Nine event types cover the full lifecycle — `game-started`, `phase-opened`, `human-action`, `bot-attempt-failed` (changes no revision), `bot-decision`, `phase-resolved`, `game-paused`, `game-resumed`, and terminal `game-ended`. Every payload starts with `{ version, gameId, gameRevision }`; state-changing revisions are contiguous and increase by one. `werewolf/phase-resolved` carries the complete declarative resolution (eliminations, preventions, resource and role-state replacements, private notices, announcements, votes), so the reducer applies only recorded effects during replay and never re-runs role or phase plugins. The complete payload declarations live in [`events.ts`](../../packages/game/werewolf/src/events.ts) and the [persistence event catalog](../persistence-catalog.md).

## Engine and lifecycle

The phase engine is pure: each step computes the next events and folds them through the same reducer replay uses, so live play and replay share one code path. One cycle walks the recorded `setup`, `night`, and `day` phase lists in order; a phase opens with an immutable action plan (closed action-spec vocabulary: `player-target`, `choice`, `text`, `compound`) or skips; resolution applies in a fixed record order. Tie policies are engine-owned for votes (`no-elimination`, `revote-once`, `seeded-random`) and phase-owned for the night kill. Victory is evaluated after setup and every resolution: conditions claim at priorities, the lowest priority with a claim wins, equal outcomes merge evidence, and divergent outcomes at one priority are an invariant failure. `maxDays` without another result ends the game as a tie; only `abortGame` produces an `aborted` result.

## Fixed Bot Agents and observation projection

`projectWerewolfBotObservation` first proves that the request still matches the folded game's id and revision, open phase and action plan, compiled rule digest, pending actor, and exact current continuity context. It then builds the actor's authorized view: role and private knowledge via the registered role projector (teammates only when the role declares `seesFactionTeammates`), public roster ids and facts, legal action, and prior context derived from authoritative state. The first decision carries a configured trailing timeline slice; later decisions on a fixed Session carry only public entries added since that Bot's preceding committed decision. `WerewolfGameModule.initializeAgents()` provisions one deterministic, tool-free Bot Agent Session for every non-human seat before `start` returns. The immutable persona fixes the seat, role, faction, and personality for the game; optional `botReasoningEffort` is pinned on the Agent at provisioning and applies to every later model request. Every decision is a FIFO turn on that same Agent Session, so its earlier requests and responses remain in model context. These game-owned Sessions carry the Host parent id but no generic subagent origin descriptor, so the normal subagent catalog and popup do not expose them. Structured results remain untrusted and are validated action-first, then context-delta-second. Every prompt permits exactly the `action` and `contextDelta` root keys, states the current phase's exact action object, maps a text action's `value` to the public statement, and limits the delta to changed subjective fields. An explicit legal `publicSpeech` string recovers an otherwise malformed text action by becoming its canonical `value`; the ordinary action and speech validators still enforce phase and length rules. Failed attempts retain exact categories and retry on the same Bot Session; a retry adds its rejection diagnostic and repeats that compact output contract without resending the observation. Retry exhaustion takes a deterministic trustee action or pauses the game. `GameAiExecutor` supplies the operation signal, enforces `maxConcurrentBots`, preserves result order, and never invokes the Host model.

## Session Host, commands, and human projection

`WerewolfGameModule` is the thin domain adapter registered on `ctx.games`. `start` validates the exact rule-set revision before a Host exists. The common provider creates `game-<GameId>`, atomically commits `game/command-receipt` with `werewolf/game-started`, provisions the fixed Bot Agents, and returns the initialized projection. Werewolf's background automatic scheduling then publishes one phase or Bot decision unit at a time through the same serialized game queue, and each unit invalidates the human projection. A `seat-order-public` phase settles exactly the first remaining living seat; the next seat cannot act until that statement is recorded, accepted text in `action.value` becomes the visible public statement, and the vote phase cannot open until every planned statement has settled. `submitAction`, `resume`, and `abortGame` carry a caller request id and expected revision. Equal duplicate payloads return the current view; another payload under the same key conflicts, and a new stale request rejects.

`Session.appendBatch()` validates JSON, the complete surface transition, and synchronous registered invariants against shadow prefixes before changing the live log. Rejection leaves events, surface, observers, and revision unchanged. Success makes the complete batch visible before publishing its events in order. Common receipts and Werewolf events are log-only.

`WerewolfGameGateway` exposes typed `getLobby`, `start`, `getView`, `getReplay`, `submitAction`, `resume`, and `abortGame`. The Host Agent inherits the deployment's current `agentDefaultModel` route, so fixed Bot Agents can inherit a complete provider/model pair when no per-game override is configured. `getLobby` uses `ctx.games.listViews()` to return the local principal's running and paused games newest first. The gateway resolves the version-1 local principal internally; requests cannot select a Session, participant, player, or seat. `WerewolfHumanViewV1` projects public facts plus only the bound human's role, entitled teammates, resources, notices, and current form. Final views reveal roles after the result. `getReplay` rejects active games and returns authorized checkpoints instead of raw events, bot contexts, or child prompts.

## Isolated application window

`@deepseek-ai/dsh-client-ui-werewolf` registers a `sidebar.footer.action` launcher that opens a named window with `dshMode=werewolf`. Only that URL elects the plugin's `shell.surface` entry, so the primary window keeps its current conversation while the game window mounts no preset switcher, Session sidebar, conversation, details, or generic overlay. The selected `gameId` stays in the window URL, and the lobby lists running and paused games from the Host when no game is selected. Game Host Sessions are excluded from ordinary workspace navigation. The inject face wraps the generated `ctx.remote.werewolfGame` namespace — `getLobby`, `start`, `getView`, `submitAction`, `resume`, `abortGame`, `getReplay` — and subscribes to the forwarded `game/projection-invalidated` event, ignoring other games and re-reading through `getView`. During daytime discussion, the view names the current speaker, shows completed and total speaker counts, renders each completed statement or explicit pass in public order, and explains that voting opens only after the last seat settles. Entitled teammates receive an explicit icon-and-text badge without revealing their role. Forms render only the closed spec vocabulary (`player-target`, `choice`, `text`, `compound`); the browser never receives Bot contexts, Agent prompts, or raw secret events. No slash command or Werewolf agent preset exists, and only typed game actions can mutate game state.

## Bot continuity context

Every seat owns one durable subjective `WerewolfBotContextV1` inside the game's event stream — beliefs, commitments, strategy, memory summary, and the last decision identity under configured character and array limits. A context is not game truth: it can never make an illegal action legal or turn a belief into knowledge. Each accepted decision records the prior context revision, the action, the validated delta, and the full computed `contextAfter`, so every decision is an independent checkpoint while the delta explains the permitted change. Profiles are assigned deterministically from the game seed and are immutable for the game.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Create a dedicated Host, commit start atomically, initialize fixed Agents, and schedule automatic advancement.
 * @param request - module, idempotency key, initial revision, and module input.
 * @returns projection after foreground advancement, or after initialization when the module schedules in the background.
 */
abstract start<TView>(request: { moduleId: string requestId: GameRequestId expectedGameRevision: 0 input: JsonValue }): Promise<GameProjection<TView>>

/**
 * List every game of one module authorized for the principal, newest first.
 * @param moduleId - exact registered module id.
 * @param principalId - authenticated caller.
 * @returns authorized projections ordered by Host creation time.
 */
abstract listViews<TView>(moduleId: string, principalId: PrincipalId): Promise<GameProjection<TView>[]>

/**
 * Return the current authorized view. Reading is a side-effectful kick for a
 * background-scheduling module: uninitialized fixed Agents plus a running
 * game schedule one automatic advancement.
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
 * Commit one human action and schedule automatic advancement.
 * @param request - authorized compare-and-set action.
 * @returns projection after foreground advancement, or after the action when the module schedules in the background.
 */
abstract submitAction<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number action: JsonValue }): Promise<GameProjection<TView>>

/**
 * Resume one paused game and schedule automatic advancement.
 * @param request - authorized compare-and-set resume request.
 * @returns projection after foreground advancement, or after resume when the module schedules in the background.
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

Source: [`packages/game/game/src/service.ts`](../../packages/game/game/src/service.ts)

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

Source: [`packages/game/werewolf/src/runtime.ts`](../../packages/game/werewolf/src/runtime.ts)

<a id="ctxwerewolfgame--werewolfgamegateway"></a>

### `ctx.werewolfGame` — `WerewolfGameGateway`

Registers the Werewolf module and exposes the UI-facing typed methods.

```ts cordis-catalog
/**
 * List registered rule sets and resumable games for the local lobby.
 * @returns rule-set options plus authorized running and paused games.
 */
@Remote('getLobby') async getLobby(): Promise<WerewolfLobbyViewV1>

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

Source: [`packages/game/werewolf/src/host.ts`](../../packages/game/werewolf/src/host.ts)

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

Source: [`packages/game/game/src/types.ts`](../../packages/game/game/src/types.ts)
<!-- END GENERATED cordis-surface -->
