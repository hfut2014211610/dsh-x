import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WerewolfInvariant from '../src/invariant.ts'
import { driveWerewolfGame, startWerewolfGame } from '../src/engine.ts'
import type { WerewolfEvent } from '../src/events.ts'
import { counterIds, EMPTY_DELTA, miniRuleSet, testLimits } from './fixtures.ts'
import { applyWerewolfBotContextDelta, initialWerewolfBotContext } from '../src/bot-context.ts'
import { WerewolfDecisionId, WerewolfGameId, WerewolfPhaseInstanceId, WerewolfPlayerId } from '../src/brand.ts'
import type { WerewolfActionActorV1, WerewolfDecisionEntryV1, WerewolfResolutionV1 } from '../src/types.ts'

async function setup(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(WerewolfInvariant)
  return { ctx, session: ctx.sessions.create() }
}

function validSequence(): WerewolfEvent[] {
  const rules = miniRuleSet({ voteTie: 'no-elimination' })
  const { state, events: startEvents } = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
  const driven = driveWerewolfGame(state, rules, {
    bot: request => ({
      action: request.spec.kind === 'player-target'
        ? { value: request.spec.targets[0] ?? null }
        : { value: request.spec.kind === 'text' ? 'words' : null },
      contextDelta: EMPTY_DELTA,
    }),
    limits: testLimits(),
    ids: counterIds(),
  })
  return [...startEvents, ...driven.events.slice(0, 6)]
}

function asSessionEvent(event: WerewolfEvent): SessionEvent {
  return { type: event.type, seq: 0, time: 0, data: event.data } as SessionEvent
}

describe('werewolf durable-event invariants', () => {
  it('accepts a valid engine-produced sequence', async () => {
    const { ctx, session } = await setup()
    expect(() => {
      for (const event of validSequence()) ctx.emit('session/event', session, asSessionEvent(event))
    }).not.toThrow()
  })

  it('ignores non-werewolf events', async () => {
    const { ctx, session } = await setup()
    expect(() => {
      ctx.emit('session/event', session, { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } as SessionEvent)
      ctx.emit('tools/change')
    }).not.toThrow()
  })

  it('rejects a wrong payload version and a mid-log game switch', async () => {
    const sequence = validSequence()
    const { ctx, session } = await setup()
    ctx.emit('session/event', session, asSessionEvent(sequence[0] as WerewolfEvent))
    const badVersion = structuredClone(sequence[1] as WerewolfEvent)
    badVersion.data.version = 2 as never
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(badVersion)) }).toThrow(/version 2/)
    const switched = structuredClone(sequence[1] as WerewolfEvent)
    switched.data.gameId = 'other' as never
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(switched)) }).toThrow(/switches game/)
  })

  it('rejects events before any game start, after the terminal event, and non-contiguous revisions', async () => {
    const sequence = validSequence()
    const start = sequence[0] as WerewolfEvent<'werewolf/game-started'>
    const orphan = structuredClone(sequence[3] as WerewolfEvent)
    {
      const { ctx, session } = await setup()
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(orphan)) }).toThrow(/before any werewolf\/game-started/)
    }
    {
      const { ctx, session } = await setup()
      const ended = structuredClone(sequence.at(-1) as WerewolfEvent)
      ended.type = 'werewolf/game-ended'
      ended.data = {
        version: 1,
        gameId: start.data.gameId,
        gameRevision: 2,
        result: { outcome: { kind: 'aborted' }, evidence: [{ source: 'human-abort', data: {} }] },
      } as never
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(ended))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(sequence[1] as WerewolfEvent)) })
        .toThrow(/follows the terminal/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      const skipped = structuredClone(sequence[1] as WerewolfEvent)
      skipped.data.gameRevision = 5
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(skipped)) }).toThrow(/must be contiguous/)
      const attempt = {
        type: 'werewolf/bot-attempt-failed',
        data: {
          version: 1,
          gameId: start.data.gameId,
          gameRevision: 9 as never,
          decisionId: 'd' as never,
          playerId: start.data.botProfiles[0]?.playerId as never,
          phaseInstanceId: WerewolfPhaseInstanceId('i'),
          attempt: 1,
          retryEpoch: 0,
          childSessionId: 's',
          category: 'timeout',
        },
      } as never as WerewolfEvent
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(attempt)) }).toThrow(/must equal the current revision/)
    }
  })

  it('rejects duplicate ids, double opens, illegal pause/resume, and bad phase transitions', async () => {
    const sequence = validSequence()
    const start = sequence[0] as WerewolfEvent<'werewolf/game-started'>
    const opened = sequence.find(event => event.type === 'werewolf/phase-opened' && event.data.outcome === 'awaiting') as WerewolfEvent<'werewolf/phase-opened'>
    const duplicated = structuredClone(opened)
    const { ctx, session } = await setup()
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(opened))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(duplicated)) }).toThrow(/appears twice|must be contiguous|while another is open/)
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(opened))
      const again = structuredClone(opened)
      again.data = { ...again.data, phaseInstanceId: WerewolfPhaseInstanceId('fresh'), gameRevision: 3 }
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(again)) }).toThrow(/while another is open/)
    }
    {
      const { ctx, session } = await setup()
      const paused = {
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: start.data.gameId, gameRevision: 2, reason: 'cancelled' },
      } as never as WerewolfEvent<'werewolf/game-paused'>
      const resumed = { type: 'werewolf/game-resumed', data: { version: 1, gameId: start.data.gameId, gameRevision: 2, retryEpoch: 1 } } as never as WerewolfEvent<'werewolf/game-resumed'>
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(paused))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent({ ...paused, data: { ...structuredClone(paused.data), gameRevision: 3 } })) }).toThrow(/pauses an already-paused/)
      const { ctx: ctx2, session: session2 } = await setup()
      ctx2.emit('session/event', session2, asSessionEvent(start))
      expect(() =>{  ctx2.emit('session/event', session2, asSessionEvent(resumed)) }).toThrow(/resumes a running game/)
    }
  })

  it('rejects human actions and bot decisions that do not match the open phase', async () => {
    const sequence = validSequence()
    const start = sequence[0] as WerewolfEvent<'werewolf/game-started'>
    const opened = sequence.find(event => event.type === 'werewolf/phase-opened' && event.data.outcome === 'awaiting') as WerewolfEvent<'werewolf/phase-opened'>
    const bot = start.data.botProfiles[0]
    if (bot === undefined) throw new Error('fixture produced no bots')
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      const human = {
        type: 'werewolf/human-action',
        data: {
          version: 1,
          gameId: start.data.gameId,
          gameRevision: 2,
          humanActionId: 'h1' as never,
          phaseInstanceId: WerewolfPhaseInstanceId('nowhere'),
          playerId: start.data.humanPlayerId,
          action: {},
        },
      } as never as WerewolfEvent
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(human)) }).toThrow(/no open phase/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(opened))
      const botFromElsewhere = {
        type: 'werewolf/bot-decision',
        data: {
          version: 1,
          gameId: start.data.gameId,
          gameRevision: 3,
          sourceGameRevision: 2,
          phaseInstanceId: WerewolfPhaseInstanceId('elsewhere'),
          mode: opened.data.plan?.mode ?? 'parallel-private',
          entries: [],
        },
      } as never as WerewolfEvent
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botFromElsewhere)) }).toThrow(/different phase instance/)
      const wrongMode = structuredClone(botFromElsewhere)
      wrongMode.data = { ...wrongMode.data, phaseInstanceId: opened.data.phaseInstanceId, mode: 'seat-order-public' as never }
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(wrongMode)) }).toThrow(/mode disagrees/)
    }
  })

  it('rejects bot decisions with stale contexts or tampered contextAfter', async () => {
    const sequence = validSequence()
    const start = sequence[0] as WerewolfEvent<'werewolf/game-started'>
    const opened = sequence.find(event => event.type === 'werewolf/phase-opened' && event.data.outcome === 'awaiting') as WerewolfEvent<'werewolf/phase-opened'>
    const bot = start.data.botProfiles[0]
    if (bot === undefined || opened.data.plan === undefined) throw new Error('fixture produced no bot actors')
    const actor = opened.data.plan.actors.find(entry => entry.playerId === bot.playerId)
      ?? opened.data.plan.actors[0]
    if (actor === undefined) throw new Error('no actor rows')
    const envelope = {
      type: 'werewolf/bot-decision',
      data: {
        version: 1,
        gameId: start.data.gameId,
        gameRevision: 3,
        sourceGameRevision: 2,
        phaseInstanceId: opened.data.phaseInstanceId,
        mode: opened.data.plan.mode,
        entries: [{
          decisionId: 'fresh-d' as never,
          playerId: actor.playerId,
          phaseInstanceId: opened.data.phaseInstanceId,
          actorContextRevision: 5 as never,
          action: { value: null },
          contextDelta: {},
          contextAfter: null as never,
        }],
      },
    } as never as WerewolfEvent
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(opened))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(envelope)) }).toThrow(/context revision/)
    }
  })

  it('rejects resolutions with non-roster references or negative resources', async () => {
    const sequence = validSequence()
    const start = sequence[0] as WerewolfEvent<'werewolf/game-started'>
    const resolved = {
      type: 'werewolf/phase-resolved',
      data: {
        version: 1,
        gameId: start.data.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i'),
        decisionIds: [],
        humanActionIds: [],
        resolution: {
          eliminations: [],
          prevented: [{ playerId: WerewolfPhaseInstanceId('ghost') as never, cause: 'x' }],
          resourceReplacements: [{ playerId: start.data.roster[0]?.playerId as never, resourceId: 'antidote', remaining: -1 }],
          roleStateReplacements: [],
          privateNotices: [],
          announcements: [],
          votes: [],
          outcome: {},
        },
        rngState: 0,
      },
    } as never as WerewolfEvent
    const { ctx, session } = await setup()
    ctx.emit('session/event', session, asSessionEvent(start))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolved)) }).toThrow(/non-roster player|lands with no open phase/)
    const invalidVote = structuredClone(resolved)
    invalidVote.data = {
      ...invalidVote.data,
      resolution: {
        ...structuredClone((invalidVote.data as never as { resolution: WerewolfResolutionV1 }).resolution),
        prevented: [],
        resourceReplacements: [],
        votes: [{ voterId: start.data.roster[0]?.playerId as never, targetId: WerewolfPhaseInstanceId('ghost') as never }],
      },
    }
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(invalidVote)) }).toThrow(/non-roster player/)
    const negative = structuredClone(resolved)
    negative.data = {
      ...negative.data,
      resolution: { ...structuredClone((negative.data as never as { resolution: WerewolfResolutionV1 }).resolution), prevented: [] },
    }
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(negative)) }).toThrow(/resource/)
  })

  it('rejects malformed terminal results and non-monotone cursor positions', async () => {
    const sequence = validSequence()
    const start = sequence[0] as WerewolfEvent<'werewolf/game-started'>
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      const ended = {
        type: 'werewolf/game-ended',
        data: {
          version: 1,
          gameId: start.data.gameId,
          gameRevision: 2,
          result: { outcome: { kind: 'tie' }, evidence: [] },
        },
      } as never as WerewolfEvent
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(ended)) }).toThrow(/without evidence/)
      const mislabeled = structuredClone(ended)
      mislabeled.data = {
        ...mislabeled.data,
        result: { outcome: { kind: 'tie' }, evidence: [{ source: 'max-days', data: {}, conditionId: 'c' }] },
      }
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(mislabeled)) }).toThrow(/must not carry condition fields/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      const opened = sequence.find(event => event.type === 'werewolf/phase-opened' && event.data.outcome === 'awaiting') as WerewolfEvent<'werewolf/phase-opened'>
      ctx.emit('session/event', session, asSessionEvent(opened))
      const backwards = structuredClone(opened)
      backwards.data = {
        ...backwards.data,
        phaseInstanceId: WerewolfPhaseInstanceId('pos'),
        gameRevision: 4,
        cursorIndex: 0,
        occurrence: 0,
      }
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(backwards)) }).toThrow(/does not advance monotonically|must be contiguous|appears twice/)
      const dayJump = structuredClone(opened)
      dayJump.data = {
        ...dayJump.data,
        phaseInstanceId: WerewolfPhaseInstanceId('day'),
        gameRevision: 5,
        day: 7,
      }
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(dayJump)) }).toThrow(/jumps from day|must be contiguous|appears twice|does not advance monotonically/)
    }
  })
})

describe('werewolf invariant crafted-event cases', () => {
  interface OpenedOverride {
    gameRevision?: number
    phaseInstanceId?: string
    day?: number
    segment?: 'setup' | 'night' | 'day'
    cursorIndex?: number
    occurrence?: number
    outcome?: 'awaiting' | 'skipped'
    plan?: { mode: 'parallel-private' | 'seat-order-public'; actors: WerewolfActionActorV1[] }
  }

  const startGame = () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state, events } = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
    const start = events[0] as WerewolfEvent<'werewolf/game-started'>
    return { state, start }
  }

  const actorRow = (playerId: WerewolfPlayerId, seat: number) => ({
    playerId,
    seat,
    actionKind: 'kill',
    spec: { kind: 'player-target' as const, targets: [] as readonly WerewolfPlayerId[], allowSkip: true },
  })

  const openedEvent = (gameId: WerewolfGameId, override: OpenedOverride = {}): WerewolfEvent<'werewolf/phase-opened'> => ({
    type: 'werewolf/phase-opened',
    data: {
      version: 1,
      gameId,
      gameRevision: override.gameRevision ?? 2,
      phaseInstanceId: WerewolfPhaseInstanceId(override.phaseInstanceId ?? 'i1'),
      phaseId: 'night.kill',
      phaseVersion: 1,
      segment: override.segment ?? 'night',
      day: override.day ?? 1,
      cursorIndex: override.cursorIndex ?? 0,
      occurrence: override.occurrence ?? 0,
      outcome: override.outcome ?? 'awaiting',
      ...(override.outcome === 'skipped' ? { skipReason: 'nothing to do' } : { plan: override.plan ?? { mode: 'parallel-private', actors: [] } }),
      rngState: 0,
    },
  })

  const humanEvent = (gameId: WerewolfGameId, data: {
    gameRevision: number
    playerId: WerewolfPlayerId
    humanActionId: string
    phaseInstanceId?: string
    request?: { requestId: string; digest: string }
  }): WerewolfEvent<'werewolf/human-action'> => ({
    type: 'werewolf/human-action',
    data: {
      version: 1,
      gameId,
      gameRevision: data.gameRevision,
      humanActionId: WerewolfDecisionId(data.humanActionId) as never,
      phaseInstanceId: WerewolfPhaseInstanceId(data.phaseInstanceId ?? 'i1'),
      playerId: data.playerId,
      action: { value: null },
      ...(data.request === undefined ? {} : { request: data.request }),
    },
  })

  const contextOf = (start: WerewolfEvent<'werewolf/game-started'>, playerId: WerewolfPlayerId) => {
    const rosterIds = [...start.data.roster].sort((a, b) => a.seat - b.seat).map(entry => entry.playerId)
    const profile = start.data.botProfiles.find(entry => entry.playerId === playerId)?.profile
    if (profile === undefined) throw new Error(`player ${playerId} has no bot profile`)
    return initialWerewolfBotContext(start.data.gameId, playerId, profile, rosterIds)
  }

  const entryFor = (start: WerewolfEvent<'werewolf/game-started'>, playerId: WerewolfPlayerId, decisionId: string, delta: object = {}, actionKind = 'kill') => {
    const context = contextOf(start, playerId)
    const contextAfter = applyWerewolfBotContextDelta(context, delta, {
      decisionId: WerewolfDecisionId(decisionId),
      phaseId: 'night.kill',
      actionKind,
    })
    return {
      decisionId: WerewolfDecisionId(decisionId),
      playerId,
      phaseInstanceId: WerewolfPhaseInstanceId('i1'),
      actorContextRevision: context.revision,
      action: { value: null },
      contextDelta: delta,
      contextAfter,
    }
  }

  const botDecisionEvent = (gameId: WerewolfGameId, data: {
    gameRevision: number
    phaseInstanceId?: string
    entries: WerewolfDecisionEntryV1[]
  }): WerewolfEvent<'werewolf/bot-decision'> => ({
    type: 'werewolf/bot-decision',
    data: {
      version: 1,
      gameId,
      gameRevision: data.gameRevision,
      sourceGameRevision: data.gameRevision - 1,
      phaseInstanceId: WerewolfPhaseInstanceId(data.phaseInstanceId ?? 'i1'),
      mode: 'parallel-private',
      entries: data.entries,
    },
  })

  const botAttemptEvent = (gameId: WerewolfGameId, playerId: WerewolfPlayerId, data: {
    gameRevision: number
    phaseInstanceId?: string
    retryEpoch?: number
    attempt?: number
  }): WerewolfEvent<'werewolf/bot-attempt-failed'> => ({
    type: 'werewolf/bot-attempt-failed',
    data: {
      version: 1,
      gameId,
      gameRevision: data.gameRevision,
      decisionId: WerewolfDecisionId('attempt-decision'),
      playerId,
      phaseInstanceId: WerewolfPhaseInstanceId(data.phaseInstanceId ?? 'i1'),
      attempt: data.attempt ?? 1,
      retryEpoch: data.retryEpoch ?? 0,
      childSessionId: 'child',
      category: 'timeout',
    },
  })

  const resolvedEvent = (gameId: WerewolfGameId, data: {
    gameRevision: number
    phaseInstanceId?: string
    decisionIds?: string[]
    humanActionIds?: string[]
    eliminations?: WerewolfPlayerId[]
    withReplacements?: boolean
  }): WerewolfEvent<'werewolf/phase-resolved'> => ({
    type: 'werewolf/phase-resolved',
    data: {
      version: 1,
      gameId,
      gameRevision: data.gameRevision,
      phaseInstanceId: WerewolfPhaseInstanceId(data.phaseInstanceId ?? 'i1'),
      decisionIds: (data.decisionIds ?? []).map(id => WerewolfDecisionId(id)),
      humanActionIds: (data.humanActionIds ?? []).map(id => WerewolfDecisionId(id) as never),
      resolution: {
        eliminations: (data.eliminations ?? []).map(playerId => ({ playerId, cause: 'vote' })),
        prevented: [],
        resourceReplacements: data.withReplacements === true && data.eliminations !== undefined && data.eliminations.length > 0
          ? [{ playerId: data.eliminations[0] as WerewolfPlayerId, resourceId: 'antidote', remaining: 0 }]
          : [],
        roleStateReplacements: data.withReplacements === true && data.eliminations !== undefined && data.eliminations.length > 0
          ? [{ playerId: data.eliminations[0] as WerewolfPlayerId, roleState: {} }]
          : [],
        privateNotices: [],
        announcements: [],
        votes: [],
        outcome: {},
      },
      rngState: 0,
    },
  })

  it('accepts a start request, ignores an unknown werewolf prefix, and validates same-revision attempts', async () => {
    const { ctx, session } = await setup()
    const { state, start: rawStart } = startGame()
    const start = structuredClone(rawStart)
    start.data.request = { requestId: 'r1', digest: 'd1' }
    ctx.emit('session/event', session, asSessionEvent(start))
    const garbage = {
      type: 'werewolf/garbage',
      data: { version: 1, gameId: state.gameId, gameRevision: 1 },
    } as never as WerewolfEvent
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(garbage)) }).not.toThrow()
    const bot = start.data.botProfiles[0]
    if (bot === undefined) throw new Error('fixture produced no bots')
    const botPlayer = state.players.find(player => player.playerId === bot.playerId)
    if (botPlayer === undefined) throw new Error('bot profile is not on the roster')
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(botPlayer.playerId, botPlayer.seat)] },
    })))
    const attempt = {
      type: 'werewolf/bot-attempt-failed',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        decisionId: WerewolfDecisionId('d1'),
        playerId: bot.playerId,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        attempt: 1,
        retryEpoch: 0,
        childSessionId: 's',
        category: 'timeout',
      },
    } as never as WerewolfEvent
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(attempt)) }).not.toThrow()
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(attempt)) }).toThrow(/expected 2/)
  })

  it('rejects opening while paused and day-jumping positions', async () => {
    const { state, start } = startGame()
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: state.gameId, gameRevision: 2, reason: 'cancelled' },
      } as never))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 3 }))) })
        .toThrow(/opens while the game is paused/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2, outcome: 'skipped' })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 3,
        phaseInstanceId: 'i2',
        day: 3,
      }))) }).toThrow(/jumps from day 1 to day 3/)
    }
  })

  it('rejects non-advancing positions and accepts the advancing ones', async () => {
    const { state, start } = startGame()
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2, outcome: 'skipped' })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 3,
        phaseInstanceId: 'i2',
        occurrence: 0,
      }))) }).toThrow(/does not advance monotonically/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2, outcome: 'skipped', segment: 'day' })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 3,
        phaseInstanceId: 'i2',
        segment: 'night',
      }))) }).toThrow(/does not advance monotonically/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2, outcome: 'skipped', cursorIndex: 1 })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 3,
        phaseInstanceId: 'i2',
        cursorIndex: 0,
      }))) }).toThrow(/does not advance monotonically/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2, outcome: 'skipped' })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 3,
        phaseInstanceId: 'i2',
        occurrence: 1,
      }))) }).not.toThrow()
    }
  })

  it('rejects an awaiting open without an action plan', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    ctx.emit('session/event', session, asSessionEvent(start))
    const withoutPlan = openedEvent(state.gameId, { gameRevision: 2 })
    delete (withoutPlan.data as { plan?: unknown }).plan
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(withoutPlan)) }).toThrow(/lacks an action plan/)
  })

  it('accepts a human action against an open phase and its request record', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const actor = state.players.find(player => player.playerId === state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
    })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
      gameRevision: 3,
      playerId: actor.playerId,
      humanActionId: 'h1',
      request: { requestId: 'rq1', digest: 'd' },
    }))) }).not.toThrow()
  })

  it('rejects duplicate human action ids across events', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
    })))
    ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, { gameRevision: 3, playerId: human.playerId, humanActionId: 'h1' })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
      gameRevision: 4,
      playerId: human.playerId,
      humanActionId: 'h1',
    }))) }).toThrow(/appears twice/)
  })

  it('rejects a human action from a non-actor and a double settle', async () => {
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    const bot = state.players.find(player => player.playerId !== state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(bot.playerId, bot.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3,
        playerId: human.playerId,
        humanActionId: 'h9',
      }))) }).toThrow(/is not an actor/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, { gameRevision: 3, playerId: human.playerId, humanActionId: 'h1' })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 4,
        playerId: human.playerId,
        humanActionId: 'h2',
      }))) }).toThrow(/settles .* twice/)
    }
  })

  it('rejects seat-order skips and off-instance human actions', async () => {
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    const bots = state.players.filter(player => player.playerId !== state.humanPlayerId)
    const first = bots[0] as { playerId: WerewolfPlayerId; seat: number }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'seat-order-public', actors: [actorRow(first.playerId, first.seat), actorRow(human.playerId, human.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3,
        playerId: human.playerId,
        humanActionId: 'h2',
      }))) }).toThrow(/skips an earlier actor/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3,
        playerId: human.playerId,
        humanActionId: 'h1',
        phaseInstanceId: 'other',
      }))) }).toThrow(/targets a different phase instance/)
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3,
        playerId: human.playerId,
        humanActionId: 'h1',
      }))) }).not.toThrow()
    }
  })

  it('resets its per-game identities after a terminal event', async () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const ids = counterIds()
    const first = startWerewolfGame({ ruleSet: rules, seed: 1, ids })
    const second = startWerewolfGame({ ruleSet: rules, seed: 2, ids })
    const { ctx, session } = await setup()
    ctx.emit('session/event', session, asSessionEvent(first.events[0] as WerewolfEvent))
    ctx.emit('session/event', session, asSessionEvent({
      type: 'werewolf/game-ended',
      data: {
        version: 1,
        gameId: first.state.gameId,
        gameRevision: 2,
        result: { outcome: { kind: 'aborted' }, evidence: [{ source: 'human-abort', data: {} }] },
      },
    }))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(second.events[0] as WerewolfEvent)) })
      .not.toThrow()
  })

  it('rejects a bot decision without an open phase', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    ctx.emit('session/event', session, asSessionEvent(start))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, { gameRevision: 2, entries: [] }))) })
      .toThrow(/lands with no open phase/)
  })

  it('rejects duplicate decision ids inside one event', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const first = state.players[0] as { playerId: WerewolfPlayerId; seat: number }
    const second = state.players[1] as { playerId: WerewolfPlayerId; seat: number }
    const bots = [first.playerId, second.playerId].map(id => contextOf(start, id))
    expect(bots).toHaveLength(2)
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(first.playerId, first.seat), actorRow(second.playerId, second.seat)] },
    })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
      gameRevision: 3,
      entries: [entryFor(start, first.playerId, 'd1'), entryFor(start, second.playerId, 'd1')],
    }))) }).toThrow(/appears twice/)
  })

  it('rejects an entry naming a player with no bot context', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId)
    if (human === undefined) throw new Error('fixture has no human')
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
    })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
      gameRevision: 3,
      entries: [{
        decisionId: WerewolfDecisionId('d1'),
        playerId: human.playerId,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        actorContextRevision: 0,
        action: { value: null },
        contextDelta: {},
        contextAfter: {} as never,
      }],
    }))) }).toThrow(/no bot context/)
  })

  it('rejects an entry for a bot who is not an open-phase actor', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const bots = state.players.filter(player => player.playerId !== state.humanPlayerId)
    const actor = bots[0] as { playerId: WerewolfPlayerId; seat: number }
    const bystander = bots[1]
    if (bystander === undefined) throw new Error('fixture produced no bystander bot')
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
    })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
      gameRevision: 3,
      entries: [
        entryFor(start, bystander.playerId, 'd1', {}, ''),
        entryFor(start, actor.playerId, 'd2'),
      ],
    }))) }).toThrow(/not a pending actor/)
  })

  it('rejects a tampered contextAfter and an invalid context delta', async () => {
    const { state, start } = startGame()
    const actor = state.players.find(player => player.playerId !== state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
      })))
      const tampered = entryFor(start, actor.playerId, 'd1')
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [{ ...tampered, contextAfter: { ...tampered.contextAfter, revision: 99 } }],
      }))) }).toThrow(/carries a contextAfter that disagrees/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
      })))
      const invalid = entryFor(start, actor.playerId, 'd2', { bogus: 1 })
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [invalid],
      }))) }).toThrow(/invalid context delta/)
    }
  })

  it('rejects entries out of seat order', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const first = state.players[0] as { playerId: WerewolfPlayerId; seat: number }
    const second = state.players[1] as { playerId: WerewolfPlayerId; seat: number }
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(first.playerId, first.seat), actorRow(second.playerId, second.seat)] },
    })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
      gameRevision: 3,
      entries: [entryFor(start, second.playerId, 'd1'), entryFor(start, first.playerId, 'd2')],
    }))) }).toThrow(/not ordered by seat/)
  })

  it('accepts a resolved cycle with real eliminations and consistent ids', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const first = state.players[0] as { playerId: WerewolfPlayerId; seat: number }
    const second = state.players[1] as { playerId: WerewolfPlayerId; seat: number }
    const victim = state.players[4] as { playerId: WerewolfPlayerId }
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(first.playerId, first.seat), actorRow(second.playerId, second.seat)] },
    })))
    ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
      gameRevision: 3,
      entries: [entryFor(start, first.playerId, 'd1'), entryFor(start, second.playerId, 'd2')],
    })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
      gameRevision: 4,
      decisionIds: ['d1', 'd2'],
      eliminations: [victim.playerId],
      withReplacements: true,
    }))) }).not.toThrow()
  })

  it('rejects resolutions without an open phase, on other instances, with unsettled actors, or mismatched ids', async () => {
    const { state, start } = startGame()
    const actor = state.players.find(player => player.playerId !== state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, { gameRevision: 2 }))) })
        .toThrow(/lands with no open phase/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2 })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
        gameRevision: 3,
        phaseInstanceId: 'other',
      }))) }).toThrow(/targets a different phase instance/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, { gameRevision: 3 }))) })
        .toThrow(/unsettled actors/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { gameRevision: 2 })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
        gameRevision: 3,
        decisionIds: ['x'],
      }))) }).toThrow(/decision ids disagree/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [entryFor(start, actor.playerId, 'd1')],
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
        gameRevision: 4,
        decisionIds: ['d1'],
        humanActionIds: ['h1'],
      }))) }).toThrow(/human action ids disagree/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [entryFor(start, actor.playerId, 'duplicate-d1')],
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
        gameRevision: 4,
        decisionIds: ['duplicate-d1', 'duplicate-d1'],
      }))) }).toThrow(/repeats a decision id/)
    }
    {
      const human = state.players.find(player => player.playerId === state.humanPlayerId)
      if (human === undefined) throw new Error('fixture lacks a human')
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3,
        playerId: human.playerId,
        humanActionId: 'duplicate-h1',
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
        gameRevision: 4,
        humanActionIds: ['duplicate-h1', 'duplicate-h1'],
      }))) }).toThrow(/repeats a human action id/)
    }
  })

  it('accepts a human-settled resolution and a pause-resume cycle with requests', async () => {
    const { ctx, session } = await setup()
    const { state, start } = startGame()
    const actor = state.players.find(player => player.playerId === state.humanPlayerId) as { playerId: WerewolfPlayerId; seat: number }
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      gameRevision: 2,
      plan: { mode: 'parallel-private', actors: [actorRow(actor.playerId, actor.seat)] },
    })))
    ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, { gameRevision: 3, playerId: actor.playerId, humanActionId: 'h1' })))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
      gameRevision: 4,
      humanActionIds: ['h1'],
    }))) }).not.toThrow()
    ctx.emit('session/event', session, asSessionEvent({
      type: 'werewolf/game-paused',
      data: { version: 1, gameId: state.gameId, gameRevision: 5, reason: 'cancelled' },
    } as never))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent({
      type: 'werewolf/game-resumed',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 6,
        retryEpoch: 1,
        request: { requestId: 'r2', digest: 'd2' },
      },
    } as never)) }).not.toThrow()
    ctx.emit('session/event', session, asSessionEvent({
      type: 'werewolf/game-paused',
      data: { version: 1, gameId: state.gameId, gameRevision: 7, reason: 'cancelled' },
    } as never))
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent({
      type: 'werewolf/game-resumed',
      data: { version: 1, gameId: state.gameId, gameRevision: 8, retryEpoch: 2 },
    } as never)) }).not.toThrow()
  })

  it('rejects condition evidence lacking identity fields and accepts terminal requests', async () => {
    const { state, start } = startGame()
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-ended',
        data: {
          version: 1,
          gameId: state.gameId,
          gameRevision: 2,
          result: { outcome: { kind: 'faction' as never, factionId: 'village' }, evidence: [{ source: 'condition', data: {} }] },
        },
      } as never)) }).toThrow(/lacks condition id/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-ended',
        data: {
          version: 1,
          gameId: state.gameId,
          gameRevision: 2,
          result: {
            outcome: { kind: 'faction' as never, factionId: 'village' },
            evidence: [{ source: 'condition', conditionId: 'c', conditionVersion: 1, priority: 1, data: {} }],
          },
        },
      } as never)) }).not.toThrow()
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-ended',
        data: {
          version: 1,
          gameId: state.gameId,
          gameRevision: 2,
          request: { requestId: 'r3', digest: 'd3' },
          result: { outcome: { kind: 'aborted' }, evidence: [{ source: 'human-abort', data: {} }] },
        },
      } as never)) }).not.toThrow()
    }
  })

  it('rejects a second active game and malformed roster relationships', async () => {
    const { start } = startGame()
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(structuredClone(start))) })
        .toThrow(/second game before the active game ended/)
    }
    const first = start.data.roster[0]
    const second = start.data.roster[1]
    const bot = start.data.botProfiles[0]
    if (first === undefined || second === undefined || bot === undefined) throw new Error('fixture roster is incomplete')
    const duplicatePlayer = structuredClone(start)
    duplicatePlayer.data = {
      ...duplicatePlayer.data,
      roster: duplicatePlayer.data.roster.map((entry, index) => index === 1 ? { ...entry, playerId: first.playerId } : entry),
    }
    const duplicateSeat = structuredClone(start)
    duplicateSeat.data = {
      ...duplicateSeat.data,
      roster: duplicateSeat.data.roster.map((entry, index) => index === 1 ? { ...entry, seat: first.seat } : entry),
    }
    const wrongHuman = structuredClone(start)
    wrongHuman.data = { ...wrongHuman.data, humanPlayerId: bot.playerId }
    const missingBotProfile = structuredClone(start)
    missingBotProfile.data = { ...missingBotProfile.data, botProfiles: missingBotProfile.data.botProfiles.slice(1) }
    for (const [event, pattern] of [
      [duplicatePlayer, /repeats a roster player id/],
      [duplicateSeat, /repeats a roster seat/],
      [wrongHuman, /only human roster row/],
      [missingBotProfile, /cover every non-human player/],
    ] as const) {
      const { ctx, session } = await setup()
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(event)) }).toThrow(pattern)
    }
  })

  it('rejects duplicate or non-roster actors, wrong seats, and non-roster targets in an opened plan', async () => {
    const { state, start } = startGame()
    const actor = state.players[0]
    if (actor === undefined) throw new Error('fixture roster is empty')
    for (const [actors, pattern] of [
      [[actorRow(actor.playerId, actor.seat), actorRow(actor.playerId, actor.seat)], /repeats an action-plan actor/],
      [[actorRow(WerewolfPlayerId('ghost'), 99)], /names non-roster actor/],
      [[actorRow(actor.playerId, actor.seat + 10)], /the wrong seat/],
      [[{
        ...actorRow(actor.playerId, actor.seat),
        spec: { ...actorRow(actor.playerId, actor.seat).spec, targets: [WerewolfPlayerId('ghost')] },
      }], /non-roster target/],
      [[{
        ...actorRow(actor.playerId, actor.seat),
        spec: {
          kind: 'compound' as const,
          allowSkip: false,
          fields: [
            { id: 'note', spec: { kind: 'text' as const, maxChars: 8, allowSkip: true } },
            {
              id: 'target',
              spec: {
                kind: 'player-target' as const,
                targets: [WerewolfPlayerId('ghost')],
                allowSkip: false,
              },
            },
          ],
        },
      }], /non-roster target/],
    ] as const) {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        gameRevision: 2,
        plan: { mode: 'parallel-private', actors: [...actors] },
      }))) }).toThrow(pattern)
    }
  })

  it('rejects paused, non-human, and illegal human actions, then accepts the next public human', async () => {
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId)
    const bots = state.players.filter(player => player.playerId !== state.humanPlayerId).sort((a, b) => a.seat - b.seat)
    const bot = bots[0]
    const secondBot = bots[1]
    if (human === undefined || bot === undefined || secondBot === undefined) throw new Error('fixture lacks human or bots')
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actorRow(bot.playerId, bot.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3, playerId: bot.playerId, humanActionId: 'wrong-human',
      }))) }).toThrow(/not the human player/)
    }
    {
      const { ctx, session } = await setup()
      const strictActor = {
        ...actorRow(human.playerId, human.seat),
        spec: { ...actorRow(human.playerId, human.seat).spec, allowSkip: false },
      }
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [strictActor] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 3, playerId: human.playerId, humanActionId: 'illegal-human',
      }))) }).toThrow(/illegal/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: state.gameId, gameRevision: 3, reason: 'cancelled' },
      } as never))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 4, playerId: human.playerId, humanActionId: 'paused-human',
      }))) }).toThrow(/while the game is paused/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: {
          mode: 'seat-order-public',
          actors: [actorRow(bot.playerId, bot.seat), actorRow(secondBot.playerId, secondBot.seat), actorRow(human.playerId, human.seat)],
        },
      })))
      const firstBotDecision = botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [entryFor(start, bot.playerId, 'public-bot')],
      })
      firstBotDecision.data.mode = 'seat-order-public'
      ctx.emit('session/event', session, asSessionEvent(firstBotDecision))
      const secondBotDecision = botDecisionEvent(state.gameId, {
        gameRevision: 4,
        entries: [entryFor(start, secondBot.playerId, 'public-bot-2')],
      })
      secondBotDecision.data.mode = 'seat-order-public'
      ctx.emit('session/event', session, asSessionEvent(secondBotDecision))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(humanEvent(state.gameId, {
        gameRevision: 5, playerId: human.playerId, humanActionId: 'public-human',
      }))) }).not.toThrow()
    }
  })

  it('rejects invalid bot-attempt lifecycle state', async () => {
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId)
    const bot = state.players.find(player => player.playerId !== state.humanPlayerId)
    const secondBot = state.players.find(player => player.playerId !== state.humanPlayerId && player.playerId !== bot?.playerId)
    if (human === undefined || bot === undefined || secondBot === undefined) throw new Error('fixture lacks human or bots')
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, bot.playerId, {
        gameRevision: 1,
      }))) }).toThrow(/no current open phase/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actorRow(human.playerId, human.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, human.playerId, {
        gameRevision: 2,
      }))) }).toThrow(/not a bot actor/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actorRow(bot.playerId, bot.seat)] },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, bot.playerId, {
        gameRevision: 2, retryEpoch: 1,
      }))) }).toThrow(/retry epoch/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actorRow(bot.playerId, bot.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: state.gameId, gameRevision: 3, reason: 'cancelled' },
      } as never))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, bot.playerId, {
        gameRevision: 3,
      }))) }).toThrow(/while the game is paused/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actorRow(bot.playerId, bot.seat)] },
      })))
      ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [entryFor(start, bot.playerId, 'settled-bot')],
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, bot.playerId, {
        gameRevision: 3,
      }))) }).toThrow(/not a bot actor/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: {
          mode: 'seat-order-public',
          actors: [actorRow(human.playerId, human.seat), actorRow(bot.playerId, bot.seat)],
        },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, bot.playerId, {
        gameRevision: 2,
      }))) }).toThrow(/next seat-order-public actor/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: {
          mode: 'parallel-private',
          actors: [actorRow(human.playerId, human.seat), actorRow(bot.playerId, bot.seat)],
        },
      })))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, bot.playerId, {
        gameRevision: 2,
      }))) }).toThrow(/before the parallel human action/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: {
          mode: 'seat-order-public',
          actors: [actorRow(bot.playerId, bot.seat), actorRow(secondBot.playerId, secondBot.seat)],
        },
      })))
      const firstDecision = botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [entryFor(start, bot.playerId, 'attempt-order-first')],
      })
      firstDecision.data.mode = 'seat-order-public'
      ctx.emit('session/event', session, asSessionEvent(firstDecision))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botAttemptEvent(state.gameId, secondBot.playerId, {
        gameRevision: 3,
      }))) }).not.toThrow()
    }
  })

  it('rejects stale, off-instance, illegal, paused, and wrongly batched bot decisions', async () => {
    const { state, start } = startGame()
    const human = state.players.find(player => player.playerId === state.humanPlayerId)
    const bots = state.players.filter(player => player.playerId !== state.humanPlayerId).sort((a, b) => a.seat - b.seat)
    const first = bots[0]
    const second = bots[1]
    if (human === undefined || first === undefined || second === undefined) throw new Error('fixture lacks actors')
    const openBots = async (actors: ReturnType<typeof actorRow>[], mode: 'parallel-private' | 'seat-order-public' = 'parallel-private') => {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, { plan: { mode, actors } })))
      return { ctx, session }
    }
    {
      const { ctx, session } = await openBots([actorRow(first.playerId, first.seat)])
      ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: state.gameId, gameRevision: 3, reason: 'cancelled' },
      } as never))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 4, entries: [entryFor(start, first.playerId, 'paused-bot')],
      }))) }).toThrow(/while the game is paused/)
    }
    {
      const { ctx, session } = await openBots([actorRow(first.playerId, first.seat)])
      const stale = botDecisionEvent(state.gameId, { gameRevision: 3, entries: [entryFor(start, first.playerId, 'stale')] })
      stale.data.sourceGameRevision = 1
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(stale)) }).toThrow(/source revision/)
    }
    {
      const { ctx, session } = await openBots([actorRow(first.playerId, first.seat)])
      const offInstance = botDecisionEvent(state.gameId, { gameRevision: 3, entries: [entryFor(start, first.playerId, 'off-instance')] })
      const entry = offInstance.data.entries[0]
      if (entry === undefined) throw new Error('fixture decision has no entry')
      entry.phaseInstanceId = WerewolfPhaseInstanceId('other')
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(offInstance)) }).toThrow(/decision .* different phase instance/)
    }
    {
      const strict = { ...actorRow(first.playerId, first.seat), spec: { ...actorRow(first.playerId, first.seat).spec, allowSkip: false } }
      const { ctx, session } = await openBots([strict])
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3, entries: [entryFor(start, first.playerId, 'illegal-bot')],
      }))) }).toThrow(/illegal action/)
    }
    {
      const { ctx, session } = await openBots(
        [actorRow(first.playerId, first.seat), actorRow(second.playerId, second.seat)],
        'seat-order-public',
      )
      const batch = botDecisionEvent(state.gameId, {
        gameRevision: 3,
        entries: [entryFor(start, first.playerId, 'public-1'), entryFor(start, second.playerId, 'public-2')],
      })
      batch.data.mode = 'seat-order-public'
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(batch)) }).toThrow(/exactly the next seat-order-public actor/)
    }
    {
      const { ctx, session } = await openBots([
        actorRow(human.playerId, human.seat), actorRow(first.playerId, first.seat),
      ])
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3, entries: [entryFor(start, first.playerId, 'before-human')],
      }))) }).toThrow(/before the parallel human action/)
    }
    {
      const { ctx, session } = await openBots([
        actorRow(first.playerId, first.seat), actorRow(second.playerId, second.seat),
      ])
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3, entries: [entryFor(start, first.playerId, 'partial-batch')],
      }))) }).toThrow(/cover every pending parallel bot/)
    }
    {
      const { ctx, session } = await openBots([actorRow(first.playerId, first.seat)])
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3, entries: [],
      }))) }).toThrow(/at least one entry/)
    }
  })

  it('validates persisted bot public speech against the phase and recorded policy', async () => {
    const { state, start } = startGame()
    const bot = state.players.find(player => player.playerId !== state.humanPlayerId)
    if (bot === undefined) throw new Error('fixture lacks a bot')
    const textActor = {
      ...actorRow(bot.playerId, bot.seat),
      actionKind: 'speech',
      spec: { kind: 'text' as const, maxChars: state.ruleSet.policies.speechMaxChars, allowSkip: false },
    }
    const cases = [
      { actor: actorRow(bot.playerId, bot.seat), speech: 'hello', pattern: /outside a text phase/ },
      { actor: textActor, speech: '   ', pattern: /empty public speech/ },
      { actor: textActor, speech: ' hello ', pattern: /non-normalized public speech/ },
      {
        actor: textActor,
        speech: 'x'.repeat(state.ruleSet.policies.speechMaxChars + 1),
        pattern: /exceeds the recorded policy/,
      },
    ]
    for (const { actor, speech, pattern } of cases) {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
        plan: { mode: 'parallel-private', actors: [actor] },
      })))
      const entry = {
        ...entryFor(start, bot.playerId, `speech-${speech.length}`, {}, actor.actionKind),
        action: actor.spec.kind === 'text' ? { value: 'hello' } : { value: null },
        publicSpeech: speech,
      }
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
        gameRevision: 3, entries: [entry],
      }))) }).toThrow(pattern)
    }
    const { ctx, session } = await setup()
    ctx.emit('session/event', session, asSessionEvent(start))
    ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId, {
      plan: { mode: 'parallel-private', actors: [textActor] },
    })))
    const validEntry = {
      ...entryFor(start, bot.playerId, 'valid-speech', {}, 'speech'),
      action: { value: 'hello' },
      publicSpeech: 'hello',
    }
    expect(() =>{  ctx.emit('session/event', session, asSessionEvent(botDecisionEvent(state.gameId, {
      gameRevision: 3, entries: [validEntry],
    }))) }).not.toThrow()
  })

  it('rejects paused resolves and non-consecutive resume epochs, and accepts a null vote target', async () => {
    const { state, start } = startGame()
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId)))
      ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: state.gameId, gameRevision: 3, reason: 'cancelled' },
      } as never))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolvedEvent(state.gameId, {
        gameRevision: 4,
      }))) }).toThrow(/while the game is paused/)
    }
    {
      const { ctx, session } = await setup()
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-paused',
        data: { version: 1, gameId: state.gameId, gameRevision: 2, reason: 'cancelled' },
      } as never))
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent({
        type: 'werewolf/game-resumed',
        data: { version: 1, gameId: state.gameId, gameRevision: 3, retryEpoch: 2 },
      } as never)) }).toThrow(/retry epoch/)
    }
    {
      const { ctx, session } = await setup()
      const voter = start.data.roster[0]
      if (voter === undefined) throw new Error('fixture roster is empty')
      ctx.emit('session/event', session, asSessionEvent(start))
      ctx.emit('session/event', session, asSessionEvent(openedEvent(state.gameId)))
      const resolved = resolvedEvent(state.gameId, { gameRevision: 3 })
      resolved.data.resolution.votes = [{ voterId: voter.playerId, targetId: null }]
      expect(() =>{  ctx.emit('session/event', session, asSessionEvent(resolved)) }).not.toThrow()
    }
  })

  it('validates sessions that already exist when the companion installs', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const { start } = startGame()
    const bad = structuredClone(start)
    bad.data.version = 2 as never
    ctx.sessions.create(undefined, { seed: [asSessionEvent(bad)] })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(async () => ctx.plugin(WerewolfInvariant)).rejects.toThrow(/version 2/)
  })

  it('validates a session created after the companion installed', async () => {
    const { ctx } = await setup()
    const { start } = startGame()
    const bad = structuredClone(start)
    bad.data.version = 2 as never
    let vetoed = false
    try {
      ctx.sessions.create(undefined, { seed: [asSessionEvent(bad)] })
    } catch {
      vetoed = true
    }
    await new Promise(resolve => setImmediate(resolve))
    expect(vetoed || ctx.sessions.list().every(session => session.events.length === 0)).toBe(true)
  })
})
