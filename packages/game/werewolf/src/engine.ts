/**
 * The pure phase engine. Every step computes the next werewolf events and
 * folds them through the same reducer replay uses, so live play and replay
 * share one path from events to state. Randomness advances one seeded stream
 * whose position every emitting event records; a restarted process resumes
 * from state alone. The engine never re-runs a definition during replay —
 * `werewolf/phase-resolved` carries the complete declarative outcome.
 * @module @deepseek-ai/dsh-werewolf/engine
 */

import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { WerewolfError } from './error.ts'
import {
  applyWerewolfBotContextDelta,
  BOT_PROFILE_CATALOG,
  normalizeWerewolfText,
  validateWerewolfBotContextDelta,
} from './bot-context.ts'
import { normalizeWerewolfPublicSpeech } from './submission-validation.ts'
export type { WerewolfBotActionRequest } from './types.ts'
import { applyWerewolfEvent } from './reducer.ts'
import type { WerewolfEvent } from './events.ts'
import type {
  WerewolfActionActorV1,
  WerewolfBotActionRequest,
  WerewolfCompiledPhaseOccurrenceV1,
  WerewolfCompiledRuleSetV1,
  WerewolfContextLimitsV1,
  WerewolfDecisionEntryV1,
  WerewolfGameResultV1,
  WerewolfGameStateV1,
  WerewolfOpenPhaseV1,
  WerewolfPhaseOpenInputV1,
  WerewolfPhaseResolveInputV1,
  WerewolfPlayerFactsV1,
  WerewolfResolutionV1,
  WerewolfRng,
  WerewolfSingleActionSpecV1,
  WerewolfVictoryClaimV1,
} from './types.ts'
import type {
  WerewolfDecisionId,
  WerewolfGameId,
  WerewolfHumanActionId,
  WerewolfPhaseInstanceId,
  WerewolfPlayerId,
} from './brand.ts'

/** Minted-id factories the engine calls; tests inject deterministic ones. */
export interface WerewolfEngineIds {
  game(): WerewolfGameId
  player(): WerewolfPlayerId
  phaseInstance(): WerewolfPhaseInstanceId
  decision(): WerewolfDecisionId
  humanAction(): WerewolfHumanActionId
}

/** One engine step's output: the new events and the state they fold into. */
export interface WerewolfEngineStep {
  state: WerewolfGameStateV1
  events: WerewolfEvent[]
}

/** Input to `startWerewolfGame`. */
export interface WerewolfGameStartInput {
  ruleSet: WerewolfCompiledRuleSetV1
  seed: number
  /** Preferred 1-based seat for the human; out-of-range values are ignored. */
  humanSeatPreference?: number
  /** Display names indexed by seat; missing entries fall back to `Seat N`. */
  playerNames?: readonly string[]
  ids?: WerewolfEngineIds
}

/** One bot submission: the request it answers and the structured result. */
export interface WerewolfBotSubmission {
  request: WerewolfBotActionRequest
  envelope: {
    action: JsonValue
    publicSpeech?: string
    /** Unvalidated until commit; `WerewolfBotContextDeltaV1` after acceptance. */
    contextDelta: unknown
  }
  /** Present when the engine took a trustee action after retry exhaustion. */
  trustee?: true
}

/** One actor's collected action for a resolving occurrence. */
export interface WerewolfResolveSubmission {
  playerId: WerewolfPlayerId
  action: JsonValue
  publicSpeech?: string
}

/** Where `driveWerewolfGame` stopped. */
export type WerewolfDriveStop =
  | { kind: 'ended'; result: WerewolfGameResultV1 }
  | { kind: 'awaiting-human'; phaseInstanceId: WerewolfPhaseInstanceId }

/** Callbacks the scripted driver uses; the stage-2 runner replaces `bot`. */
export interface WerewolfDriveOptions {
  bot: (request: WerewolfBotActionRequest) => { action: JsonValue; publicSpeech?: string; contextDelta: unknown }
  /** Without a `human` callback the drive stops when the human must act. */
  human?: (request: Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>) => JsonValue
  /** Earlier game events needed when this drive resumes an already-settled open phase. */
  history?: readonly WerewolfEvent[]
  limits: WerewolfContextLimitsV1
  ids?: WerewolfEngineIds
}

/**
 * Default id factory backed by `crypto.randomUUID`; ids are recorded in
 * events, so live-run randomness is replay-safe.
 *
 * @returns UUID-backed id factories.
 */
export function defaultWerewolfEngineIds(): WerewolfEngineIds {
  return {
    game: () => randomUUID() as WerewolfGameId,
    player: () => randomUUID() as WerewolfPlayerId,
    phaseInstance: () => randomUUID() as WerewolfPhaseInstanceId,
    decision: () => randomUUID() as WerewolfDecisionId,
    humanAction: () => randomUUID() as WerewolfHumanActionId,
  }
}

/** Mutable seeded stream; every draw advances the recorded position. */
interface RngStream {
  state: number
  pick<T>(items: readonly T[]): T
}

function createRngStream(state: number): RngStream {
  const stream: RngStream = {
    state: state | 0,
    pick<T>(items: readonly T[]): T {
      /* v8 ignore next -- defensive guard: no shipped phase picks from an empty list */
      if (items.length === 0) throw new Error('werewolf rng.pick requires a non-empty list')
      stream.state = (stream.state + 0x6D2B79F5) | 0
      let t = stream.state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const draw = ((t ^ (t >>> 14)) >>> 0) % items.length
      return items[draw] as T
    },
  }
  return stream
}

function toRng(stream: RngStream): WerewolfRng {
  return { pick: <T>(items: readonly T[]): T => stream.pick(items) }
}

function foldStep(state: WerewolfGameStateV1, events: WerewolfEvent[]): WerewolfEngineStep {
  let next = state
  for (const event of events) {
    /* v8 ignore next -- applyWerewolfEvent returns undefined only before game-start, and engine steps always fold onto a started state */
    next = applyWerewolfEvent(next, event) ?? next
  }
  return { state: next, events }
}

function requireRunning(state: WerewolfGameStateV1): void {
  if (state.status !== 'running') {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', `the game is ${state.status}, not running`)
  }
}

function requireOpen(state: WerewolfGameStateV1): WerewolfOpenPhaseV1 {
  requireRunning(state)
  const openPhase = state.openPhase
  if (openPhase === null) {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', 'no phase is open; open the next phase first')
  }
  return openPhase
}

function publicFacts(state: WerewolfGameStateV1): WerewolfPlayerFactsV1[] {
  return state.players.map(player => ({
    playerId: player.playerId,
    seat: player.seat,
    displayName: player.displayName,
    alive: player.alive,
    faction: player.faction,
  }))
}

function actorOf(openPhase: WerewolfOpenPhaseV1, playerId: WerewolfPlayerId): WerewolfActionActorV1 | undefined {
  return openPhase.plan.actors.find(actor => actor.playerId === playerId)
}

function isSettled(openPhase: WerewolfOpenPhaseV1, playerId: WerewolfPlayerId): boolean {
  return openPhase.settled.some(entry => entry.playerId === playerId)
}

/**
 * Actors that still owe an action, in plan order.
 *
 * @param openPhase - the opened phase to inspect.
 * @returns the unsettled actors in plan order.
 */
export function werewolfRemainingActors(openPhase: WerewolfOpenPhaseV1): WerewolfActionActorV1[] {
  return openPhase.plan.actors.filter(actor => !isSettled(openPhase, actor.playerId))
}

function buildOpenInput(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
  phase: { phaseId: string; phaseVersion: number; segment: WerewolfOpenPhaseV1['segment']; day: number; occurrence: number },
  stream: RngStream,
): WerewolfPhaseOpenInputV1 {
  const facts = publicFacts(state)
  const participants = []
  for (const player of state.players) {
    const role = rules.roles.get(`${player.roleId}@${player.roleVersion}`)
    const binding = role?.phaseBindings.find(candidate =>
      candidate.phaseId === phase.phaseId && candidate.phaseVersion === phase.phaseVersion)
    if (binding === undefined) continue
    participants.push({
      playerId: player.playerId,
      seat: player.seat,
      alive: player.alive,
      roleState: player.roleState,
      resources: player.resources,
      binding: binding.options,
    })
  }
  return {
    day: phase.day,
    occurrence: phase.occurrence,
    policies: state.ruleSet.policies,
    players: facts,
    participants,
    sameDayHistory: state.sameDayResolutions,
    rng: toRng(stream),
  }
}

function shuffleInPlace<T>(items: T[], stream: RngStream): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = stream.pick(items.slice(0, i + 1).map((_, k) => k))
    const held = items[i] as T
    items[i] = items[j] as T
    items[j] = held
  }
  return items
}

/**
 * Start one game: shuffle seats, assign roles from the deck, seat the human,
 * and assign immutable bot profiles — all draws from the one seeded stream.
 *
 * @param input - compiled rule set, seed, seat and naming preferences.
 * @returns the `werewolf/game-started` event and the initial state.
 */
export function startWerewolfGame(input: WerewolfGameStartInput): WerewolfEngineStep {
  if (!Number.isSafeInteger(input.seed)) {
    throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'game seed must be a safe integer')
  }
  const ids = input.ids ?? defaultWerewolfEngineIds()
  const stream = createRngStream(input.seed)
  const gameId = ids.game()
  const count = input.ruleSet.input.playerCount
  const playerIds = Array.from({ length: count }, () => ids.player())
  const seating = playerIds.map((_, index) => index)
  shuffleInPlace(seating, stream)
  const roles: Array<{ roleId: string; roleVersion: number }> = []
  for (const entry of input.ruleSet.input.deck) {
    for (let i = 0; i < entry.count; i++) roles.push({ roleId: entry.role, roleVersion: entry.roleVersion })
  }
  shuffleInPlace(roles, stream)
  const humanOriginal = stream.pick(seating)
  if (
    input.humanSeatPreference !== undefined
    && Number.isSafeInteger(input.humanSeatPreference)
    && input.humanSeatPreference >= 1
    && input.humanSeatPreference <= count
  ) {
    const current = seating.indexOf(humanOriginal)
    const target = input.humanSeatPreference - 1
    const held = seating[current] as number
    seating[current] = seating[target] as number
    seating[target] = held
  }
  const roster = seating.map((playerIndex, seatIndex) => {
    const role = roles[seatIndex] as { roleId: string; roleVersion: number }
    const compiled = input.ruleSet.roles.get(`${role.roleId}@${role.roleVersion}`)
    if (compiled === undefined) {
      throw new WerewolfError('WEREWOLF_UNKNOWN_DEFINITION', `deck role ${role.roleId}@${role.roleVersion} did not compile`)
    }
    return {
      playerId: playerIds[playerIndex] as WerewolfPlayerId,
      seat: seatIndex + 1,
      displayName: input.playerNames?.[seatIndex] ?? `Seat ${seatIndex + 1}`,
      human: playerIndex === humanOriginal,
      roleId: compiled.id,
      roleVersion: compiled.version,
      faction: compiled.faction,
      roleState: structuredClone(compiled.initialRoleState),
      resources: Object.fromEntries(Object.entries(compiled.initialResources ?? {})),
    }
  })
  const humanEntry = roster.find(entry => entry.human)
  /* v8 ignore next 2 -- the human seat index comes from stream.pick over the seating permutation, so exactly one roster row is human */
  if (humanEntry === undefined) {
    throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'the deck produced no human seat')
  }
  const botProfiles = roster
    .filter(entry => !entry.human)
    .map(entry => ({ playerId: entry.playerId, profile: stream.pick(BOT_PROFILE_CATALOG) }))
  const definitionVersions = {
    roles: [...new Set(roles.map(role => JSON.stringify({ id: role.roleId, version: role.roleVersion })))]
      .map(entry => JSON.parse(entry) as { id: string; version: number }),
    phases: [...new Set([
      ...input.ruleSet.cycle.setup.map(o => ({ id: o.phaseId, version: o.phaseVersion })),
      ...input.ruleSet.cycle.night.map(o => ({ id: o.phaseId, version: o.phaseVersion })),
      ...input.ruleSet.cycle.day.map(o => ({ id: o.phaseId, version: o.phaseVersion })),
    ].map(entry => JSON.stringify(entry)))].map(entry => JSON.parse(entry) as { id: string; version: number }),
    victory: input.ruleSet.victory.map(entry => ({ id: entry.definition.id, version: entry.definition.version })),
  }
  const event: WerewolfEvent<'werewolf/game-started'> = {
    type: 'werewolf/game-started',
    data: {
      version: 1,
      gameId,
      gameRevision: 1,
      engineEventVersion: 1,
      ruleSet: structuredClone(input.ruleSet.input),
      ruleSetDigest: input.ruleSet.digest,
      definitionVersions,
      roster,
      humanPlayerId: humanEntry.playerId,
      botProfiles,
      seed: input.seed,
      rngState: stream.state,
    },
  }
  return { state: applyWerewolfEvent(undefined, event) as WerewolfGameStateV1, events: [event] }
}

/** Stable key used to merge or conflict victory claims. */
function outcomeKey(outcome: WerewolfVictoryClaimV1['outcome']): string {
  return outcome.kind === 'faction' ? `faction:${outcome.factionId}` : 'tie'
}

/**
 * Evaluate the configured victory conditions against one state. The lowest
 * priority holding a claim wins; equal outcome keys merge evidence; divergent
 * keys at one priority are a `WEREWOLF_VICTORY_CONFLICT`.
 *
 * @param state - the folded game state.
 * @param rules - the compiled rule set.
 * @returns the result to record, or `null` when no condition claims.
 */
export function evaluateWerewolfVictory(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
): WerewolfGameResultV1 | null {
  const claims: Array<{
    priority: number
    conditionId: string
    conditionVersion: number
    claim: WerewolfVictoryClaimV1
  }> = []
  const input = {
    day: state.day,
    players: state.players.map(player => ({
      playerId: player.playerId,
      faction: player.faction,
      alive: player.alive,
    })),
  }
  for (const condition of rules.victory) {
    const claim = condition.definition.evaluate({ ...input, options: condition.options })
    if (claim === null) continue
    claims.push({
      priority: condition.priority,
      conditionId: condition.definition.id,
      conditionVersion: condition.definition.version,
      claim,
    })
  }
  if (claims.length === 0) return null
  const priority = Math.min(...claims.map(entry => entry.priority))
  const winners = claims.filter(entry => entry.priority === priority)
  const keys = new Set(winners.map(entry => outcomeKey(entry.claim.outcome)))
  if (keys.size > 1) {
    throw new WerewolfError('WEREWOLF_VICTORY_CONFLICT', `victory conditions diverge at priority ${priority}: ${[...keys].join(', ')}`)
  }
  return {
    outcome: (winners[0] as { claim: WerewolfVictoryClaimV1 }).claim.outcome,
    evidence: winners.map(entry => ({
      source: 'condition' as const,
      conditionId: entry.conditionId,
      conditionVersion: entry.conditionVersion,
      priority: entry.priority,
      data: entry.claim.evidence,
    })),
  }
}

function gameEndedEvent(state: WerewolfGameStateV1, result: WerewolfGameResultV1): WerewolfEvent<'werewolf/game-ended'> {
  return {
    type: 'werewolf/game-ended',
    data: {
      version: 1,
      gameId: state.gameId,
      gameRevision: state.revision + 1,
      result,
    },
  }
}

/** Next position after a consumed one; `null` means the day budget is spent. */
function advancePosition(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
): { segment: 'setup' | 'night' | 'day'; index: number; day: number } | null {
  const policies = state.ruleSet.policies
  const segment = state.segment ?? 'night'
  const list = rules.cycle[segment]
  if (state.cursorIndex + 1 < list.length) {
    return { segment, index: state.cursorIndex + 1, day: state.day }
  }
  if (segment === 'setup') return { segment: 'night', index: 0, day: state.day }
  if (segment === 'night') return { segment: 'day', index: 0, day: state.day }
  if (state.day >= policies.maxDays) return null
  return { segment: 'night', index: 0, day: state.day + 1 }
}

/**
 * Evaluate victory, then open phase occurrences — looping across skips —
 * until one phase awaits actions or the game ends (a claimed victory or the
 * `maxDays` tie).
 *
 * @param state - the folded state; no phase may be open.
 * @param rules - the compiled rule set.
 * @param ids - id factory override.
 * @returns the emitted events and the state they fold into.
 */
export function openNextWerewolfPhase(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
  ids: WerewolfEngineIds = defaultWerewolfEngineIds(),
): WerewolfEngineStep {
  requireRunning(state)
  if (state.openPhase !== null) {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', 'a phase is open; resolve it before opening the next')
  }
  const result = evaluateWerewolfVictory(state, rules)
  if (result !== null) {
    return foldStep(state, [gameEndedEvent(state, result)])
  }
  const maxDaysTie = (): WerewolfGameResultV1 => ({
    outcome: { kind: 'tie' },
    evidence: [{ source: 'max-days', data: { maxDays: state.ruleSet.policies.maxDays } }],
  })
  const stream = createRngStream(state.rngState)
  const events: WerewolfEvent[] = []
  let current = state
  let position = state.positionConsumed
    ? advancePosition(state, rules)
    : { segment: state.segment ?? 'night', index: state.cursorIndex, day: state.day }
  while (position !== null) {
    const occurrence = rules.cycle[position.segment][position.index] as WerewolfCompiledPhaseOccurrenceV1
    const phaseInstanceId = ids.phaseInstance()
    const opened = occurrence.compiled.open(buildOpenInput(current, rules, {
      phaseId: occurrence.phaseId,
      phaseVersion: occurrence.phaseVersion,
      segment: position.segment,
      day: position.day,
      occurrence: 0,
    }, stream))
    const event: WerewolfEvent<'werewolf/phase-opened'> = {
      type: 'werewolf/phase-opened',
      data: {
        version: 1,
        gameId: current.gameId,
        gameRevision: current.revision + 1,
        phaseInstanceId,
        phaseId: occurrence.phaseId,
        phaseVersion: occurrence.phaseVersion,
        segment: position.segment,
        day: position.day,
        cursorIndex: position.index,
        occurrence: 0,
        outcome: opened.kind === 'skip' ? 'skipped' : 'awaiting',
        ...(opened.kind === 'skip' ? { skipReason: opened.reason } : { plan: opened.plan }),
        rngState: stream.state,
      },
    }
    events.push(event)
    /* v8 ignore next -- folds onto a started state, never pre-game */
    current = applyWerewolfEvent(current, event) ?? current
    if (opened.kind === 'plan') {
      return { state: current, events }
    }
    position = advancePosition(current, rules)
  }
  return foldStep(current, [...events, gameEndedEvent(current, maxDaysTie())])
}

function actionError(spec: WerewolfSingleActionSpecV1, value: unknown): string | undefined {
  if (value === null) return spec.allowSkip ? undefined : 'this action cannot be skipped'
  if (spec.kind === 'player-target') {
    return spec.targets.some(target => target === value) ? undefined : 'target is not among the legal targets'
  }
  if (spec.kind === 'choice') {
    return spec.options.some(option => option === value) ? undefined : 'choice is not among the legal options'
  }
  if (typeof value !== 'string') return 'text value must be a string'
  const normalized = normalizeWerewolfText(value)
  if (normalized.length === 0) return spec.allowSkip ? undefined : 'text value is empty'
  return normalized.length <= spec.maxChars ? undefined : `text value exceeds ${spec.maxChars} characters`
}

/**
 * Validate one action JSON against its actor's closed spec. Single-field
 * specs take `{ value }`; compound specs take one value per field id.
 *
 * @param actor - the plan actor the action answers.
 * @param action - the submitted action JSON.
 * @returns the validation error, or `undefined` when the action is legal.
 */
export function validateWerewolfAction(actor: WerewolfActionActorV1, action: JsonValue): string | undefined {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    return 'action must be an object'
  }
  const record = action
  const spec = actor.spec
  if (spec.kind !== 'compound') {
    if (Object.keys(record).length !== 1 || !('value' in record)) return 'action must have exactly one `value` key'
    const value = record.value
    return actionError(spec, value === '' ? null : value)
  }
  const known = new Set(spec.fields.map(field => field.id))
  for (const key of Object.keys(record)) {
    if (!known.has(key)) return `action has unknown key ${JSON.stringify(key)}`
  }
  for (const field of spec.fields) {
    if (!(field.id in record)) return `action is missing field ${JSON.stringify(field.id)}`
    const error = actionError(field.spec, record[field.id] === '' ? null : record[field.id])
    if (error !== undefined) return `${field.id}: ${error}`
  }
  return undefined
}

/**
 * Commit the human's action for the open phase. The human must be an
 * unsettled actor (the first unsettled actor in seat-order-public).
 *
 * @param state - the folded state with an open phase.
 * @param action - the human's action JSON.
 * @param ids - id factory override.
 * @param request - optional idempotency receipt recorded with the action.
 * @returns the `werewolf/human-action` event and the next state.
 */
export function submitWerewolfHumanAction(
  state: WerewolfGameStateV1,
  action: JsonValue,
  ids: WerewolfEngineIds = defaultWerewolfEngineIds(),
  request?: { requestId: string; digest: string },
): WerewolfEngineStep {
  const openPhase = requireOpen(state)
  const actor = actorOf(openPhase, state.humanPlayerId)
  if (actor === undefined || isSettled(openPhase, state.humanPlayerId)) {
    throw new WerewolfError('WEREWOLF_NOT_AWAITING_HUMAN', 'the human is not an eligible actor of the open phase')
  }
  if (openPhase.plan.mode === 'seat-order-public') {
    const first = werewolfRemainingActors(openPhase)[0]
    if (first === undefined || first.playerId !== state.humanPlayerId) {
      throw new WerewolfError('WEREWOLF_NOT_AWAITING_HUMAN', 'another actor speaks first in this public phase')
    }
  }
  const error = validateWerewolfAction(actor, action)
  if (error !== undefined) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `illegal human action: ${error}`)
  }
  const event: WerewolfEvent<'werewolf/human-action'> = {
    type: 'werewolf/human-action',
    data: {
      version: 1,
      gameId: state.gameId,
      gameRevision: state.revision + 1,
      humanActionId: ids.humanAction(),
      phaseInstanceId: openPhase.phaseInstanceId,
      playerId: state.humanPlayerId,
      action,
    },
  }
  if (request !== undefined) event.data.request = request
  return foldStep(state, [event])
}

/**
 * Pause a running game at its current resumable phase.
 * @param state - running folded state.
 * @param reason - stable pause classification.
 * @param detail - optional JSON-safe diagnostic detail.
 * @returns the pause event and next state.
 */
export function pauseWerewolfGame(
  state: WerewolfGameStateV1,
  reason: 'bot-failure' | 'cancelled' | 'unsupported-definition' | 'invariant-failure' | 'operator-request',
  detail?: JsonValue,
): WerewolfEngineStep {
  requireRunning(state)
  const event: WerewolfEvent<'werewolf/game-paused'> = {
    type: 'werewolf/game-paused',
    data: {
      version: 1,
      gameId: state.gameId,
      gameRevision: state.revision + 1,
      reason,
      ...(state.openPhase === null ? {} : { phaseInstanceId: state.openPhase.phaseInstanceId }),
      ...(detail === undefined ? {} : { detail }),
    },
  }
  return foldStep(state, [event])
}

/**
 * Resume a paused game and advance its retry epoch.
 * @param state - paused folded state.
 * @param request - optional idempotency receipt recorded with the resume.
 * @returns the resume event and next state.
 */
export function resumeWerewolfGame(
  state: WerewolfGameStateV1,
  request?: { requestId: string; digest: string },
): WerewolfEngineStep {
  if (state.status !== 'paused') throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', `the game is ${state.status}, not paused`)
  const event: WerewolfEvent<'werewolf/game-resumed'> = {
    type: 'werewolf/game-resumed',
    data: {
      version: 1,
      gameId: state.gameId,
      gameRevision: state.revision + 1,
      retryEpoch: state.retryEpoch + 1,
      ...(request === undefined ? {} : { request }),
    },
  }
  return foldStep(state, [event])
}

function botRequest(
  state: WerewolfGameStateV1,
  openPhase: WerewolfOpenPhaseV1,
  actor: WerewolfActionActorV1,
  ids: WerewolfEngineIds,
): WerewolfBotActionRequest {
  const context = state.contexts[actor.playerId]
  if (context === undefined) {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', `player ${actor.playerId} has no bot context`)
  }
  return {
    decisionId: ids.decision(),
    gameId: state.gameId,
    sourceGameRevision: state.revision,
    playerId: actor.playerId,
    phaseInstanceId: openPhase.phaseInstanceId,
    phaseId: openPhase.phaseId,
    day: openPhase.day,
    actionKind: actor.actionKind,
    spec: actor.spec,
    ...(actor.context === undefined ? {} : { context: actor.context }),
    priorContext: context,
  }
}

/**
 * Build the pending bot requests for the open phase: every unsettled bot for
 * `parallel-private`, only the first unsettled actor for `seat-order-public`.
 *
 * @param state - the folded state with an open phase.
 * @param ids - id factory override.
 * @returns the pending requests in plan order.
 */
export function buildWerewolfBotRequests(
  state: WerewolfGameStateV1,
  ids: WerewolfEngineIds = defaultWerewolfEngineIds(),
): WerewolfBotActionRequest[] {
  const openPhase = requireOpen(state)
  const remaining = werewolfRemainingActors(openPhase)
  if (openPhase.plan.mode === 'seat-order-public') {
    const first = remaining[0]
    return first === undefined || first.playerId === state.humanPlayerId
      ? []
      : [botRequest(state, openPhase, first, ids)]
  }
  return remaining
    .filter(actor => actor.playerId !== state.humanPlayerId)
    .map(actor => botRequest(state, openPhase, actor, ids))
}

/**
 * Commit bot decisions for the open phase: one seat-ordered batch event for
 * `parallel-private` (submissions must cover exactly every pending bot), or
 * one single-entry event for the first pending actor of `seat-order-public`.
 * Illegal actions and invalid context deltas change no state.
 *
 * @param state - the folded state with an open phase.
 * @param submissions - the requests and structured results to commit.
 * @param limits - configured context bounds.
 * @returns the `werewolf/bot-decision` event and the next state.
 */
export function commitWerewolfBotDecisions(
  state: WerewolfGameStateV1,
  submissions: readonly WerewolfBotSubmission[],
  limits: WerewolfContextLimitsV1,
): WerewolfEngineStep {
  const openPhase = requireOpen(state)
  if (openPhase.plan.mode === 'parallel-private' && ! isSettled(openPhase, state.humanPlayerId)
    && actorOf(openPhase, state.humanPlayerId) !== undefined) {
    throw new WerewolfError('WEREWOLF_NOT_AWAITING_HUMAN', 'the human action commits before the bot batch')
  }
  const pending = buildWerewolfBotRequests(state)
  if (pending.length === 0) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'no bot decision is pending for the open phase')
  }
  const submissionByPlayer = new Map(submissions.map(submission => [submission.request.playerId, submission]))
  const coversPending = pending.length === submissions.length
    && pending.every(request => submissionByPlayer.has(request.playerId))
  if (!coversPending) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'bot submissions must cover exactly the pending bot actors')
  }
  const roster = state.players.map(player => player.playerId)
  const entries: WerewolfDecisionEntryV1[] = []
  for (const request of pending) {
    const submission = submissionByPlayer.get(request.playerId)
    /* v8 ignore next -- coversPending checked every pending playerId against submissionByPlayer, so the lookup cannot miss */
    if (submission === undefined) continue
    const actor = actorOf(openPhase, request.playerId)
    /* v8 ignore next 2 -- pending requests are built from this same open plan's actors, so the actor always resolves */
    if (actor === undefined) {
      throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `player ${request.playerId} is not an actor of the open phase`)
    }
    if (submission.request.gameId !== state.gameId || submission.request.sourceGameRevision !== state.revision) {
      throw new WerewolfError('WEREWOLF_STALE_REVISION', 'submission answers a stale game revision')
    }
    if (submission.request.phaseInstanceId !== openPhase.phaseInstanceId) {
      throw new WerewolfError('WEREWOLF_STALE_REVISION', 'submission answers a different phase instance')
    }
    if (submission.request.priorContext.revision !== request.priorContext.revision) {
      throw new WerewolfError('WEREWOLF_STALE_REVISION', 'submission carries a stale context revision')
    }
    const error = validateWerewolfAction(actor, submission.envelope.action)
    if (error !== undefined) {
      throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `illegal bot action: ${error}`)
    }
    const delta = validateWerewolfBotContextDelta(submission.envelope.contextDelta, request.priorContext, roster, limits)
    const publicSpeech = normalizeWerewolfPublicSpeech(
      actor.spec,
      submission.envelope.publicSpeech,
      state.ruleSet.policies.speechMaxChars,
    )
    const contextAfter = applyWerewolfBotContextDelta(request.priorContext, delta, {
      decisionId: submission.request.decisionId,
      phaseId: openPhase.phaseId,
      actionKind: actor.actionKind,
    })
    entries.push({
      decisionId: submission.request.decisionId,
      playerId: request.playerId,
      phaseInstanceId: openPhase.phaseInstanceId,
      actorContextRevision: request.priorContext.revision,
      action: submission.envelope.action,
      ...(publicSpeech === undefined ? {} : { publicSpeech }),
      contextDelta: delta,
      contextAfter,
      ...(submission.trustee === true ? { trustee: true } : {}),
    })
  }
  const event: WerewolfEvent<'werewolf/bot-decision'> = {
    type: 'werewolf/bot-decision',
    data: {
      version: 1,
      gameId: state.gameId,
      gameRevision: state.revision + 1,
      sourceGameRevision: state.revision,
      phaseInstanceId: openPhase.phaseInstanceId,
      mode: openPhase.plan.mode,
      entries,
    },
  }
  return foldStep(state, [event])
}

/**
 * Collect the resolve submissions for a fully settled open phase from the
 * committed events, ordered by the plan's actor order.
 *
 * @param events - the whole event log of the game so far.
 * @param openPhase - the settled open phase to collect for.
 * @returns one submission per actor that committed.
 */
export function collectWerewolfResolveSubmissions(
  events: readonly WerewolfEvent[],
  openPhase: WerewolfOpenPhaseV1,
): WerewolfResolveSubmission[] {
  const byPlayer = new Map<WerewolfPlayerId, WerewolfResolveSubmission>()
  for (const event of events) {
    if (event.type === 'werewolf/human-action' && event.data.phaseInstanceId === openPhase.phaseInstanceId) {
      byPlayer.set(event.data.playerId, { playerId: event.data.playerId, action: event.data.action })
    }
    if (event.type === 'werewolf/bot-decision' && event.data.phaseInstanceId === openPhase.phaseInstanceId) {
      for (const entry of event.data.entries) {
        byPlayer.set(entry.playerId, {
          playerId: entry.playerId,
          action: entry.action,
          ...(entry.publicSpeech === undefined || entry.publicSpeech.length === 0 ? {} : { publicSpeech: entry.publicSpeech }),
        })
      }
    }
  }
  const submissions: WerewolfResolveSubmission[] = []
  for (const actor of openPhase.plan.actors) {
    const submission = byPlayer.get(actor.playerId)
    if (submission === undefined) continue
    if (submission.publicSpeech === undefined && actor.spec.kind === 'text') {
      const value = (submission.action as { value?: unknown }).value
      if (typeof value === 'string' && normalizeWerewolfText(value).length > 0) {
        submissions.push({ ...submission, publicSpeech: normalizeWerewolfText(value) })
        continue
      }
    }
    submissions.push(submission)
  }
  return submissions
}

/**
 * Resolve the open phase: run its declarative resolve, apply the engine-owned
 * `voteTie` policy, and append the resolution (plus, for a first-occurrence
 * tie under `revote-once`, the re-opened occurrence) as events.
 *
 * @param state - the folded state whose open phase has every actor settled.
 * @param rules - the compiled rule set.
 * @param submissions - every actor's committed action for this occurrence.
 * @param ids - id factory override.
 * @returns the emitted events and the state they fold into.
 */
export function resolveOpenWerewolfPhase(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
  submissions: readonly WerewolfResolveSubmission[],
  ids: WerewolfEngineIds = defaultWerewolfEngineIds(),
): WerewolfEngineStep {
  const openPhase = requireOpen(state)
  if (werewolfRemainingActors(openPhase).length > 0) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `phase ${openPhase.phaseId} still awaits actors`)
  }
  const byId = new Map(submissions.map(submission => [submission.playerId, submission]))
  const actors = [...openPhase.plan.actors]
  const actorIds = new Set(actors.map(actor => actor.playerId))
  if (
    submissions.length !== actors.length
    || byId.size !== submissions.length
    || actors.some(actor => !byId.has(actor.playerId))
    || submissions.some(submission => !actorIds.has(submission.playerId))
  ) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'resolve submissions must cover every phase actor exactly once')
  }
  const stream = createRngStream(state.rngState)
  const openInput = buildOpenInput(state, rules, openPhase, stream)
  const resolveInput: WerewolfPhaseResolveInputV1 = {
    ...openInput,
    actions: actors
      .filter(actor => byId.has(actor.playerId))
      .map(actor => ({ playerId: actor.playerId, action: byId.get(actor.playerId)?.action ?? null })),
    speeches: actors
      .filter(actor => byId.get(actor.playerId)?.publicSpeech !== undefined)
      .map(/* v8 ignore next -- the filter keeps only actors whose submission has a defined publicSpeech */ actor => ({ playerId: actor.playerId, text: byId.get(actor.playerId)?.publicSpeech ?? '' })),
  }
  const occurrence = rules.cycle[openPhase.segment][state.cursorIndex] as WerewolfCompiledPhaseOccurrenceV1
  let resolution: WerewolfResolutionV1 = occurrence.compiled.resolve(resolveInput)
  const voteOutcome = resolution.voteOutcome
  let revotePlan: WerewolfOpenPhaseV1['plan'] | undefined
  let revotePhaseInstanceId: WerewolfPhaseInstanceId | undefined
  if (voteOutcome !== undefined && voteOutcome.eliminated === null) {
    const policy = state.ruleSet.policies.voteTie
    const tieData = { tiedPlayers: [...voteOutcome.tiedPlayers] }
    if (policy === 'seeded-random' && voteOutcome.tiedPlayers.length > 0) {
      const chosen = stream.pick(voteOutcome.tiedPlayers)
      resolution = {
        ...resolution,
        eliminations: [...resolution.eliminations, { playerId: chosen, cause: 'vote' }],
        announcements: [...resolution.announcements, { kind: 'vote', key: 'vote.eliminated', data: { playerId: chosen } }],
      }
    } else if (policy === 'revote-once' && openPhase.occurrence === 0 && voteOutcome.tiedPlayers.length > 1) {
      revotePhaseInstanceId = ids.phaseInstance()
      const sameDayHistory = [
        ...state.sameDayResolutions,
        { phaseId: openPhase.phaseId, phaseVersion: openPhase.phaseVersion, day: openPhase.day, segment: openPhase.segment, resolution },
      ]
      const revoteOpenPhase: WerewolfOpenPhaseV1 = {
        settled: [],
        phaseInstanceId: revotePhaseInstanceId,
        phaseId: openPhase.phaseId,
        phaseVersion: openPhase.phaseVersion,
        segment: openPhase.segment,
        day: openPhase.day,
        occurrence: openPhase.occurrence + 1,
        plan: { mode: 'parallel-private', actors: [] },
      }
      const opened = occurrence.compiled.open({
        ...buildOpenInput(state, rules, revoteOpenPhase, stream),
        sameDayHistory,
      })
      if (opened.kind === 'plan') {
        revotePlan = opened.plan
        revoteOpenPhase.plan = opened.plan
      }
    }
    if (revotePlan === undefined && policy !== 'seeded-random') {
      resolution = {
        ...resolution,
        announcements: [...resolution.announcements, { kind: 'vote', key: 'vote.no-elimination', data: tieData }],
      }
    }
  }
  const decisionIds = openPhase.settled.flatMap(entry => entry.decisionId === undefined ? [] : [entry.decisionId])
  const humanActionIds = openPhase.settled.flatMap(entry => entry.humanActionId === undefined ? [] : [entry.humanActionId])
  const resolvedEvent: WerewolfEvent<'werewolf/phase-resolved'> = {
    type: 'werewolf/phase-resolved',
    data: {
      version: 1,
      gameId: state.gameId,
      gameRevision: state.revision + 1,
      phaseInstanceId: openPhase.phaseInstanceId,
      decisionIds,
      humanActionIds,
      resolution,
      rngState: stream.state,
    },
  }
  const events: WerewolfEvent[] = [resolvedEvent]
  if (revotePlan !== undefined && revotePhaseInstanceId !== undefined) {
    events.push({
      type: 'werewolf/phase-opened',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: state.revision + 2,
        phaseInstanceId: revotePhaseInstanceId,
        phaseId: openPhase.phaseId,
        phaseVersion: openPhase.phaseVersion,
        segment: openPhase.segment,
        day: openPhase.day,
        cursorIndex: state.cursorIndex,
        occurrence: openPhase.occurrence + 1,
        outcome: 'awaiting',
        plan: revotePlan,
        rngState: stream.state,
      },
    })
  }
  return foldStep(state, events)
}

/**
 * Abort the running or paused game with a terminal `aborted` result.
 *
 * @param state - the folded state.
 * @param request - optional mutation idempotency record.
 * @returns the terminal `werewolf/game-ended` event and the next state.
 */
export function abortWerewolfGame(
  state: WerewolfGameStateV1,
  request?: { requestId: string; digest: string },
): WerewolfEngineStep {
  if (state.status === 'ended') {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', 'the game has already ended')
  }
  const result: WerewolfGameResultV1 = {
    outcome: { kind: 'aborted' },
    evidence: [{ source: 'human-abort', data: {} }],
  }
  const event = gameEndedEvent(state, result)
  if (request !== undefined) event.data.request = request
  return foldStep(state, [event])
}

/**
 * Drive the game with scripted callbacks until it ends or awaits the human.
 * The stage-2 bot runner replaces the `bot` callback; this loop is the
 * reference for the controller's auto-advance.
 *
 * @param state - the folded state to drive from.
 * @param rules - the compiled rule set.
 * @param options - bot and optional human callbacks plus context limits.
 * @returns all emitted events, the final state, and where the drive stopped.
 */
export function driveWerewolfGame(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
  options: WerewolfDriveOptions,
): WerewolfEngineStep & { stop: WerewolfDriveStop } {
  const ids = options.ids ?? defaultWerewolfEngineIds()
  const events: WerewolfEvent[] = []
  let current = state
  const resolveIfComplete = (): void => {
    const openPhase = current.openPhase
    if (openPhase === null || werewolfRemainingActors(openPhase).length > 0) return
    const step = resolveOpenWerewolfPhase(
      current,
      rules,
      collectWerewolfResolveSubmissions([...(options.history ?? []), ...events], openPhase),
      ids,
    )
    events.push(...step.events)
    current = step.state
  }
  for (;;) {
    if (current.status === 'ended') {
      return { state: current, events, stop: { kind: 'ended', result: current.result as WerewolfGameResultV1 } }
    }
    if (current.openPhase === null) {
      const step = openNextWerewolfPhase(current, rules, ids)
      events.push(...step.events)
      current = step.state
      continue
    }
    const remaining = werewolfRemainingActors(current.openPhase)
    if (remaining.length === 0) {
      resolveIfComplete()
      continue
    }
    const humanActor = remaining.find(actor => actor.playerId === current.humanPlayerId)
    const humanFirst = humanActor !== undefined && remaining[0]?.playerId === current.humanPlayerId
    const human = options.human
    const humanCanAct = humanActor !== undefined
      && (current.openPhase.plan.mode === 'parallel-private' || humanFirst)
    if (humanCanAct && human === undefined) {
      return {
        state: current,
        events,
        stop: { kind: 'awaiting-human', phaseInstanceId: current.openPhase.phaseInstanceId },
      }
    }
    const humanTurn = humanCanAct && human !== undefined
    if (humanTurn) {
      const action = human({
        gameId: current.gameId,
        sourceGameRevision: current.revision,
        playerId: humanActor.playerId,
        phaseInstanceId: current.openPhase.phaseInstanceId,
        phaseId: current.openPhase.phaseId,
        day: current.openPhase.day,
        actionKind: humanActor.actionKind,
        spec: humanActor.spec,
        ...(humanActor.context === undefined ? {} : { context: humanActor.context }),
      })
      const step = submitWerewolfHumanAction(current, action, ids)
      events.push(...step.events)
      current = step.state
      resolveIfComplete()
      continue
    }
    const submissions = buildWerewolfBotRequests(current, ids).map(request => ({
      request,
      envelope: options.bot(request),
    }))
    const step = commitWerewolfBotDecisions(current, submissions, options.limits)
    events.push(...step.events)
    current = step.state
    resolveIfComplete()
  }
}
