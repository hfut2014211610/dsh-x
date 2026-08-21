import { describe, expect, it } from 'vitest'
import { applyWerewolfEvent, reduceWerewolfGame } from '../src/reducer.ts'
import { abortWerewolfGame, driveWerewolfGame, openNextWerewolfPhase, startWerewolfGame } from '../src/engine.ts'
import type { WerewolfEvent } from '../src/events.ts'
import type { WerewolfGameStateV1 } from '../src/types.ts'
import { WerewolfPhaseInstanceId, WerewolfPlayerId } from '../src/brand.ts'
import { counterIds, EMPTY_DELTA, miniRuleSet, testLimits } from './fixtures.ts'

function drivenGame(): { events: WerewolfEvent[]; state: WerewolfGameStateV1 } {
  const rules = miniRuleSet({ voteTie: 'revote-once' })
  const { state, events: startEvents } = startWerewolfGame({ ruleSet: rules, seed: 42, ids: counterIds() })
  const driven = driveWerewolfGame(state, rules, {
    bot: request => ({
      action: request.spec.kind === 'player-target'
        ? { value: request.spec.targets[0] ?? null }
        : { value: request.spec.kind === 'text' ? 'words' : null },
      ...(request.spec.kind === 'text' ? { publicSpeech: 'words' } : {}),
      contextDelta: EMPTY_DELTA,
    }),
    human: request => request.spec.kind === 'player-target'
      ? { value: request.spec.targets[0] ?? null }
      : { value: 'my words' },
    limits: testLimits(),
    ids: counterIds(),
  })
  return { events: [...startEvents, ...driven.events], state: driven.state }
}

describe('reduceWerewolfGame', () => {
  it('folds a full deterministic game with contiguous revisions and reset days', () => {
    const { events, state } = drivenGame()
    const folded = reduceWerewolfGame(events)
    expect(folded).not.toBeUndefined()
    expect(folded?.gameId).toBe(state.gameId)
    expect(folded?.revision).toBe(state.revision)
    expect(folded?.status).toBe(state.status)
    const opened = events.filter(event => event.type === 'werewolf/phase-opened')
    const days = new Set(opened.map(event => event.data.day))
    expect(days.size).toBeGreaterThanOrEqual(1)
  })

  it('returns undefined without werewolf events and ignores foreign events', () => {
    expect(reduceWerewolfGame([])).toBeUndefined()
    expect(reduceWerewolfGame([{ type: 'turn/start', data: { turn: 1 } }])).toBeUndefined()
  })

  it('ignores unknown event names that merely share the werewolf prefix', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 1, ids: counterIds() })
    const next = applyWerewolfEvent(state, {
      type: 'werewolf/not-a-declared-event',
      data: { version: 1, gameId: state.gameId, gameRevision: state.revision + 1 },
    })
    expect(next).toBe(state)
    expect(next?.status).toBe('running')
  })

  it('resets the fold when a second game starts', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const first = startWerewolfGame({ ruleSet: rules, seed: 1, ids: counterIds() })
    const second = startWerewolfGame({ ruleSet: rules, seed: 2, ids: counterIds() })
    const folded = reduceWerewolfGame([...first.events, ...second.events])
    expect(folded?.gameId).toBe(second.state.gameId)
    expect(folded?.seed).toBe(2)
  })

  it('applies resolutions in the fixed order with prevention and notices', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const victim = state.players[0] as { playerId: string }
    const saved = state.players[1] as { playerId: string }
    const resolved: WerewolfEvent<'werewolf/phase-resolved'> = {
      type: 'werewolf/phase-resolved',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        decisionIds: [],
        humanActionIds: [],
        resolution: {
          eliminations: [{ playerId: victim.playerId as never, cause: 'wolf-kill' }, { playerId: saved.playerId as never, cause: 'wolf-kill' }],
          prevented: [{ playerId: saved.playerId as never, cause: 'witch-antidote' }],
          resourceReplacements: [{ playerId: saved.playerId as never, resourceId: 'antidote', remaining: 0 }],
          roleStateReplacements: [{ playerId: saved.playerId as never, roleState: { saved: true } }],
          privateNotices: [{ toPlayerId: victim.playerId as never, kind: 'death', data: {} }],
          announcements: [{ kind: 'death', key: 'announce.death', data: { playerId: victim.playerId } }],
          votes: [{ voterId: saved.playerId as never, targetId: victim.playerId as never }],
          outcome: {},
        },
        rngState: state.rngState,
      },
    }
    const next = applyWerewolfEvent(state, resolved)
    expect(next?.players[0]?.alive).toBe(false)
    expect(next?.players[0]?.deathDay).toBe(1)
    expect(next?.players[0]?.deathCause).toBe('wolf-kill')
    expect(next?.players[1]?.alive).toBe(true)
    expect(next?.players[1]?.resources).toMatchObject({ antidote: 0 })
    expect(next?.players[1]?.roleState).toEqual({ saved: true })
    expect(next?.players[0]?.notices).toHaveLength(1)
    expect(next?.timeline.some(entry => entry.kind === 'death' && entry.key === 'announce.death')).toBe(true)
    expect(next?.timeline.some(entry => entry.kind === 'vote' && entry.actorId === saved.playerId as never)).toBe(true)
    expect(next?.positionConsumed).toBe(true)
  })

  it('ignores resolution records naming unknown players', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const resolved: WerewolfEvent<'werewolf/phase-resolved'> = {
      type: 'werewolf/phase-resolved',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        decisionIds: [],
        humanActionIds: [],
        resolution: {
          eliminations: [{ playerId: WerewolfPlayerId('ghost'), cause: 'vote' }],
          prevented: [{ playerId: WerewolfPlayerId('ghost'), cause: 'x' }],
          resourceReplacements: [{ playerId: WerewolfPlayerId('ghost'), resourceId: 'r', remaining: 1 }],
          roleStateReplacements: [{ playerId: WerewolfPlayerId('ghost'), roleState: {} }],
          privateNotices: [{ toPlayerId: WerewolfPlayerId('ghost'), kind: 'k', data: {} }],
          announcements: [],
          votes: [],
          outcome: {},
        },
        rngState: state.rngState,
      },
    }
    const next = applyWerewolfEvent(state, resolved)
    expect(next?.players.every(player => player.alive)).toBe(true)
    expect(next?.players.every(player => player.notices.length === 0)).toBe(true)
  })

  it('clears same-day resolutions when the day advances', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 4, ids: counterIds() })
    const openedDay1: WerewolfEvent<'werewolf/phase-opened'> = {
      type: 'werewolf/phase-opened',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        phaseId: 'night.kill',
        phaseVersion: 1,
        segment: 'night',
        day: 1,
        cursorIndex: 0,
        occurrence: 0,
        outcome: 'awaiting',
        plan: { mode: 'parallel-private', actors: [] },
        rngState: state.rngState,
      },
    }
    const resolved: WerewolfEvent<'werewolf/phase-resolved'> = {
      type: 'werewolf/phase-resolved',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 3,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        decisionIds: [],
        humanActionIds: [],
        resolution: {
          eliminations: [], prevented: [], resourceReplacements: [], roleStateReplacements: [],
          privateNotices: [], announcements: [], votes: [], outcome: {},
        },
        rngState: state.rngState,
      },
    }
    const afterResolve = applyWerewolfEvent(applyWerewolfEvent(state, openedDay1), resolved)
    expect(afterResolve?.sameDayResolutions).toHaveLength(1)
    const openedDay2: WerewolfEvent<'werewolf/phase-opened'> = {
      type: 'werewolf/phase-opened',
      data: { ...openedDay1.data, day: 2, gameRevision: 4 },
    }
    expect(applyWerewolfEvent(afterResolve, openedDay2)?.sameDayResolutions).toHaveLength(0)
  })

  it('records a skipped phase on the timeline and an awaiting phase as open', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 5, ids: counterIds() })
    const base: WerewolfEvent<'werewolf/phase-opened'> = {
      type: 'werewolf/phase-opened',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        phaseId: 'night.noop',
        phaseVersion: 1,
        segment: 'night',
        day: 1,
        cursorIndex: 1,
        occurrence: 0,
        outcome: 'skipped',
        skipReason: 'no living wolves',
        rngState: state.rngState,
      },
    }
    const skipped = applyWerewolfEvent(state, base)
    expect(skipped?.openPhase).toBeNull()
    expect(skipped?.positionConsumed).toBe(true)
    expect(skipped?.timeline.some(entry => entry.key === 'phase.skipped')).toBe(true)
    const withoutReason = applyWerewolfEvent(state, {
      type: 'werewolf/phase-opened',
      data: { ...structuredClone(base.data), skipReason: undefined },
    })
    expect(withoutReason?.timeline.some(entry => entry.key === 'phase.skipped')).toBe(false)
    const awaiting = applyWerewolfEvent(state, {
      type: 'werewolf/phase-opened',
      data: { ...base.data, outcome: 'awaiting' as const, plan: { mode: 'seat-order-public', actors: [] } },
    })
    expect(awaiting?.openPhase?.phaseId).toBe('night.noop')
    expect(awaiting?.positionConsumed).toBe(false)
  })

  it('folds pauses, resumes, attempts, and idempotency keys', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 6, ids: counterIds() })
    const startEvent = started.events[0] as WerewolfEvent<'werewolf/game-started'>
    const startedWithRequest = applyWerewolfEvent(undefined, {
      ...startEvent,
      data: { ...structuredClone(startEvent.data), request: { requestId: 'r1', digest: 'd1' } },
    })
    const paused = applyWerewolfEvent(startedWithRequest, {
      type: 'werewolf/game-paused',
      data: { version: 1, gameId: started.state.gameId, gameRevision: 2, reason: 'operator-request' },
    })
    expect(paused?.status).toBe('paused')
    expect(paused?.pauseReason).toBe('operator-request')
    const attempted = applyWerewolfEvent(paused, {
      type: 'werewolf/bot-attempt-failed',
      data: {
        version: 1,
        gameId: started.state.gameId,
        gameRevision: 2,
        decisionId: 'd' as never,
        playerId: startEvent.data.botProfiles[0]?.playerId ?? WerewolfPlayerId('p'),
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        attempt: 1,
        retryEpoch: 0,
        childSessionId: 's1',
        category: 'timeout',
      },
    })
    expect(attempted?.revision).toBe(2)
    expect(attempted?.status).toBe('paused')
    const resumed = applyWerewolfEvent(attempted, {
      type: 'werewolf/game-resumed',
      data: { version: 1, gameId: started.state.gameId, gameRevision: 3, retryEpoch: 1, request: { requestId: 'r2', digest: 'd2' } },
    })
    expect(resumed?.status).toBe('running')
    expect(resumed?.retryEpoch).toBe(1)
    expect(resumed?.pauseReason).toBeNull()
    const aborted = abortWerewolfGame(started.state, { requestId: 'r3', digest: 'd3' })
    const requestStart = { ...startEvent, data: { ...structuredClone(startEvent.data), request: { requestId: 'r1', digest: 'd1' } } }
    const ended = reduceWerewolfGame([requestStart, ...aborted.events])
    expect(ended?.status).toBe('ended')
    expect(ended?.idempotencyKeys.get('start\u0000r1')).toBe('d1')
    expect(ended?.idempotencyKeys.get('abortGame\u0000r3')).toBe('d3')
  })

  it('folds human speech entries for text actions and bot speeches', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 7, ids: counterIds() })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    const textPhase: WerewolfEvent<'werewolf/phase-opened'> = {
      type: 'werewolf/phase-opened',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        phaseId: 'day.talk',
        phaseVersion: 1,
        segment: 'day',
        day: 1,
        cursorIndex: 0,
        occurrence: 0,
        outcome: 'awaiting',
        plan: {
          mode: 'seat-order-public',
          actors: [{
            playerId: state.humanPlayerId,
            seat: 1,
            actionKind: 'speech',
            spec: { kind: 'text', maxChars: 40, allowSkip: true },
          }],
        },
        rngState: state.rngState,
      },
    }
    const withPhase = applyWerewolfEvent(state, textPhase)
    const human = applyWerewolfEvent(withPhase, {
      type: 'werewolf/human-action',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 3,
        humanActionId: 'h1' as never,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        playerId: state.humanPlayerId,
        action: { value: 'hello  world' },
      },
    })
    expect(human?.timeline.some(entry => entry.kind === 'speech' && (entry.data as { text: string }).text === 'hello  world')).toBe(true)
    expect(human?.openPhase?.settled).toHaveLength(1)
    const nonText = applyWerewolfEvent(withPhase, {
      type: 'werewolf/human-action',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 4,
        humanActionId: 'h2' as never,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        playerId: state.humanPlayerId,
        action: { value: 42 },
      },
    })
    expect(nonText?.timeline.filter(entry => entry.kind === 'speech')).toHaveLength(0)
    const bot = applyWerewolfEvent(withPhase, {
      type: 'werewolf/bot-decision',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 5,
        sourceGameRevision: 3,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        mode: 'seat-order-public',
        entries: [{
          decisionId: 'd1' as never,
          playerId: (state.players.find(player => !player.human)?.playerId ?? WerewolfPlayerId('p')) as never,
          phaseInstanceId: WerewolfPhaseInstanceId('i1'),
          actorContextRevision: 0,
          action: { value: null },
          publicSpeech: 'real words',
          contextDelta: {},
          contextAfter: { version: 1, gameId: state.gameId, playerId: WerewolfPlayerId('p'), revision: 1, profile: { personalityId: 'x', speakingStyle: 'y', riskStyle: 'balanced' }, beliefs: [], commitments: [], strategy: { objective: 'o', priorityTargets: [] }, memorySummary: 'm' },
        }],
      },
    })
    expect(bot?.timeline.filter(entry => entry.kind === 'speech')).toHaveLength(1)
    void opened
  })

  it('folds events for an unknown or absent game without throwing', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 8, ids: counterIds() })
    const orphan = applyWerewolfEvent(undefined, {
      type: 'werewolf/game-paused',
      data: { version: 1, gameId: state.gameId, gameRevision: 2, reason: 'cancelled' },
    })
    expect(orphan).toBeUndefined()
    const nonWerewolf = applyWerewolfEvent(state, { type: 'turn/start', data: { turn: 1 } })
    expect(nonWerewolf).toBe(state)
  })
})
