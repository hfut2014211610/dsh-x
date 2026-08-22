import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GameId, GameRequestId, ParticipantId, PrincipalId } from '@deepseek-ai/dsh-game'
import type { GameAiExecutor } from '@deepseek-ai/dsh-game'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import {
  openNextWerewolfPhase,
  pauseWerewolfGame,
  resumeWerewolfGame,
  startWerewolfGame,
} from '../src/engine.ts'
import { projectWerewolfHumanView } from '../src/human-projection.ts'
import type { WerewolfEvent } from '../src/events.ts'
import { WerewolfGameModule } from '../src/module-adapter.ts'
import WerewolfRuntime from '../src/runtime.ts'
import type { WerewolfGameStateV1, WerewolfRuleSetInputV1 } from '../src/types.ts'
import {
  counterIds,
  MINI_FACTION_ELIMINATION,
  MINI_KILL,
  MINI_NEVER,
  MINI_NOOP,
  MINI_TALK,
  MINI_VILLAGER,
  MINI_VOTE,
  MINI_WOLF,
  miniRuleSet,
} from './fixtures.ts'

const CAPABLE: SubagentProvider['capabilities'] = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

async function setup(options: { failurePolicy?: 'auto-action' | 'pause-game'; inheritsParentContext?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(WerewolfRuntime, {
    subagentProvider: 'module-test',
    botRetryLimit: 0,
    botFailurePolicy: options.failurePolicy ?? 'auto-action',
    maxConcurrentBots: 2,
  })
  ctx.subagents.registerProvider({
    name: 'module-test',
    capabilities: CAPABLE,
    inheritsParentContext: options.inheritsParentContext ?? false,
    start: async () => { throw new Error('executor must own module test starts') },
  })
  for (const role of [MINI_VILLAGER, MINI_WOLF]) ctx.werewolf.registerRole(role)
  for (const phase of [MINI_KILL, MINI_NOOP, MINI_TALK, MINI_VOTE]) ctx.werewolf.registerPhase(phase)
  for (const victory of [MINI_FACTION_ELIMINATION, MINI_NEVER]) ctx.werewolf.registerVictoryCondition(victory)
  const rules = miniRuleSet({ voteTie: 'no-elimination' })
  ctx.werewolf.registerRuleSet(rules.input)
  const module = new WerewolfGameModule(ctx, ctx.werewolf, counterIds())
  return { ctx, module, rules }
}

const principal = { version: 1 as const, kind: 'local' as const, id: PrincipalId('local') }

async function prepared(module: WerewolfGameModule, input: JsonValue = {
  ruleSetId: 'mini', ruleSetRevision: 1, seed: 12,
}) {
  return await module.prepareStart(input, principal, GameRequestId('start'), 'a'.repeat(64))
}

function projectionRuntime(ruleSets: readonly WerewolfRuleSetInputV1[]): WerewolfRuntime {
  return {
    listRuleSets: () => new Map(ruleSets.map(rule => [`${rule.id}@${rule.revision}`, rule])),
  } as unknown as WerewolfRuntime
}

const idleExecutor = (outcomes: unknown[] = []): GameAiExecutor => ({
  host: undefined as never,
  signal: new AbortController().signal,
  start: async () => { throw new Error('unexpected child start') },
  provisionBot: async () => {},
  turnBot: async () => { throw new Error('unexpected Bot turn') },
  map: async <T, R>(items: readonly T[], _max: number, worker: (item: T) => Promise<R>): Promise<R[]> => outcomes.length > 0
    ? outcomes as R[]
    : await Promise.all(items.map(worker)),
})

describe('WerewolfGameModule input and mutation boundaries', () => {
  it('rejects every invalid start field before Host creation', async () => {
    const { module } = await setup()
    const cases: Array<[JsonValue, RegExp]> = [
      [null, /start input must be an object/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: 1, extra: true }, /unknown key "extra"/],
      [{ ruleSetId: 1, ruleSetRevision: 1, seed: 1 }, /ruleSetId must be/],
      [{ ruleSetId: '', ruleSetRevision: 1, seed: 1 }, /ruleSetId must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: '1', seed: 1 }, /ruleSetRevision must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1.5, seed: 1 }, /ruleSetRevision must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 0, seed: 1 }, /ruleSetRevision must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: '1' }, /seed must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: 1.5 }, /seed must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: 1, humanSeatPreference: '1' }, /humanSeatPreference must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: 1, humanSeatPreference: 1.5 }, /humanSeatPreference must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: 1, playerNames: 'x' }, /playerNames must be/],
      [{ ruleSetId: 'mini', ruleSetRevision: 1, seed: 1, playerNames: ['x', 2] }, /playerNames must be/],
      [{ ruleSetId: 'missing', ruleSetRevision: 1, seed: 1 }, /not registered/],
    ]
    for (const [input, message] of cases) await expect(prepared(module, input)).rejects.toThrow(message)
  })

  it('supports optional human seat and names and records the start mutation identity', async () => {
    const { module } = await setup()
    const minimal = await prepared(module)
    expect(minimal.events[0]).toMatchObject({
      type: 'werewolf/game-started', data: { request: { requestId: 'start', digest: 'a'.repeat(64) } },
    })
    const named = await prepared(module, {
      ruleSetId: 'mini', ruleSetRevision: 1, seed: 13, humanSeatPreference: 2,
      playerNames: ['A', 'B', 'C', 'D', 'E'],
    })
    expect(named.state.players.find(player => player.human)?.seat).toBe(2)
    expect(named.state.players.map(player => player.displayName)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('does not depend on one-shot provider history semantics when preparing a game', async () => {
    const { module } = await setup({ inheritsParentContext: true })
    await expect(prepared(module)).resolves.toMatchObject({ gameId: GameId('g1') })
  })

  it('validates participant, phase identity, and action presence', async () => {
    const { module, rules } = await setup()
    const started = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
    const opened = openNextWerewolfPhase(started.state, rules, counterIds())
    const actor = opened.state.openPhase?.plan.actors[0]
    const phaseInstanceId = opened.state.openPhase?.phaseInstanceId
    if (actor === undefined || phaseInstanceId === undefined) throw new Error('missing action actor fixture')
    const state = { ...opened.state, humanPlayerId: actor.playerId }
    const base = {
      method: 'submitAction' as const,
      participantId: ParticipantId(actor.playerId),
      requestId: GameRequestId('action'),
      payloadDigest: 'b'.repeat(64),
    }
    await expect(module.mutate(state, { ...base, participantId: ParticipantId('other'), payload: null }))
      .rejects.toThrow(/not the human seat/)
    await expect(module.mutate(state, { ...base, payload: { phaseInstanceId: 1, action: null } }))
      .rejects.toThrow(/another phase instance/)
    await expect(module.mutate(state, { ...base, payload: { phaseInstanceId: 'wrong', action: null } }))
      .rejects.toThrow(/another phase instance/)
    await expect(module.mutate(state, { ...base, payload: { phaseInstanceId } }))
      .rejects.toThrow(/missing action/)
    const target = actor.spec.kind === 'player-target' ? actor.spec.targets[0] ?? null : null
    await expect(module.mutate(state, {
      ...base,
      payload: { phaseInstanceId, action: { value: target } },
    })).resolves.toMatchObject({ events: [{ type: 'werewolf/human-action' }] })
  })

  it('records the open phase and a detail payload on pause, with a receipt on resume', async () => {
    const world = await setup()
    const start = await prepared(world.module)
    const opened = openNextWerewolfPhase(start.state, world.rules, counterIds())
    const paused = pauseWerewolfGame(opened.state, 'cancelled', { attempt: 3 })
    expect(paused.events[0]).toMatchObject({
      type: 'werewolf/game-paused',
      data: { reason: 'cancelled', phaseInstanceId: expect.any(String) as string, detail: { attempt: 3 } },
    })
    const resumed = resumeWerewolfGame(paused.state, { requestId: 'resume-once', digest: 'a'.repeat(64) })
    expect(resumed.events[0]).toMatchObject({
      type: 'werewolf/game-resumed',
      data: { request: { requestId: 'resume-once' } },
    })
    expect(() => resumeWerewolfGame(start.state)).toThrow(/not paused/)
    const bare = pauseWerewolfGame(opened.state, 'operator-request')
    const bareData = (bare.events[0] as WerewolfEvent<'werewolf/game-paused'>).data
    expect(bareData).toMatchObject({ reason: 'operator-request' })
    expect(bareData).not.toHaveProperty('detail')
    const bareResume = resumeWerewolfGame(bare.state)
    const bareResumeData = (bareResume.events[0] as WerewolfEvent<'werewolf/game-resumed'>).data
    expect(bareResumeData).toMatchObject({ retryEpoch: 1 })
    expect(bareResumeData).not.toHaveProperty('request')
  })

  it('resumes paused games and aborts games without recreating one-shot children', async () => {
    const first = await setup()
    const start = await prepared(first.module)
    const paused = pauseWerewolfGame(start.state, 'bot-failure').state
    await expect(first.module.mutate(paused, {
      method: 'resume', participantId: start.participantId, payload: null,
      requestId: GameRequestId('resume'), payloadDigest: 'c'.repeat(64),
    })).resolves.toMatchObject({ events: [{ type: 'werewolf/game-resumed' }] })
    await expect(first.module.mutate(start.state, {
      method: 'abortGame', participantId: start.participantId, payload: null,
      requestId: GameRequestId('abort'), payloadDigest: 'd'.repeat(64),
    })).resolves.toMatchObject({ events: [{ type: 'werewolf/game-ended' }] })

    const inherited = await setup({ inheritsParentContext: true })
    const inheritedState = pauseWerewolfGame(start.state, 'bot-failure').state
    await expect(inherited.module.mutate(inheritedState, {
      method: 'resume', participantId: start.participantId, payload: null,
      requestId: GameRequestId('resume-inherited'), payloadDigest: 'e'.repeat(64),
    })).resolves.toMatchObject({ state: { status: 'running' } })
  })
})

describe('WerewolfGameModule advancement, projection, and replay', () => {
  it('opens a phase and stops when the human actor is pending', async () => {
    const { module, rules } = await setup()
    const start = await prepared(module)
    const opened = await module.advance(start.state, [], idleExecutor())
    expect(opened.events[0]?.type).toBe('werewolf/phase-opened')
    const actor = opened.state.openPhase?.plan.actors[0]
    if (actor === undefined) throw new Error('missing actor fixture')
    const humanPending = { ...opened.state, humanPlayerId: actor.playerId }
    await expect(module.advance(humanPending, opened.events as unknown as SessionEvent[], idleExecutor()))
      .resolves.toMatchObject({ events: [], stop: true })

    const publicPending = {
      ...humanPending,
      openPhase: humanPending.openPhase === null ? null : {
        ...humanPending.openPhase,
        plan: { ...humanPending.openPhase.plan, mode: 'seat-order-public' as const },
      },
    }
    await expect(module.advance(publicPending, [], idleExecutor())).resolves.toMatchObject({ events: [], stop: true })
    expect(rules.input.id).toBe('mini')
  })

  it('pauses on failed or cancelled Bot outcomes and preserves attempt events', async () => {
    const { module } = await setup({ failurePolicy: 'pause-game' })
    const start = await prepared(module)
    const opened = await module.advance(start.state, [], idleExecutor())
    const attempt = {
      type: 'werewolf/bot-attempt-failed',
      data: {
        version: 1, gameId: opened.state.gameId, gameRevision: opened.state.revision,
        decisionId: 'd1', playerId: opened.state.openPhase?.plan.actors[0]?.playerId,
        phaseInstanceId: opened.state.openPhase?.phaseInstanceId, attempt: 1, retryEpoch: 0,
        childSessionId: 'child', category: 'timeout', diagnostic: 'timeout',
      },
    }
    for (const kind of ['paused', 'cancelled'] as const) {
      const step = await module.advance(opened.state, [], idleExecutor([{ kind, attempts: [attempt] }]))
      expect(step.state).toMatchObject({ status: 'paused', pauseReason: kind === 'cancelled' ? 'cancelled' : 'bot-failure' })
      expect(step.events.map(event => event.type)).toEqual(['werewolf/bot-attempt-failed', 'werewolf/game-paused'])
    }
  })

  it('enforces participant authorization, terminal replay, and rule digest stability', async () => {
    const { module } = await setup()
    const start = await prepared(module)
    expect(module.gameId(start.state)).toBe(GameId(start.state.gameId))
    expect(module.revision(start.state)).toBe(1)
    expect(module.status(start.state)).toBe('running')
    await expect(Promise.resolve().then(() => module.project(start.state, ParticipantId('other')))).rejects.toThrow(/not authorized/)
    expect(() => module.replay(start.state, [], start.participantId)).toThrow(/only after the game ends/)
    const ended = (await module.mutate(start.state, {
      method: 'abortGame', participantId: start.participantId, payload: null,
      requestId: GameRequestId('abort-replay'), payloadDigest: 'f'.repeat(64),
    })).state
    expect(() => module.replay(ended, [], ParticipantId('other'))).toThrow(/not authorized/)
    const replayAbort = await module.mutate(start.state, {
      method: 'abortGame', participantId: start.participantId, payload: null,
      requestId: GameRequestId('abort-replay-2'), payloadDigest: '0'.repeat(64),
    })
    const replayAbortEvent = replayAbort.events[0]
    if (replayAbortEvent === undefined) throw new Error('missing replay abort fixture')
    expect(module.replay(ended, [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      ...start.events.map((event, seq) => ({ ...event, seq: seq + 1, time: seq + 2 } as SessionEvent)),
      { type: 'werewolf/bot-attempt-failed', seq: 3, time: 4, data: {
        version: 1, gameId: ended.gameId, gameRevision: ended.revision, decisionId: 'd', playerId: ended.humanPlayerId,
        phaseInstanceId: 'i', attempt: 1, retryEpoch: 0, childSessionId: 'c', category: 'timeout', diagnostic: 'x',
      } } as SessionEvent,
      { ...replayAbortEvent, seq: 4, time: 5 } as SessionEvent,
    ], start.participantId).checkpoints.length).toBeGreaterThan(0)

    const stale = { ...start.state, ruleSetDigest: 'stale' }
    await expect(module.advance(stale, [], idleExecutor())).rejects.toThrow(/digest no longer resolves/)
    expect(() => module.project(stale, start.participantId)).toThrow(/digest no longer resolves/)
  })
})

describe('projectWerewolfHumanView', () => {
  it('sorts rule options, authorizes forms, copies secrets, and reveals roles only at terminal state', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
    const opened = openNextWerewolfPhase(started.state, rules, counterIds()).state
    const actor = opened.openPhase?.plan.actors[0]
    if (actor === undefined) throw new Error('missing projection actor fixture')
    const players = opened.players.map((player, index) => index === 0
      ? { ...player, deathDay: 1, deathCause: 'test' }
      : player)
    const humanIndex = players.findIndex(player => player.playerId === actor.playerId)
    const human = players[humanIndex]
    if (human === undefined) throw new Error('missing projection human fixture')
    players[humanIndex] = { ...human, notices: [{ toPlayerId: human.playerId, kind: 'secret', data: { x: 1 } }] }
    const state: WerewolfGameStateV1 = { ...opened, humanPlayerId: actor.playerId, players }
    const options = [
      { ...rules.input, id: 'z', revision: 1 },
      { ...rules.input, id: 'a', revision: 2 },
      { ...rules.input, id: 'a', revision: 1 },
    ] as WerewolfRuleSetInputV1[]
    const runtime = projectionRuntime(options)
    const view = projectWerewolfHumanView(runtime, state, rules)
    expect(view.availableRuleSets.map(option => `${option.id}@${option.revision}`)).toEqual(['a@1', 'a@2', 'z@1'])
    expect(view.actionForm?.phaseInstanceId).toBe(state.openPhase?.phaseInstanceId)
    expect(view.self.notices).toEqual([{ kind: 'secret', data: { x: 1 } }])
    expect(view.self.teammates.length).toBeGreaterThan(0)
    expect(view.players[0]).toMatchObject({ deathDay: 1, deathCause: 'test' })
    expect(view.players.every(player => player.revealedRole === undefined)).toBe(true)

    const ended: WerewolfGameStateV1 = {
      ...state,
      status: 'ended',
      openPhase: null,
      result: { outcome: { kind: 'aborted' }, evidence: [{ source: 'human-abort', data: {} }] },
    }
    const final = projectWerewolfHumanView(runtime, ended, rules)
    expect(final.phase).toBeNull()
    expect(final.actionForm).toBeNull()
    expect(final.result?.outcome.kind).toBe('aborted')
    expect(final.players.every(player => player.revealedRole !== undefined)).toBe(true)
  })

  it('withholds forms after settlement, behind another public actor, and from non-actors', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const opened = openNextWerewolfPhase(
      startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() }).state,
      rules,
      counterIds(),
    ).state
    const actors = opened.openPhase?.plan.actors
    const human = actors?.[1] ?? actors?.[0]
    if (human === undefined || opened.openPhase === null) throw new Error('missing form fixture')
    const runtime = projectionRuntime([rules.input])
    const publicState: WerewolfGameStateV1 = {
      ...opened,
      humanPlayerId: human.playerId,
      openPhase: { ...opened.openPhase, plan: { ...opened.openPhase.plan, mode: 'seat-order-public' } },
    }
    const publicView = projectWerewolfHumanView(runtime, publicState, rules)
    expect(publicView.actionForm).toBeNull()
    expect(publicView.phase?.speech?.completed).toBe(0)
    expect(publicView.phase?.speech?.total).toBe(actors?.length)
    expect(publicView.phase?.speech?.current?.playerId).toBe(actors?.[0]?.playerId)
    const settled: WerewolfGameStateV1 = {
      ...opened,
      humanPlayerId: human.playerId,
      openPhase: { ...opened.openPhase, settled: [{ playerId: human.playerId, humanActionId: 'h' as never }] },
    }
    expect(projectWerewolfHumanView(runtime, settled, rules).actionForm).toBeNull()
    const nonActor = opened.players.find(player => !actors?.some(actor => actor.playerId === player.playerId))
    if (nonActor === undefined) throw new Error('missing non-actor fixture')
    expect(projectWerewolfHumanView(runtime, { ...opened, humanPlayerId: nonActor.playerId }, rules).actionForm).toBeNull()
  })

  it('fails loud for a missing human or role and omits unavailable terminal role definitions', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() }).state
    const runtime = projectionRuntime([rules.input])
    expect(() => projectWerewolfHumanView(runtime, { ...started, humanPlayerId: 'missing' as never }, rules)).toThrow(/no human player/)
    const human = started.players.find(player => player.playerId === started.humanPlayerId)
    if (human === undefined) throw new Error('missing human fixture')
    const missingOwnRole = {
      ...started,
      players: started.players.map(player => player.playerId === human.playerId ? { ...player, roleId: 'missing' } : player),
    }
    expect(() => projectWerewolfHumanView(runtime, missingOwnRole, rules)).toThrow(/role missing@1 is unavailable/)
    const other = started.players.find(player => player.playerId !== human.playerId)
    if (other === undefined) throw new Error('missing other fixture')
    const ended: WerewolfGameStateV1 = {
      ...started,
      status: 'ended',
      players: started.players.map(player => player.playerId === other.playerId ? { ...player, roleId: 'missing' } : player),
      result: { outcome: { kind: 'aborted' }, evidence: [] },
    }
    expect(projectWerewolfHumanView(runtime, ended, rules).players.find(player => player.playerId === other.playerId))
      .not.toHaveProperty('revealedRole')
  })

  it('withholds faction teammates from roles without that entitlement', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() }).state
    const villager = started.players.find(player => player.roleId === 'mini.villager')
    if (villager === undefined) throw new Error('missing villager fixture')
    const runtime = projectionRuntime([rules.input])
    expect(projectWerewolfHumanView(runtime, { ...started, humanPlayerId: villager.playerId }, rules).self.teammates).toEqual([])
  })
})
