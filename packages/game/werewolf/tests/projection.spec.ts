import { describe, expect, it } from 'vitest'
import { projectWerewolfBotObservation, serializeWerewolfActionSpec } from '../src/projection.ts'
import { openNextWerewolfPhase, startWerewolfGame, buildWerewolfBotRequests } from '../src/engine.ts'
import { WerewolfPlayerId } from '../src/brand.ts'
import { counterIds, miniRuleSet } from './fixtures.ts'

function botState() {
  const rules = miniRuleSet({ voteTie: 'no-elimination' })
  const { state } = startWerewolfGame({ ruleSet: rules, seed: 31, ids: counterIds() })
  const opened = openNextWerewolfPhase(state, rules, counterIds())
  const requests = buildWerewolfBotRequests(opened.state, counterIds())
  const request = requests[0]
  if (request === undefined) throw new Error('fixture produced no bot requests')
  return { rules, state: opened.state, request, requests }
}

function talkBotState() {
  const rules = miniRuleSet({ voteTie: 'no-elimination' })
  const { state } = startWerewolfGame({ ruleSet: rules, seed: 31, ids: counterIds() })
  const opened = openNextWerewolfPhase({
    ...state,
    segment: 'day',
    cursorIndex: -1,
    occurrence: 0,
    positionConsumed: true,
  }, rules, counterIds())
  const request = buildWerewolfBotRequests(opened.state, counterIds())
    .find(candidate => opened.state.players.find(player => player.playerId === candidate.playerId)?.roleId === 'mini.villager')
  if (request === undefined) throw new Error('fixture produced no villager talk request')
  return { rules, state: opened.state, request }
}

const limits = { publicTimelineEntries: 5 }

describe('serializeWerewolfActionSpec', () => {
  it('serializes each closed spec kind', () => {
    expect(serializeWerewolfActionSpec({
      kind: 'player-target',
      targets: [WerewolfPlayerId('p1'), WerewolfPlayerId('p2')],
      allowSkip: true,
    })).toEqual({ kind: 'player-target', targets: ['p1', 'p2'], allowSkip: true })
    expect(serializeWerewolfActionSpec({ kind: 'choice', options: ['use', 'skip'], allowSkip: false }))
      .toEqual({ kind: 'choice', options: ['use', 'skip'], allowSkip: false })
    expect(serializeWerewolfActionSpec({ kind: 'text', maxChars: 40, allowSkip: true }))
      .toEqual({ kind: 'text', maxChars: 40, allowSkip: true })
    expect(serializeWerewolfActionSpec({
      kind: 'compound',
      fields: [{ id: 'save', spec: { kind: 'choice', options: ['use'], allowSkip: false } }],
      allowSkip: false,
    })).toEqual({
      kind: 'compound',
      fields: [{ id: 'save', spec: { kind: 'choice', options: ['use'], allowSkip: false } }],
      allowSkip: false,
    })
  })
})

describe('projectWerewolfBotObservation', () => {
  it('carries the decision identity, self role, and prior context', () => {
    const { rules, state, request } = botState()
    const prompt = projectWerewolfBotObservation(state, rules, request, limits)
    expect(prompt.decisionId).toBe(request.decisionId)
    expect(prompt.gameRevision).toBe(request.sourceGameRevision)
    expect(prompt.contextRevision).toBe(request.priorContext.revision)
    expect(prompt.phase).toEqual({ id: request.phaseId, day: request.day, actionKind: request.actionKind })
    expect(prompt.self.alive).toBe(true)
    const role = prompt.self.role as { faction: string }
    expect(role.faction).toBe(state.players.find(player => player.playerId === request.playerId)?.faction)
    expect(prompt.priorContext).toEqual(request.priorContext)
    const roster = (prompt.publicState as { roster: Array<{ playerId: string }> }).roster
    expect(roster.map(entry => entry.playerId)).toEqual(state.players.map(entry => entry.playerId))
    const legalAction = prompt.legalAction as { actionKind: string; spec: { kind: string } }
    expect(legalAction.actionKind).toBe(request.actionKind)
    expect(legalAction.spec.kind).toBe(request.spec.kind)
  })

  it('covers optional-field absence without constructing an impossible request', () => {
    const { rules, state, request } = talkBotState()
    const bare: typeof state = {
      ...state,
      timeline: [
        { id: '0', day: 1, phaseId: 'p', kind: 'announcement', key: 'k', actorId: request.playerId, data: { y: 2 } },
        { id: '1', day: 1, phaseId: 'p', kind: 'system', key: 'k2' },
      ],
    }
    const prompt = projectWerewolfBotObservation(bare, rules, request, limits)
    expect((prompt.privateKnowledge as { teammates?: unknown }).teammates).toBeUndefined()
    const timeline = (prompt.publicState as { timeline: Array<Record<string, unknown>> }).timeline
    expect(timeline[0]).toHaveProperty('actorId')
    expect(timeline[0]).toHaveProperty('data')
    expect(timeline[1]).not.toHaveProperty('actorId')
    expect(timeline[1]).not.toHaveProperty('data')
  })

  it('throws for an unseated player or uncompiled role', () => {
    const { rules, state, request } = botState()
    expect(() => projectWerewolfBotObservation(state, rules, { ...request, playerId: WerewolfPlayerId('ghost') }, limits))
      .toThrow(/is not seated/)
    const corrupted = { ...rules, roles: new Map() }
    expect(() => projectWerewolfBotObservation(state, corrupted, request, limits)).toThrow(/did not compile/)
  })

  it('rejects stale identity, active-plan drift, foreign context, and mismatched rules before projection', () => {
    const { rules, state, request } = botState()
    expect(() => projectWerewolfBotObservation(state, rules, {
      ...request,
      sourceGameRevision: request.sourceGameRevision - 1,
    }, limits)).toThrow(/stale game revision/)
    expect(() => projectWerewolfBotObservation(state, { ...rules, digest: 'foreign' }, request, limits))
      .toThrow(/compiled rules do not match/)
    expect(() => projectWerewolfBotObservation({ ...state, openPhase: null }, rules, request, limits))
      .toThrow(/no phase is open/)
    expect(() => projectWerewolfBotObservation(state, rules, {
      ...request,
      phaseInstanceId: 'foreign-phase' as never,
    }, limits)).toThrow(/different phase/)
    expect(() => projectWerewolfBotObservation(state, rules, {
      ...request,
      actionKind: 'foreign-action',
    }, limits)).toThrow(/does not match the active action plan/)
    expect(() => projectWerewolfBotObservation(state, rules, {
      ...request,
      priorContext: {
        ...request.priorContext,
        strategy: { ...request.priorContext.strategy, objective: 'foreign strategy' },
      },
    }, limits)).toThrow(/stale or foreign bot context/)
    expect(() => projectWerewolfBotObservation({
      ...state,
      openPhase: state.openPhase === null
        ? null
        : { ...state.openPhase, settled: [{ playerId: request.playerId, decisionId: request.decisionId }] },
    }, rules, request, limits)).toThrow(/has no pending bot decision/)

    const contexts = Object.fromEntries(
      Object.entries(state.contexts).filter(([playerId]) => playerId !== request.playerId),
    )
    expect(() => projectWerewolfBotObservation({ ...state, contexts }, rules, request, limits))
      .toThrow(/has no bot context/)
  })

  it('enforces public actor order and projects non-empty notices and action context', () => {
    const { rules, state, request } = talkBotState()
    const openPhase = state.openPhase
    if (openPhase === null) throw new Error('talk phase is not open')
    expect(openPhase.plan.mode).toBe('seat-order-public')
    const later = openPhase.plan.actors.find(entry => entry.playerId !== request.playerId
      && state.players.find(player => player.playerId === entry.playerId)?.human === false)
    if (later === undefined) throw new Error('fixture produced no later bot actor')
    const laterContext = state.contexts[later.playerId]
    if (laterContext === undefined) throw new Error('later bot has no context')
    expect(() => projectWerewolfBotObservation(state, rules, {
      decisionId: request.decisionId,
      gameId: request.gameId,
      sourceGameRevision: request.sourceGameRevision,
      playerId: later.playerId,
      phaseInstanceId: request.phaseInstanceId,
      phaseId: request.phaseId,
      day: request.day,
      actionKind: later.actionKind,
      spec: later.spec,
      ...(later.context === undefined ? {} : { context: later.context }),
      priorContext: laterContext,
    }, limits)).toThrow(/is not the next public actor/)

    const settledSiblingState: typeof state = {
      ...state,
      openPhase: {
        ...openPhase,
        settled: [{ playerId: later.playerId }],
      },
    }
    expect(projectWerewolfBotObservation(settledSiblingState, rules, request, limits).self.playerId)
      .toBe(request.playerId)

    const actionContext = { hint: 'speak now' }
    const contextualState: typeof state = {
      ...state,
      players: state.players.map(player => player.playerId === request.playerId
        ? { ...player, notices: [{ toPlayerId: player.playerId, kind: 'test-notice', data: { value: 1 } }] }
        : player),
      openPhase: {
        ...openPhase,
        plan: {
          ...openPhase.plan,
          actors: openPhase.plan.actors.map(actor => actor.playerId === request.playerId
            ? { ...actor, context: actionContext }
            : actor),
        },
      },
    }
    const prompt = projectWerewolfBotObservation(contextualState, rules, {
      ...request,
      context: actionContext,
    }, limits)
    expect(prompt.legalAction).toMatchObject({ context: actionContext })
  })

  it('bounds the public timeline to the configured entry count', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 31, ids: counterIds() })
    const padded = {
      ...state,
      timeline: Array.from({ length: 12 }, (_, index) => ({
        id: `${index}`,
        day: 1,
        phaseId: 'day.talk',
        kind: 'speech' as const,
        key: 'speech',
        data: { text: `line ${index}` },
      })),
    }
    const opened = openNextWerewolfPhase(padded, rules, counterIds())
    const request = buildWerewolfBotRequests(opened.state, counterIds())[0]
    if (request === undefined) throw new Error('no request')
    const prompt = projectWerewolfBotObservation(opened.state, rules, request, { publicTimelineEntries: 3 })
    const timeline = (prompt.publicState as { timeline: Array<{ data?: { text?: string } }> }).timeline
    expect(timeline.map(entry => entry.data?.text)).toEqual(['line 9', 'line 10', 'line 11'])
  })
})

describe('bot observation information isolation', () => {
  const rulesFor = () => miniRuleSet({ voteTie: 'no-elimination' })

  function promptsForAll() {
    const rules = rulesFor()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 55, ids: counterIds() })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    return opened.state.players.map((player) => {
      const request = buildWerewolfBotRequests(opened.state, counterIds())
        .find(candidate => candidate.playerId === player.playerId)
      if (request === undefined) return undefined
      return {
        player,
        prompt: projectWerewolfBotObservation(opened.state, rules, request, limits),
      }
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
  }

  it('never leaks another seat\'s faction or role to a villager observation', () => {
    for (const { player, prompt } of promptsForAll()) {
      if (player.faction !== 'village') continue
      const serialized = JSON.stringify(prompt)
      expect(serialized).not.toContain('"wolf"')
      for (const other of promptsForAll()) {
        if (other.player.playerId === player.playerId) continue
        expect(serialized).not.toContain(other.player.roleId === 'mini.wolf' ? '"mini.wolf"' : '"mini.villager"')
      }
    }
  })

  it('shows a wolf exactly its teammates and nothing of other private knowledge', () => {
    const rules = rulesFor()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 55, ids: counterIds() })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    const wolves = state.players.filter(player => player.faction === 'wolf')
    for (const wolf of wolves) {
      const request = buildWerewolfBotRequests(opened.state, counterIds())
        .find(candidate => candidate.playerId === wolf.playerId)
      if (request === undefined) throw new Error('wolf is not an actor')
      const prompt = projectWerewolfBotObservation(opened.state, rules, request, limits)
      const knowledge = prompt.privateKnowledge as { teammates?: string[] }
      expect([...(knowledge.teammates ?? [])].sort())
        .toEqual(wolves.filter(other => other.playerId !== wolf.playerId).map(other => other.playerId).sort())
      for (const villager of state.players.filter(player => player.faction === 'village')) {
        expect(knowledge.teammates ?? []).not.toContain(villager.playerId)
      }
    }
  })

  it('carries no other bot\'s continuity context', () => {
    const entries = promptsForAll()
    for (const { player, prompt } of entries) {
      const serialized = JSON.stringify(prompt)
      expect(serialized).toContain(JSON.stringify(prompt.priorContext.beliefs[0]))
      for (const other of entries) {
        if (other.player.playerId === player.playerId) continue
        const foreignStrategy = JSON.stringify(other.prompt.priorContext.strategy)
        if (foreignStrategy !== JSON.stringify(prompt.priorContext.strategy)) {
          expect(serialized).not.toContain(foreignStrategy)
        }
      }
    }
  })
})
