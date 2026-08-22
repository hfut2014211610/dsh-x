/** Thin adapter from the domain engine to the common `ctx.games` Host. */

import type { Context } from '@deepseek-ai/cordis'
import {
  GameId,
  ParticipantId,
  type GameAdvance,
  type GameAiExecutor,
  type GameEventCandidate,
  type GameModule,
  type GameMutationRequest,
  type GameRequestId,
  type LocalGamePrincipalV1,
  type PreparedGameStart,
} from '@deepseek-ai/dsh-game'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  runWerewolfBotDecision,
  werewolfBotPersona,
  werewolfBotSessionId,
} from './bot-runner.ts'
import {
  abortWerewolfGame,
  buildWerewolfBotRequests,
  collectWerewolfResolveSubmissions,
  commitWerewolfBotDecisions,
  defaultWerewolfEngineIds,
  openNextWerewolfPhase,
  pauseWerewolfGame,
  resolveOpenWerewolfPhase,
  resumeWerewolfGame,
  startWerewolfGame,
  submitWerewolfHumanAction,
  werewolfRemainingActors,
  type WerewolfEngineIds,
} from './engine.ts'
import { isWerewolfEvent, type WerewolfEvent } from './events.ts'
import { WerewolfError } from './error.ts'
import { projectWerewolfHumanView, type WerewolfHumanViewV1, type WerewolfReplayV1 } from './human-projection.ts'
import { reduceWerewolfGame } from './reducer.ts'
import type { WerewolfRuntime } from './runtime.ts'
import type { WerewolfCompiledRuleSetV1, WerewolfGameStateV1 } from './types.ts'

import type { WerewolfGameStartV1 } from './host-types.ts'

export type { WerewolfGameActionV1, WerewolfGameStartV1 } from './host-types.ts'

function asRecord(value: JsonValue, where: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `${where} must be an object`)
  return value
}

function parseStart(value: JsonValue): WerewolfGameStartV1 {
  const record = asRecord(value, 'start input')
  for (const key of Object.keys(record)) {
    if (!['ruleSetId', 'ruleSetRevision', 'seed', 'humanSeatPreference', 'playerNames'].includes(key)) {
      throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', `start input has unknown key ${JSON.stringify(key)}`)
    }
  }
  if (typeof record.ruleSetId !== 'string' || record.ruleSetId.length === 0) throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'ruleSetId must be a non-empty string')
  if (typeof record.ruleSetRevision !== 'number' || !Number.isSafeInteger(record.ruleSetRevision) || record.ruleSetRevision < 1) throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'ruleSetRevision must be a positive integer')
  if (typeof record.seed !== 'number' || !Number.isSafeInteger(record.seed)) throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'seed must be a safe integer')
  const humanSeatPreference = record.humanSeatPreference
  if (humanSeatPreference !== undefined && (typeof humanSeatPreference !== 'number' || !Number.isSafeInteger(humanSeatPreference))) throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'humanSeatPreference must be an integer')
  const names = record.playerNames
  if (names !== undefined && (!Array.isArray(names) || names.some(name => typeof name !== 'string'))) throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', 'playerNames must be an array of strings')
  return {
    ruleSetId: record.ruleSetId,
    ruleSetRevision: record.ruleSetRevision,
    seed: record.seed,
    ...(humanSeatPreference === undefined ? {} : { humanSeatPreference }),
    ...(names === undefined ? {} : { playerNames: names as string[] }),
  }
}

function candidates(events: readonly WerewolfEvent[]): GameEventCandidate[] {
  return events.map(event => ({ type: event.type, data: event.data as unknown as JsonValue }))
}

/** Domain adapter registered by the typed Werewolf Host plugin. */
export class WerewolfGameModule implements GameModule<WerewolfGameStateV1, JsonValue, JsonValue, WerewolfHumanViewV1, WerewolfReplayV1> {
  readonly id = 'werewolf'
  readonly version = 1
  readonly hostAgentPreset = 'werewolf'

  constructor(
    private readonly ctx: Context,
    private readonly runtime: WerewolfRuntime,
    private readonly ids: WerewolfEngineIds = defaultWerewolfEngineIds(),
  ) {}

  /** @inheritdoc */
  async prepareStart(
    input: JsonValue,
    _principal: LocalGamePrincipalV1,
    requestId: GameRequestId,
    payloadDigest: string,
  ): Promise<PreparedGameStart<WerewolfGameStateV1>> {
    const parsed = parseStart(input)
    const raw = this.runtime.listRuleSets().get(`${parsed.ruleSetId}@${parsed.ruleSetRevision}`)
    if (raw === undefined) throw new WerewolfError('WEREWOLF_UNKNOWN_DEFINITION', `rule set ${parsed.ruleSetId}@${parsed.ruleSetRevision} is not registered`)
    const rules = this.runtime.resolveRuleSet(raw as unknown as JsonValue)
    const step = startWerewolfGame({
      ruleSet: rules,
      seed: parsed.seed,
      ...(parsed.humanSeatPreference === undefined ? {} : { humanSeatPreference: parsed.humanSeatPreference }),
      ...(parsed.playerNames === undefined ? {} : { playerNames: parsed.playerNames }),
      ids: this.ids,
    })
    const event = step.events[0]
    /* v8 ignore next -- startWerewolfGame always returns exactly one game-started event */
    if (event?.type !== 'werewolf/game-started') throw new Error('werewolf start did not emit game-started')
    event.data.request = { requestId, digest: payloadDigest }
    return {
      gameId: GameId(step.state.gameId),
      participantId: ParticipantId(step.state.humanPlayerId),
      state: step.state,
      events: candidates(step.events),
    }
  }

  /** @inheritdoc */
  restore(events: readonly SessionEvent[]): WerewolfGameStateV1 | undefined { return reduceWerewolfGame(events) }
  /** @inheritdoc */
  gameId(state: WerewolfGameStateV1): GameId { return GameId(state.gameId) }
  /** @inheritdoc */
  revision(state: WerewolfGameStateV1): number { return state.revision }
  /** @inheritdoc */
  status(state: WerewolfGameStateV1): WerewolfGameStateV1['status'] { return state.status }

  /** @inheritdoc */
  async mutate(state: WerewolfGameStateV1, request: GameMutationRequest) {
    if (request.participantId !== ParticipantId(state.humanPlayerId)) throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'participant is not the human seat')
    const mutation = { requestId: request.requestId as string, digest: request.payloadDigest }
    if (request.method === 'submitAction') {
      const input = asRecord(request.payload, 'action input')
      if (typeof input.phaseInstanceId !== 'string' || input.phaseInstanceId !== state.openPhase?.phaseInstanceId) throw new WerewolfError('WEREWOLF_STALE_REVISION', 'action answers another phase instance')
      if (input.action === undefined) throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'action input is missing action')
      const step = submitWerewolfHumanAction(state, input.action, this.ids, mutation)
      return { state: step.state, events: candidates(step.events) }
    }
    if (request.method === 'resume') {
      const step = resumeWerewolfGame(state, mutation)
      return { state: step.state, events: candidates(step.events) }
    }
    const step = abortWerewolfGame(state, mutation)
    return { state: step.state, events: candidates(step.events) }
  }

  /** @inheritdoc */
  async advance(
    state: WerewolfGameStateV1,
    history: readonly SessionEvent[],
    executor: GameAiExecutor,
  ): Promise<GameAdvance<WerewolfGameStateV1>> {
    const rules = this.rules(state)
    const config = this.runtime.botRunnerConfig()
    const bots = state.players.filter(player => !player.human)
    await executor.map(bots, config.maxConcurrentBots, async (player) => {
      await executor.provisionBot({
        childId: werewolfBotSessionId(state, player.playerId),
        label: `Werewolf seat ${player.seat} · ${player.displayName}`,
        ...(config.botAgent === undefined ? {} : { agentOptions: config.botAgent }),
        persona: werewolfBotPersona(state, rules, player.playerId),
        toolFilter: { allow: [] },
      })
    })
    if (state.openPhase === null) {
      const step = openNextWerewolfPhase(state, rules, this.ids)
      return { state: step.state, events: candidates(step.events), stop: step.state.status !== 'running' }
    }
    const remaining = werewolfRemainingActors(state.openPhase)
    if (remaining.length === 0) {
      const submissions = collectWerewolfResolveSubmissions(history.filter(isWerewolfEvent), state.openPhase)
      const step = resolveOpenWerewolfPhase(state, rules, submissions, this.ids)
      return { state: step.state, events: candidates(step.events), stop: false }
    }
    const first = remaining[0]
    const humanPending = state.openPhase.plan.mode === 'parallel-private'
      ? remaining.some(actor => actor.playerId === state.humanPlayerId)
      : first?.playerId === state.humanPlayerId
    if (humanPending) return { state, events: [], stop: true }
    const requests = buildWerewolfBotRequests(state, this.ids)
    /* v8 ignore next -- a non-human pending actor always produces one request */
    if (requests.length === 0) return { state, events: [], stop: true }
    const outcomes = await executor.map(requests, config.maxConcurrentBots, async request => await runWerewolfBotDecision({
      ctx: this.ctx,
      config,
      state,
      rules,
      request,
      agent: executor.host,
      executor,
      signal: executor.signal,
    }))
    const attempts = outcomes.flatMap(outcome => outcome.attempts)
    const pause = outcomes.find(outcome => outcome.kind === 'paused' || outcome.kind === 'cancelled')
    if (pause !== undefined) {
      const step = pauseWerewolfGame(state, pause.kind === 'cancelled' ? 'cancelled' : 'bot-failure')
      return { state: step.state, events: candidates([...attempts, ...step.events]), stop: true }
    }
    const completed = outcomes as Array<Extract<(typeof outcomes)[number], { kind: 'accepted' | 'trustee' }>>
    const submissions = completed.map(outcome => outcome.submission)
    const step = commitWerewolfBotDecisions(state, submissions, config.limits)
    return { state: step.state, events: candidates([...attempts, ...step.events]), stop: false }
  }

  /** @inheritdoc */
  project(state: WerewolfGameStateV1, participantId: ParticipantId): WerewolfHumanViewV1 {
    if (participantId !== ParticipantId(state.humanPlayerId)) throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'participant is not authorized for this view')
    return projectWerewolfHumanView(this.runtime, state, this.rules(state))
  }

  /** @inheritdoc */
  replay(state: WerewolfGameStateV1, history: readonly SessionEvent[], participantId: ParticipantId): WerewolfReplayV1 {
    if (state.status !== 'ended') throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', 'replay is available only after the game ends')
    if (participantId !== ParticipantId(state.humanPlayerId)) throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'participant is not authorized for this replay')
    const checkpoints: WerewolfReplayV1['checkpoints'] = []
    const prefix: SessionEvent[] = []
    for (const event of history) {
      prefix.push(event)
      if (!isWerewolfEvent(event) || event.type === 'werewolf/bot-attempt-failed') continue
      const checkpoint = reduceWerewolfGame(prefix)
      /* v8 ignore next -- a valid Host's first non-attempt Werewolf event is game-started */
      if (checkpoint === undefined) continue
      checkpoints.push({
        eventType: event.type,
        gameRevision: checkpoint.revision,
        view: projectWerewolfHumanView(this.runtime, checkpoint, this.rules(checkpoint)),
      })
    }
    return { version: 1, gameId: state.gameId, finalRevision: state.revision, checkpoints }
  }

  private rules(state: WerewolfGameStateV1): WerewolfCompiledRuleSetV1 {
    const rules = this.runtime.resolveRuleSet(state.ruleSet as unknown as JsonValue)
    if (rules.digest !== state.ruleSetDigest) throw new WerewolfError('WEREWOLF_STALE_REVISION', 'recorded rule-set digest no longer resolves')
    return rules
  }
}
