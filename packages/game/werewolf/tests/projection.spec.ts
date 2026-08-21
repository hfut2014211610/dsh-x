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
    const legalAction = prompt.legalAction as { actionKind: string; spec: { kind: string } }
    expect(legalAction.actionKind).toBe(request.actionKind)
    expect(legalAction.spec.kind).toBe(request.spec.kind)
  })

  it('covers optional-field absence: no teammates, no actor, no data, no context', () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 31, ids: counterIds() })
    const villager = state.players.find(player => player.roleId === 'mini.villager' && player.alive)
    if (villager === undefined) throw new Error('no living villager')
    const bare: typeof state = {
      ...state,
      players: state.players.map(entry => entry.playerId === villager.playerId
        ? { ...entry, notices: [{ toPlayerId: entry.playerId, kind: 'k', data: { x: 1 } }] }
        : entry),
      timeline: [
        { id: '0', day: 1, phaseId: 'p', kind: 'announcement', key: 'k', actorId: villager.playerId, data: { y: 2 } },
        { id: '1', day: 1, phaseId: 'p', kind: 'system', key: 'k2' },
      ],
      openPhase: null,
    }
    const request = {
      decisionId: 'd' as never,
      gameId: state.gameId,
      sourceGameRevision: state.revision,
      playerId: villager.playerId,
      phaseInstanceId: 'i' as never,
      phaseId: 'day.talk',
      day: 1,
      actionKind: 'speech',
      spec: { kind: 'text' as const, maxChars: 10, allowSkip: true },
      context: { hint: 'speak now' },
      priorContext: state.contexts[villager.human ? '' : villager.playerId] ?? {
        version: 1, gameId: state.gameId, playerId: villager.playerId, revision: 0,
        profile: { personalityId: 'p', speakingStyle: 's', riskStyle: 'balanced' as const },
        beliefs: [], commitments: [], strategy: { objective: 'o', priorityTargets: [] }, memorySummary: 'm',
      },
    }
    const prompt = projectWerewolfBotObservation(bare, rules, request, limits)
    expect((prompt.privateKnowledge as { teammates?: unknown }).teammates).toBeUndefined()
    const timeline = (prompt.publicState as { timeline: Array<Record<string, unknown>> }).timeline
    expect(timeline[0]).toHaveProperty('actorId')
    expect(timeline[0]).toHaveProperty('data')
    expect((prompt.privateKnowledge as Record<string, unknown>)).toEqual({})
    expect((prompt.legalAction as Record<string, unknown>)).toHaveProperty('context')
  })

  it('throws for an unseated player or uncompiled role', () => {
    const { rules, state, request } = botState()
    expect(() => projectWerewolfBotObservation(state, rules, { ...request, playerId: WerewolfPlayerId('ghost') }, limits))
      .toThrow(/is not seated/)
    const corrupted = { ...rules, roles: new Map() }
    expect(() => projectWerewolfBotObservation(state, corrupted, request, limits)).toThrow(/did not compile/)
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
