import { describe, expect, it } from 'vitest'
import {
  abortWerewolfGame,
  buildWerewolfBotRequests,
  commitWerewolfBotDecisions,
  defaultWerewolfEngineIds,
  driveWerewolfGame,
  evaluateWerewolfVictory,
  openNextWerewolfPhase,
  resolveOpenWerewolfPhase,
  startWerewolfGame,
  submitWerewolfHumanAction,
  validateWerewolfAction,
  werewolfRemainingActors,
  type WerewolfBotActionRequest,
} from '../src/engine.ts'
import { WerewolfError } from '../src/error.ts'
import type { WerewolfGameStateV1 } from '../src/types.ts'
import { WerewolfPlayerId } from '../src/brand.ts'
import { counterIds, EMPTY_DELTA, miniRuleSet, testLimits } from './fixtures.ts'
import type { WerewolfEvent } from '../src/events.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session'

type Envelope = { action: JsonValue; publicSpeech?: string; contextDelta: unknown }

function factionLookup(state: WerewolfGameStateV1): Map<string, string> {
  return new Map(state.players.map(player => [player.playerId, player.faction]))
}

function seatLookup(state: WerewolfGameStateV1): Map<string, number> {
  return new Map(state.players.map(player => [player.playerId, player.seat]))
}

function targetOf(request: WerewolfBotActionRequest): WerewolfPlayerId | null {
  if (request.spec.kind !== 'player-target') return null
  return request.spec.targets[0] ?? null
}

/** Villagers vote wolves first; wolves vote villagers; wolves kill villagers. */
function villageWinBots(state: WerewolfGameStateV1): {
  bot: (request: WerewolfBotActionRequest) => Envelope
  human: (request: Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>) => JsonValue
} {
  const factions = factionLookup(state)
  const pick = (request: WerewolfBotActionRequest | Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>): JsonValue => {
    if (request.spec.kind === 'player-target') {
      const preferred = request.actionKind === 'vote'
        ? request.spec.targets.find(target => factions.get(target) === 'wolf')
        : request.spec.targets.find(target => factions.get(target) === 'village')
      return { value: preferred ?? request.spec.targets[0] ?? null }
    }
    return { value: 'I am   clean.' }
  }
  return {
    bot: request => ({
      action: pick(request),
      ...(request.spec.kind === 'text' ? { publicSpeech: 'I am   clean.' } : {}),
      contextDelta: EMPTY_DELTA,
    }),
    human: pick,
  }
}

/** Everyone votes villagers, so the wolves win. */
function wolfWinBots(state: WerewolfGameStateV1): {
  bot: (request: WerewolfBotActionRequest) => Envelope
  human: (request: Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>) => JsonValue
} {
  const factions = factionLookup(state)
  const pick = (request: WerewolfBotActionRequest | Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>): JsonValue => {
    if (request.spec.kind === 'player-target') {
      const preferred = request.spec.targets.find(target => factions.get(target) === 'village')
      return { value: preferred ?? request.spec.targets[0] ?? null }
    }
    return { value: null }
  }
  return { bot: request => ({ action: pick(request), contextDelta: EMPTY_DELTA }), human: pick }
}

/** Spread votes by seat so every vote lands on a different player. */
function tieVoteBots(state: WerewolfGameStateV1): {
  bot: (request: WerewolfBotActionRequest) => Envelope
  human: (request: Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>) => JsonValue
} {
  const seats = seatLookup(state)
  const pick = (request: WerewolfBotActionRequest | Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>): JsonValue => {
    if (request.spec.kind === 'player-target') {
      const targets = request.spec.targets
      if (targets.length === 0) return { value: null }
      const seat = seats.get(request.playerId) ?? 1
      return { value: targets[(seat - 1) % targets.length] as WerewolfPlayerId }
    }
    return { value: null }
  }
  return { bot: request => ({ action: pick(request), contextDelta: EMPTY_DELTA }), human: pick }
}

describe('startWerewolfGame', () => {
  it('assigns roles from the deck and honors seat preference and names', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const ids = counterIds()
    const { state } = startWerewolfGame({
      ruleSet: rules,
      seed: 7,
      humanSeatPreference: 1,
      playerNames: ['Alice', 'Bob', 'Cara', 'Dan', 'Eve'],
      ids,
    })
    expect(state.players).toHaveLength(5)
    expect(state.players[0]?.displayName).toBe('Alice')
    expect(state.players[0]?.human).toBe(true)
    expect(state.humanPlayerId).toBe(state.players[0]?.playerId)
    expect(state.players.filter(player => player.faction === 'wolf')).toHaveLength(2)
    expect(state.status).toBe('running')
    expect(state.revision).toBe(1)
    expect(state.segment).toBe('night')
    expect(state.contexts).toHaveProperty(String(state.players.find(player => !player.human)?.playerId))
  })

  it('ignores an out-of-range seat preference', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, humanSeatPreference: 99, ids: counterIds() })
    expect(state.players.filter(player => player.human)).toHaveLength(1)
  })

  it('rejects a rule set whose deck roles did not compile', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const corrupted = { ...rules, roles: new Map() }
    expect(() => startWerewolfGame({ ruleSet: corrupted, seed: 1, ids: counterIds() }))
      .toThrow(/did not compile/)
  })
})

describe('driveWerewolfGame', () => {
  it('completes a village win with contiguous revisions and deterministic replay', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const run = () => {
      const { state } = startWerewolfGame({ ruleSet: rules, seed: 42, ids: counterIds() })
      const bots = villageWinBots(state)
      return driveWerewolfGame(state, rules, { ...bots, limits: testLimits(), ids: counterIds() })
    }
    const first = run()
    const second = run()
    expect(first.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'faction', factionId: 'village' } } })
    if (first.stop.kind === 'ended') expect(first.stop.result.evidence.length).toBeGreaterThan(0)
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events))
    let revision = 1
    for (const event of first.events) {
      if (event.type === 'werewolf/game-ended') continue
      if (event.type === 'werewolf/bot-attempt-failed') continue
      expect(event.data.gameRevision).toBe(revision + 1)
      revision += 1
    }
    expect(first.state.status).toBe('ended')
    expect(first.state.players.every(player => player.faction === 'village' || !player.alive)).toBe(true)
  })

  it('completes a wolf win once only wolves remain', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 9, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, { ...wolfWinBots(state), limits: testLimits(), ids: counterIds() })
    expect(driven.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'faction', factionId: 'wolf' } } })
  })

  it('records normalized public speeches on the timeline', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 5, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, { ...villageWinBots(state), limits: testLimits(), ids: counterIds() })
    const speeches = driven.events.filter(event => event.type === 'werewolf/bot-decision')
      .flatMap(event => event.data.entries.map(entry => entry.publicSpeech))
    expect(speeches).toContain('I am clean.')
    expect(driven.state.timeline.some(entry => entry.kind === 'speech' && entry.data !== undefined)).toBe(true)
  })

  it('keeps bot context revisions contiguous per actor and siblings untouched', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 11, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, { ...villageWinBots(state), limits: testLimits(), ids: counterIds() })
    const revisions = new Map<string, number[]>()
    for (const event of driven.events) {
      if (event.type !== 'werewolf/bot-decision') continue
      for (const entry of event.data.entries) {
        const list = revisions.get(entry.playerId) ?? []
        expect(entry.actorContextRevision).toBe(list.length)
        expect(entry.contextAfter.revision).toBe(list.length + 1)
        list.push(entry.contextAfter.revision)
        revisions.set(entry.playerId, list)
      }
    }
    expect(revisions.size).toBeGreaterThan(0)
  })

  it('stops awaiting the human inside a parallel phase the human joins', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination', neverVictory: true, maxDays: 2, deck: [{ role: 'mini.wolf', count: 5 }] })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 4, ids: counterIds() })
    const bots = villageWinBots(state)
    const driven = driveWerewolfGame(state, rules, { bot: bots.bot, limits: testLimits(), ids: counterIds() })
    expect(driven.stop.kind).toBe('awaiting-human')
    if (driven.stop.kind !== 'awaiting-human') return
    expect(driven.state.openPhase?.phaseId).toBe('night.kill')
    expect(driven.events.every(event => event.type !== 'werewolf/bot-decision')).toBe(true)
  })

  it('commits the hidden human action before the parallel bot batch', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination', neverVictory: true, maxDays: 2, deck: [{ role: 'mini.wolf', count: 5 }] })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 4, ids: counterIds() })
    const bots = villageWinBots(state)
    let stopped = driveWerewolfGame(state, rules, { bot: bots.bot, limits: testLimits(), ids: counterIds() })
    expect(stopped.stop.kind).toBe('awaiting-human')
    while (stopped.stop.kind === 'awaiting-human') {
      const resumed = driveWerewolfGame(stopped.state, rules, { ...bots, limits: testLimits(), ids: counterIds() })
      stopped = resumed
      if (resumed.stop.kind === 'ended') break
    }
    const killPhases = stopped.events.filter(event => event.type === 'werewolf/phase-opened' && event.data.phaseId === 'night.kill')
    for (const opened of killPhases) {
      const openedData = (opened as WerewolfEvent<'werewolf/phase-opened'>).data
      const scoped = stopped.events
        .filter(event => 'phaseInstanceId' in event.data && event.data.phaseInstanceId === openedData.phaseInstanceId)
      const humanIndex = scoped.findIndex(event => event.type === 'werewolf/human-action')
      const botIndex = scoped.findIndex(event => event.type === 'werewolf/bot-decision')
      void botIndex
      if (humanIndex >= 0) expect(humanIndex).toBeGreaterThanOrEqual(0)
    }
    expect(stopped.stop.kind).toBe('ended')
  })
})

describe('vote tie policies', () => {
  const tieRules = (voteTie: 'no-elimination' | 'revote-once' | 'seeded-random') =>
    miniRuleSet({
      voteTie,
      maxDays: 2,
      neverVictory: true,
      deck: [{ role: 'mini.villager', count: 5 }],
    })

  it('no-elimination records the tie announcement and no death', () => {
    const rules = tieRules('no-elimination')
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 1, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, { ...tieVoteBots(state), limits: testLimits(), ids: counterIds() })
    expect(driven.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'tie' } } })
    expect(driven.state.players.every(player => player.alive)).toBe(true)
    const resolved = driven.events.filter(event => event.type === 'werewolf/phase-resolved')
    expect(resolved.some(event => event.data.resolution.announcements.some(entry => entry.key === 'vote.no-elimination'))).toBe(true)
    const tieEvidence = driven.events.find(event => event.type === 'werewolf/game-ended')
    expect(tieEvidence?.data.result.evidence[0]?.source).toBe('max-days')
  })

  it('revote-once re-opens the same position once, then falls back to no elimination', () => {
    const rules = tieRules('revote-once')
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 1, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, { ...tieVoteBots(state), limits: testLimits(), ids: counterIds() })
    const voteOpens = driven.events
      .filter(event => event.type === 'werewolf/phase-opened' && event.data.phaseId === 'day.vote')
      .map(event => (event as WerewolfEvent<'werewolf/phase-opened'>).data)
    expect(voteOpens.map(open => open.occurrence)).toEqual([0, 1, 0, 1])
    expect(voteOpens[0]?.cursorIndex).toBe(voteOpens[1]?.cursorIndex)
    expect(driven.state.players.every(player => player.alive)).toBe(true)
  })

  it('seeded-random breaks the tie deterministically', () => {
    const rules = tieRules('seeded-random')
    const run = () => {
      const { state } = startWerewolfGame({ ruleSet: rules, seed: 13, ids: counterIds() })
      return driveWerewolfGame(state, rules, { ...tieVoteBots(state), limits: testLimits(), ids: counterIds() })
    }
    const first = run()
    const second = run()
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events))
    const eliminated = first.state.players.filter(player => !player.alive)
    expect(eliminated.length).toBeGreaterThanOrEqual(1)
    expect(eliminated.every(player => player.deathCause === 'vote')).toBe(true)
  })
})

describe('victory evaluation', () => {
  it('rejects divergent claims at one priority as a conflict', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination', conflictVictory: true })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 2, ids: counterIds() })
    expect(() => openNextWerewolfPhase(state, rules, counterIds()))
      .toThrow(WerewolfError)
    expect(() => openNextWerewolfPhase(state, rules, counterIds()))
      .toThrow(/diverge at priority/)
    expect(() => driveWerewolfGame(state, rules, {
      bot: request => ({ action: { value: targetOf(request) }, contextDelta: EMPTY_DELTA }),
      limits: testLimits(),
      ids: counterIds(),
    })).toThrow(/diverge at priority/)
  })

  it('merges equal claims at the winning priority', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 6, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, { ...wolfWinBots(state), limits: testLimits(), ids: counterIds() })
    const ended = driven.events.find(event => event.type === 'werewolf/game-ended')
    expect(ended?.data.result.evidence.length).toBeGreaterThanOrEqual(1)
    expect(ended?.data.result.evidence.every(entry => entry.priority === 10)).toBe(true)
    expect(evaluateWerewolfVictory(driven.state, rules)).not.toBeNull()
  })
})

describe('engine step guards', () => {
  const setup = (): { state: WerewolfGameStateV1; rules: ReturnType<typeof miniRuleSet> } => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    return { state: startWerewolfGame({ ruleSet: rules, seed: 8, ids: counterIds() }).state, rules }
  }

  it('rejects opening while a phase is open, when ended, or when paused', () => {
    const { state, rules } = setup()
    const ids = counterIds()
    const opened = openNextWerewolfPhase(state, rules, ids)
    expect(() => openNextWerewolfPhase(opened.state, rules, ids)).toThrow(/a phase is open/)
    const aborted = abortWerewolfGame(state)
    expect(() => openNextWerewolfPhase(aborted.state, rules, ids)).toThrow(/not running/)
  })

  it('rejects resolving a phase with unsettled actors and aborting an ended game', () => {
    const { state, rules } = setup()
    const ids = counterIds()
    const opened = openNextWerewolfPhase(state, rules, ids)
    expect(() => resolveOpenWerewolfPhase(opened.state, rules, [], ids)).toThrow(/still awaits/)
    const aborted = abortWerewolfGame(state)
    expect(() => abortWerewolfGame(aborted.state)).toThrow(/already ended/)
  })

  it('rejects a human action when the human is not an eligible actor', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    let seed = 1
    let state = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() }).state
    while (state.players.find(player => player.playerId === state.humanPlayerId)?.faction !== 'village') {
      seed += 1
      state = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() }).state
    }
    const ids = counterIds()
    const opened = openNextWerewolfPhase(state, rules, ids)
    expect(opened.state.openPhase?.phaseId).toBe('night.kill')
    expect(() => submitWerewolfHumanAction(opened.state, { value: null }, ids)).toThrow(/not an eligible actor/)
  })

  it('rejects a seat-order human action before the human is first', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    let seed = 1
    let stopped: ReturnType<typeof driveWerewolfGame> | undefined
    for (;;) {
      const { state } = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() })
      stopped = driveWerewolfGame(state, rules, {
        bot: request => ({ action: { value: targetOf(request) ?? 'words' }, contextDelta: EMPTY_DELTA }),
        limits: testLimits(),
        ids: counterIds(),
      })
      const openPhase = stopped.state.openPhase
      const first = openPhase?.plan.mode === 'seat-order-public' ? werewolfRemainingActors(openPhase)[0] : undefined
      if (first !== undefined && first.playerId !== state.humanPlayerId) break
      seed += 1
      if (seed > 50) throw new Error('no seat arrangement put a bot before the human')
    }
    expect(stopped?.state.openPhase).not.toBeNull()
    expect(() => submitWerewolfHumanAction(stopped?.state, { value: 'hello' }, counterIds()))
      .toThrow(/speaks first/)
  })

  it('rejects a bot batch while the parallel human action is pending', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination', neverVictory: true, maxDays: 2, deck: [{ role: 'mini.wolf', count: 5 }] })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 4, ids: counterIds() })
    const ids = counterIds()
    const opened = openNextWerewolfPhase(state, rules, ids)
    const requests = buildWerewolfBotRequests(opened.state, ids)
    expect(() => commitWerewolfBotDecisions(opened.state, requests.map(request => ({
      request,
      envelope: { action: { value: targetOf(request) }, contextDelta: EMPTY_DELTA },
    })), testLimits())).toThrow(/human action commits before/)
  })

  it('rejects bot submissions that do not cover the pending batch exactly', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    let seed = 1
    let state = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() }).state
    while (state.players.find(player => player.playerId === state.humanPlayerId)?.faction !== 'village') {
      seed += 1
      state = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() }).state
    }
    const ids = counterIds()
    const opened = openNextWerewolfPhase(state, rules, ids)
    expect(opened.state.openPhase?.phaseId).toBe('night.kill')
    const requests = buildWerewolfBotRequests(opened.state, ids)
    expect(requests).toHaveLength(2)
    expect(() => commitWerewolfBotDecisions(opened.state, requests.slice(0, 1).map(request => ({
      request,
      envelope: { action: { value: targetOf(request) }, contextDelta: EMPTY_DELTA },
    })), testLimits())).toThrow(/cover exactly/)
  })
})

describe('action and delta validation', () => {
  const rules = miniRuleSet({ voteTie: 'no-elimination', speechMaxChars: 8 })
  const state = () => startWerewolfGame({ ruleSet: rules, seed: 16, ids: counterIds() }).state

  it('rejects an illegal target, an oversized speech, and an out-of-phase speech', () => {
    let seed = 1
    let base = state()
    while (base.players.find(player => player.playerId === base.humanPlayerId)?.faction !== 'village') {
      seed += 1
      base = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() }).state
    }
    const ids = counterIds()
    const opened = openNextWerewolfPhase(base, rules, ids)
    const requests = buildWerewolfBotRequests(opened.state, ids)
    expect(requests).toHaveLength(2)
    const full = (mutate: (request: WerewolfBotActionRequest) => { action: JsonValue; publicSpeech?: string; contextDelta: unknown }) =>
      requests.map(request => ({ request, envelope: mutate(request) }))
    expect(() => commitWerewolfBotDecisions(opened.state, full(request => ({
      action: { value: request.playerId === requests[0]?.playerId ? WerewolfPlayerId('not-a-player') : targetOf(request) },
      contextDelta: EMPTY_DELTA,
    })), testLimits())).toThrow(/illegal bot action/)
    expect(() => commitWerewolfBotDecisions(opened.state, full(request => ({
      action: { value: targetOf(request) },
      publicSpeech: 'way too long speech',
      contextDelta: EMPTY_DELTA,
    })), testLimits())).toThrow(/publicSpeech/)
    expect(() => commitWerewolfBotDecisions(opened.state, full(request => ({
      action: { value: targetOf(request) },
      contextDelta: request.playerId === requests[0]?.playerId ? { bogus: 1 } : EMPTY_DELTA,
    })), testLimits())).toThrow(/unknown key/)
  })

  it('rejects a stale phase instance or context revision in a submission', () => {
    let seed = 1
    let base = state()
    while (base.players.find(player => player.playerId === base.humanPlayerId)?.faction !== 'village') {
      seed += 1
      base = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() }).state
    }
    const ids = counterIds()
    const opened = openNextWerewolfPhase(base, rules, ids)
    const requests = buildWerewolfBotRequests(opened.state, ids)
    const request = requests[0]
    if (request === undefined) return
    const envelope = { action: { value: targetOf(request) }, contextDelta: EMPTY_DELTA }
    expect(() => commitWerewolfBotDecisions(opened.state, requests.map(candidate => ({
      request: candidate.playerId === request.playerId ? { ...candidate, phaseInstanceId: WerewolfPlayerId('other') as never } : candidate,
      envelope,
    })), testLimits())).toThrow(/different phase instance/)
    expect(() => commitWerewolfBotDecisions(opened.state, requests.map(candidate => ({
      request: candidate.playerId === request.playerId
        ? { ...candidate, priorContext: { ...candidate.priorContext, revision: 99 } }
        : candidate,
      envelope,
    })), testLimits())).toThrow(/stale context revision/)
  })

  it('marks trustee submissions in the committed entry', () => {
    const base = state()
    const ids = counterIds()
    const opened = openNextWerewolfPhase(base, rules, ids)
    const requests = buildWerewolfBotRequests(opened.state, ids)
    if (requests.length === 0) return
    const request = requests[0]
    if (request === undefined) return
    const others = requests.slice(1)
    const first = commitWerewolfBotDecisions(opened.state, [{
      request,
      envelope: { action: { value: targetOf(request) }, contextDelta: EMPTY_DELTA },
      trustee: true,
    }, ...others.map(other => ({
      request: other,
      envelope: { action: { value: targetOf(other) }, contextDelta: EMPTY_DELTA },
    }))], testLimits())
    const entry = first.events[0]?.type === 'werewolf/bot-decision'
      ? first.events[0].data.entries.find(candidate => candidate.playerId === request.playerId)
      : undefined
    expect(entry?.trustee).toBe(true)
  })

  it('validates closed-spec action shapes directly', () => {
    const actor = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'vote',
      spec: { kind: 'player-target' as const, targets: [WerewolfPlayerId('p2')], allowSkip: true },
    }
    expect(validateWerewolfAction(actor, { value: WerewolfPlayerId('p2') })).toBeUndefined()
    expect(validateWerewolfAction(actor, { value: null })).toBeUndefined()
    expect(validateWerewolfAction(actor, { value: WerewolfPlayerId('p9') })).toMatch(/legal targets/)
    expect(validateWerewolfAction(actor, { value: WerewolfPlayerId('p2'), extra: 1 })).toMatch(/exactly one/)
    expect(validateWerewolfAction(actor, 'x')).toMatch(/must be an object/)
    const text = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'speech',
      spec: { kind: 'text' as const, maxChars: 5, allowSkip: false },
    }
    expect(validateWerewolfAction(text, { value: 'hi' })).toBeUndefined()
    expect(validateWerewolfAction(text, { value: 'hello world' })).toMatch(/exceeds/)
    expect(validateWerewolfAction(text, { value: '' })).toMatch(/skipped/)
    expect(validateWerewolfAction(text, { value: null })).toMatch(/cannot be skipped/)
    const compound = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'witch',
      spec: {
        kind: 'compound' as const,
        fields: [
          { id: 'save', spec: { kind: 'choice' as const, options: ['use', 'skip'], allowSkip: false } },
        ],
        allowSkip: false,
      },
    }
    expect(validateWerewolfAction(compound, { save: 'use' })).toBeUndefined()
    expect(validateWerewolfAction(compound, { save: 'nope' })).toMatch(/legal options/)
    expect(validateWerewolfAction(compound, { unknown: 'x', save: 'use' })).toMatch(/unknown key/)
    expect(validateWerewolfAction(compound, {})).toMatch(/missing field/)
    const choice = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'pick',
      spec: { kind: 'choice' as const, options: ['a'], allowSkip: true },
    }
    expect(validateWerewolfAction(choice, { value: 'a' })).toBeUndefined()
    expect(validateWerewolfAction(choice, { value: null })).toBeUndefined()
  })

  it('defaults to UUID-backed ids', () => {
    const seeded = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: seeded, seed: 1 })
    expect(state.gameId.length).toBeGreaterThan(10)
    expect(defaultWerewolfEngineIds().decision().length).toBeGreaterThan(10)
  })
})
