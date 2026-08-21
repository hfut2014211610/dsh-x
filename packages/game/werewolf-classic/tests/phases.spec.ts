import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {
  WerewolfParticipantFactsV1,
  WerewolfPhaseDefinition,
  WerewolfPhaseOpenInputV1,
  WerewolfPhaseResolveInputV1,
  WerewolfPoliciesV1,
  WerewolfPlayerFactsV1,
  WerewolfPriorResolutionV1,
  WerewolfResolutionV1,
  WerewolfRng,
} from '@deepseek-ai/dsh-werewolf'
import { WerewolfPlayerId } from '@deepseek-ai/dsh-werewolf'
import {
  ANNOUNCE_PHASE,
  DISCUSSION_PHASE,
  SEER_INSPECT_PHASE,
  VOTE_PHASE,
  WITCH_PHASE,
  WOLF_KILL_PHASE,
} from '../src/phases.ts'

function player(id: string, seat: number, alive = true): WerewolfPlayerFactsV1 {
  return { playerId: WerewolfPlayerId(id), seat, displayName: `Seat ${seat}`, alive }
}

function participant(
  id: string,
  seat: number,
  options: { alive?: boolean; roleState?: unknown; resources?: Record<string, number> } = {},
): WerewolfParticipantFactsV1 {
  return {
    playerId: WerewolfPlayerId(id),
    seat,
    alive: options.alive ?? true,
    roleState: (options.roleState ?? null) as JsonValue,
    resources: options.resources ?? {},
    binding: {},
  }
}

function policies(overrides: Partial<WerewolfPoliciesV1> = {}): WerewolfPoliciesV1 {
  return {
    voteTie: 'revote-once',
    wolfTie: 'seeded-random',
    deadHuman: 'spectate',
    maxDays: 8,
    speechMaxChars: 160,
    ...overrides,
  }
}

function makeRng(): { rng: WerewolfRng; picks: string[] } {
  const picks: string[] = []
  return {
    picks,
    rng: {
      pick<T>(items: readonly T[]): T {
        const chosen = items[0] as T
        picks.push(String(chosen))
        return chosen
      },
    },
  }
}

function openInput(fields: Partial<WerewolfPhaseOpenInputV1> = {}): WerewolfPhaseOpenInputV1 {
  const { rng } = makeRng()
  return {
    day: 1,
    occurrence: 0,
    policies: policies(),
    players: [],
    participants: [],
    sameDayHistory: [],
    rng,
    ...fields,
  }
}

function resolveInput(
  definition: WerewolfPhaseDefinition,
  fields: Partial<WerewolfPhaseResolveInputV1>,
): WerewolfResolutionV1 {
  const compiled = definition.compile({ options: definition.parseOptions(undefined), participants: [] })
  return compiled.resolve({
    ...openInput(),
    actions: [],
    ...fields,
  })
}

function prior(
  phaseId: string,
  outcome: JsonValue,
  extra: Partial<WerewolfResolutionV1> = {},
): WerewolfPriorResolutionV1 {
  return {
    phaseId,
    phaseVersion: 1,
    day: 1,
    segment: 'night',
    resolution: {
      eliminations: [],
      prevented: [],
      resourceReplacements: [],
      roleStateReplacements: [],
      privateNotices: [],
      announcements: [],
      votes: [],
      outcome,
      ...extra,
    },
  }
}

const sevenPlayers = (): WerewolfPlayerFactsV1[] => [
  player('p1', 1), player('p2', 2), player('p3', 3),
  player('p4', 4), player('p5', 5), player('p6', 6, false), player('p7', 7),
]

describe('night.wolf-kill', () => {
  it('parses no options and only the kill binding kind', () => {
    expect(WOLF_KILL_PHASE.parseOptions(undefined)).toEqual({})
    expect(WOLF_KILL_PHASE.parseOptions({})).toEqual({})
    expect(() => WOLF_KILL_PHASE.parseOptions({ blood: 1 })).toThrow(/unknown key/)
    expect(WOLF_KILL_PHASE.parseRoleBinding({
      phaseId: 'night.wolf-kill', phaseVersion: 1, required: true, kind: 'kill', options: {},
    })).toEqual({})
    expect(() => WOLF_KILL_PHASE.parseRoleBinding({
      phaseId: 'night.wolf-kill', phaseVersion: 1, required: true, kind: 'act', options: {},
    })).toThrow(/supports binding kind/)
    expect(() => WOLF_KILL_PHASE.parseRoleBinding({
      phaseId: 'night.wolf-kill', phaseVersion: 1, required: true, kind: 'kill', options: { pack: 1 },
    })).toThrow(/unknown key/)
  })

  it('skips without living wolves and without living non-wolf targets', () => {
    const compiled = WOLF_KILL_PHASE.compile({ options: {}, participants: [] })
    expect(compiled.open(openInput({ players: sevenPlayers(), participants: [] })))
      .toEqual({ kind: 'skip', reason: 'no living wolves' })
    expect(compiled.open(openInput({
      players: sevenPlayers(),
      participants: [participant('p1', 1, { alive: false }), participant('p2', 2, { alive: false })],
    }))).toEqual({ kind: 'skip', reason: 'no living wolves' })
    expect(compiled.open(openInput({
      players: [player('p1', 1), player('p2', 2, false), player('p3', 3, false)],
      participants: [participant('p1', 1), participant('p3', 3)],
    }))).toEqual({ kind: 'skip', reason: 'no living non-wolf targets' })
  })

  it('plans one kill target list for each living wolf in seat order', () => {
    const compiled = WOLF_KILL_PHASE.compile({ options: {}, participants: [] })
    const result = compiled.open(openInput({
      players: sevenPlayers(),
      participants: [participant('p4', 4), participant('p2', 2), participant('p6', 6, { alive: false })],
    }))
    expect(result).toEqual({
      kind: 'plan',
      plan: {
        mode: 'parallel-private',
        actors: [
          { playerId: WerewolfPlayerId('p2'), seat: 2, actionKind: 'wolf-kill', spec: {
            kind: 'player-target', targets: [WerewolfPlayerId('p1'), WerewolfPlayerId('p3'), WerewolfPlayerId('p5'), WerewolfPlayerId('p7')], allowSkip: false,
          } },
          { playerId: WerewolfPlayerId('p4'), seat: 4, actionKind: 'wolf-kill', spec: {
            kind: 'player-target', targets: [WerewolfPlayerId('p1'), WerewolfPlayerId('p3'), WerewolfPlayerId('p5'), WerewolfPlayerId('p7')], allowSkip: false,
          } },
        ],
      },
    })
  })

  it('resolves a unanimous kill to the shared victim', () => {
    const resolution = resolveInput(WOLF_KILL_PHASE, {
      players: sevenPlayers(),
      actions: [
        { playerId: WerewolfPlayerId('p4'), action: { value: WerewolfPlayerId('p5') } },
        { playerId: WerewolfPlayerId('p2'), action: { value: WerewolfPlayerId('p5') } },
      ],
    })
    expect(resolution.votes).toEqual([
      { voterId: WerewolfPlayerId('p2'), targetId: WerewolfPlayerId('p5') },
      { voterId: WerewolfPlayerId('p4'), targetId: WerewolfPlayerId('p5') },
    ])
    expect(resolution.privateNotices).toEqual([
      { toPlayerId: WerewolfPlayerId('p2'), kind: 'wolf-kill-result', data: { victim: WerewolfPlayerId('p5') } },
      { toPlayerId: WerewolfPlayerId('p4'), kind: 'wolf-kill-result', data: { victim: WerewolfPlayerId('p5') } },
    ])
    expect(resolution.outcome).toEqual({ victim: WerewolfPlayerId('p5'), proposed: [WerewolfPlayerId('p5')] })
    expect(resolution.eliminations).toEqual([])
  })

  it('applies the no-kill tie policy to a disagreement', () => {
    const resolution = resolveInput(WOLF_KILL_PHASE, {
      players: sevenPlayers(),
      policies: policies({ wolfTie: 'no-kill' }),
      actions: [
        { playerId: WerewolfPlayerId('p4'), action: { value: WerewolfPlayerId('p3') } },
        { playerId: WerewolfPlayerId('p2'), action: { value: WerewolfPlayerId('p5') } },
      ],
    })
    expect(resolution.outcome).toEqual({
      victim: null,
      proposed: [WerewolfPlayerId('p5'), WerewolfPlayerId('p3')],
    })
    expect(resolution.privateNotices[0]).toEqual({
      toPlayerId: WerewolfPlayerId('p2'), kind: 'wolf-kill-result', data: { victim: null },
    })
  })

  it('applies the seeded-random tie policy to a disagreement', () => {
    const { rng, picks } = makeRng()
    const compiled = WOLF_KILL_PHASE.compile({ options: {}, participants: [] })
    const resolution = compiled.resolve({
      ...openInput({ players: sevenPlayers(), rng }),
      actions: [
        { playerId: WerewolfPlayerId('p4'), action: { value: WerewolfPlayerId('p3') } },
        { playerId: WerewolfPlayerId('p2'), action: { value: WerewolfPlayerId('p5') } },
        { playerId: WerewolfPlayerId('p7'), action: { value: WerewolfPlayerId('p3') } },
      ],
    })
    expect(picks).toEqual(['p5'])
    expect(resolution.outcome).toEqual({
      victim: WerewolfPlayerId('p5'),
      proposed: [WerewolfPlayerId('p5'), WerewolfPlayerId('p3')],
    })
  })

  it('resolves an empty action set to no victim without drawing rng', () => {
    const { rng, picks } = makeRng()
    const compiled = WOLF_KILL_PHASE.compile({ options: {}, participants: [] })
    const resolution = compiled.resolve({ ...openInput({ players: sevenPlayers(), rng }), actions: [] })
    expect(resolution.outcome).toEqual({ victim: null, proposed: [] })
    expect(resolution.votes).toEqual([])
    expect(picks).toEqual([])
  })

  it('rejects an action actor that is not on the roster', () => {
    expect(() => resolveInput(WOLF_KILL_PHASE, {
      players: sevenPlayers(),
      actions: [
        { playerId: WerewolfPlayerId('p2'), action: { value: WerewolfPlayerId('p1') } },
        { playerId: WerewolfPlayerId('p0'), action: { value: WerewolfPlayerId('p1') } },
      ],
    })).toThrow(/not on the roster/)
  })
})

describe('night.seer-inspect', () => {
  it('parses no options and only the inspect binding kind', () => {
    expect(SEER_INSPECT_PHASE.parseOptions(undefined)).toEqual({})
    expect(() => SEER_INSPECT_PHASE.parseOptions({ reveal: true })).toThrow(/unknown key/)
    expect(SEER_INSPECT_PHASE.parseRoleBinding({
      phaseId: 'night.seer-inspect', phaseVersion: 1, required: true, kind: 'inspect', options: {},
    })).toEqual({})
    expect(() => SEER_INSPECT_PHASE.parseRoleBinding({
      phaseId: 'night.seer-inspect', phaseVersion: 1, required: true, kind: 'kill', options: {},
    })).toThrow(/supports binding kind/)
  })

  it('skips without a living seer or without another living player', () => {
    const compiled = SEER_INSPECT_PHASE.compile({ options: {}, participants: [] })
    expect(compiled.open(openInput({ players: sevenPlayers(), participants: [] })))
      .toEqual({ kind: 'skip', reason: 'no living seer' })
    expect(compiled.open(openInput({
      players: [player('p1', 1), player('p2', 2, false)],
      participants: [participant('p1', 1)],
    }))).toEqual({ kind: 'skip', reason: 'no living inspection target' })
  })

  it('targets every living player except the seer', () => {
    const compiled = SEER_INSPECT_PHASE.compile({ options: {}, participants: [] })
    const result = compiled.open(openInput({
      players: sevenPlayers(),
      participants: [participant('p3', 3), participant('p6', 6, { alive: false })],
    }))
    expect(result).toEqual({
      kind: 'plan',
      plan: {
        mode: 'parallel-private',
        actors: [{
          playerId: WerewolfPlayerId('p3'),
          seat: 3,
          actionKind: 'seer-inspect',
          spec: {
            kind: 'player-target',
            targets: [WerewolfPlayerId('p1'), WerewolfPlayerId('p2'), WerewolfPlayerId('p4'), WerewolfPlayerId('p5'), WerewolfPlayerId('p7')],
            allowSkip: false,
          },
        }],
      },
    })
  })

  it('appends the check with the inspected faction when player facts carry it', () => {
    const players = sevenPlayers().map(entry =>
      entry.playerId === WerewolfPlayerId('p4') ? { ...entry, faction: 'wolf' } : entry)
    const resolution = resolveInput(SEER_INSPECT_PHASE, {
      players,
      day: 3,
      participants: [participant('p3', 3, { roleState: { checks: [{ target: 'p1', day: 2 }] } })],
      actions: [{ playerId: WerewolfPlayerId('p3'), action: { value: WerewolfPlayerId('p4') } }],
    })
    expect(resolution.roleStateReplacements).toEqual([{
      playerId: WerewolfPlayerId('p3'),
      roleState: { checks: [
        { target: WerewolfPlayerId('p1'), day: 2 },
        { target: WerewolfPlayerId('p4'), faction: 'wolf', day: 3 },
      ] },
    }])
    expect(resolution.privateNotices).toEqual([{
      toPlayerId: WerewolfPlayerId('p3'), kind: 'seer-inspect', data: { target: WerewolfPlayerId('p4'), faction: 'wolf' },
    }])
    expect(resolution.outcome).toEqual({ checks: [{ target: WerewolfPlayerId('p4'), faction: 'wolf', day: 3 }] })
  })

  it('omits the faction field when player facts publish none', () => {
    const resolution = resolveInput(SEER_INSPECT_PHASE, {
      players: sevenPlayers(),
      day: 1,
      participants: [participant('p3', 3, { roleState: { checks: [] } })],
      actions: [{ playerId: WerewolfPlayerId('p3'), action: { value: WerewolfPlayerId('p4') } }],
    })
    expect(resolution.roleStateReplacements).toEqual([{
      playerId: WerewolfPlayerId('p3'),
      roleState: { checks: [{ target: WerewolfPlayerId('p4'), day: 1 }] },
    }])
    expect(resolution.privateNotices).toEqual([{
      toPlayerId: WerewolfPlayerId('p3'), kind: 'seer-inspect', data: { target: WerewolfPlayerId('p4') },
    }])
  })

  it('rejects an action actor that is not a participant', () => {
    expect(() => resolveInput(SEER_INSPECT_PHASE, {
      players: sevenPlayers(),
      participants: [participant('p3', 3, { roleState: { checks: [] } })],
      actions: [{ playerId: WerewolfPlayerId('p2'), action: { value: WerewolfPlayerId('p4') } }],
    })).toThrow(/not a phase participant/)
  })
})

describe('night.witch', () => {
  const witchState = (selfSave: 'first-night-only' | 'never'): JsonValue => ({
    antidoteUses: 1, poisonUses: 1, selfSave,
  })
  const witchParticipant = (options: {
    resources?: Record<string, number>
    selfSave?: 'first-night-only' | 'never'
    alive?: boolean
  } = {}): WerewolfParticipantFactsV1 => participant('p4', 4, {
    roleState: witchState(options.selfSave ?? 'first-night-only'),
    resources: options.resources ?? { antidote: 1, poison: 1 },
    alive: options.alive ?? true,
  })
  const wolfKillPrior = (victim: string | null): WerewolfPriorResolutionV1 =>
    prior('night.wolf-kill', { victim: victim === null ? null : WerewolfPlayerId(victim), proposed: [] })

  it('parses no options and only the act binding kind', () => {
    expect(WITCH_PHASE.parseOptions(undefined)).toEqual({})
    expect(() => WITCH_PHASE.parseOptions({ brew: 2 })).toThrow(/unknown key/)
    expect(WITCH_PHASE.parseRoleBinding({
      phaseId: 'night.witch', phaseVersion: 1, required: true, kind: 'act', options: {},
    })).toEqual({})
    expect(() => WITCH_PHASE.parseRoleBinding({
      phaseId: 'night.witch', phaseVersion: 1, required: true, kind: 'inspect', options: {},
    })).toThrow(/supports binding kind/)
  })

  it('skips without a living witch and when every potion is spent', () => {
    const compiled = WITCH_PHASE.compile({ options: {}, participants: [] })
    expect(compiled.open(openInput({ players: sevenPlayers(), participants: [] })))
      .toEqual({ kind: 'skip', reason: 'no living witch' })
    expect(compiled.open(openInput({
      players: sevenPlayers(),
      participants: [witchParticipant({ resources: { antidote: 0, poison: 0 } })],
    }))).toEqual({ kind: 'skip', reason: 'witch has no potion left' })
    expect(compiled.open(openInput({
      players: sevenPlayers(),
      participants: [witchParticipant({ resources: {} })],
    }))).toEqual({ kind: 'skip', reason: 'witch has no potion left' })
  })

  it('offers antidote use only with a living victim, a remaining antidote, and an allowed self-save', () => {
    const compiled = WITCH_PHASE.compile({ options: {}, participants: [] })
    const antidoteOptions = (fields: Partial<WerewolfPhaseOpenInputV1>): string[] => {
      const result = compiled.open(openInput(fields))
      if (result.kind !== 'plan') throw new Error(`expected plan, got ${JSON.stringify(result)}`)
      const actor = result.plan.actors[0]
      if (actor === undefined || actor.spec.kind !== 'compound') throw new Error('expected a compound spec')
      const antidote = actor.spec.fields.find(field => field.id === 'antidote')
      if (antidote === undefined || antidote.spec.kind !== 'choice') throw new Error('expected an antidote choice')
      return [...antidote.spec.options]
    }
    expect(antidoteOptions({
      players: sevenPlayers(), participants: [witchParticipant()], sameDayHistory: [wolfKillPrior('p2')],
    })).toEqual(['use', 'skip'])
    expect(antidoteOptions({
      players: sevenPlayers(), participants: [witchParticipant()],
    })).toEqual(['skip'])
    expect(antidoteOptions({
      players: sevenPlayers(), participants: [witchParticipant()], sameDayHistory: [wolfKillPrior(null)],
    })).toEqual(['skip'])
    expect(antidoteOptions({
      players: sevenPlayers(), participants: [witchParticipant({ resources: { antidote: 0, poison: 1 } })],
      sameDayHistory: [wolfKillPrior('p2')],
    })).toEqual(['skip'])
    expect(antidoteOptions({
      players: sevenPlayers(), participants: [witchParticipant({ selfSave: 'never' })],
      sameDayHistory: [wolfKillPrior('p4')],
    })).toEqual(['skip'])
    expect(antidoteOptions({
      players: sevenPlayers(), participants: [witchParticipant()],
      sameDayHistory: [wolfKillPrior('p4')],
    })).toEqual(['use', 'skip'])
    expect(antidoteOptions({
      day: 2,
      players: sevenPlayers(), participants: [witchParticipant()],
      sameDayHistory: [wolfKillPrior('p4')],
    })).toEqual(['skip'])
  })

  it('limits poison targets to living non-self players while poison remains', () => {
    const compiled = WITCH_PHASE.compile({ options: {}, participants: [] })
    const open = compiled.open(openInput({
      players: sevenPlayers(),
      participants: [witchParticipant({ resources: { antidote: 0, poison: 1 } })],
      sameDayHistory: [wolfKillPrior('p2')],
    }))
    if (open.kind !== 'plan') throw new Error('expected plan')
    const actor = open.plan.actors[0]
    if (actor === undefined || actor.spec.kind !== 'compound') throw new Error('expected a compound spec')
    expect(actor.context).toEqual({ victim: WerewolfPlayerId('p2') })
    const poison = actor.spec.fields.find(field => field.id === 'poison')
    if (poison === undefined || poison.spec.kind !== 'player-target') throw new Error('expected a poison target')
    expect(poison.spec.targets).toEqual([
      WerewolfPlayerId('p1'), WerewolfPlayerId('p2'), WerewolfPlayerId('p3'),
      WerewolfPlayerId('p5'), WerewolfPlayerId('p7'),
    ])
    expect(poison.spec.allowSkip).toBe(true)

    const dry = compiled.open(openInput({
      players: sevenPlayers(),
      participants: [witchParticipant({ resources: { antidote: 1, poison: 0 } })],
      sameDayHistory: [wolfKillPrior('p2')],
    }))
    if (dry.kind !== 'plan') throw new Error('expected plan')
    const dryActor = dry.plan.actors[0]
    if (dryActor === undefined || dryActor.spec.kind !== 'compound') throw new Error('expected a compound spec')
    const dryPoison = dryActor.spec.fields.find(field => field.id === 'poison')
    if (dryPoison === undefined || dryPoison.spec.kind !== 'player-target') throw new Error('expected a poison target')
    expect(dryPoison.spec.targets).toEqual([])
  })

  it('resolves antidote use, poison use, and passes', () => {
    const savedAndPoisoned = resolveInput(WITCH_PHASE, {
      players: sevenPlayers(),
      participants: [witchParticipant()],
      sameDayHistory: [wolfKillPrior('p2')],
      actions: [{ playerId: WerewolfPlayerId('p4'), action: { antidote: 'use', poison: WerewolfPlayerId('p5') } }],
    })
    expect(savedAndPoisoned.resourceReplacements).toEqual([
      { playerId: WerewolfPlayerId('p4'), resourceId: 'antidote', remaining: 0 },
      { playerId: WerewolfPlayerId('p4'), resourceId: 'poison', remaining: 0 },
    ])
    expect(savedAndPoisoned.prevented).toEqual([{ playerId: WerewolfPlayerId('p2'), cause: 'witch-antidote' }])
    expect(savedAndPoisoned.outcome).toEqual({
      victim: WerewolfPlayerId('p2'), saved: true, poisoned: WerewolfPlayerId('p5'),
    })

    const passed = resolveInput(WITCH_PHASE, {
      players: sevenPlayers(),
      participants: [witchParticipant()],
      sameDayHistory: [wolfKillPrior('p2')],
      actions: [{ playerId: WerewolfPlayerId('p4'), action: { antidote: 'skip', poison: null } }],
    })
    expect(passed.resourceReplacements).toEqual([])
    expect(passed.prevented).toEqual([])
    expect(passed.outcome).toEqual({ victim: WerewolfPlayerId('p2'), saved: false, poisoned: null })
  })

  it('records no prevention when no kill resolved tonight', () => {
    const resolution = resolveInput(WITCH_PHASE, {
      players: sevenPlayers(),
      participants: [witchParticipant()],
      actions: [{ playerId: WerewolfPlayerId('p4'), action: { antidote: 'use', poison: null } }],
    })
    expect(resolution.prevented).toEqual([])
    expect(resolution.outcome).toEqual({ victim: null, saved: true, poisoned: null })
  })
})

describe('day.announce', () => {
  it('parses no options and rejects every role binding', () => {
    expect(ANNOUNCE_PHASE.parseOptions(undefined)).toEqual({})
    expect(() => ANNOUNCE_PHASE.parseOptions({ loud: true })).toThrow(/unknown key/)
    expect(() => ANNOUNCE_PHASE.parseRoleBinding({
      phaseId: 'day.announce', phaseVersion: 1, required: false, kind: 'witness', options: {},
    })).toThrow(/accepts no role bindings/)
  })

  it('opens with zero actors', () => {
    const compiled = ANNOUNCE_PHASE.compile({ options: {}, participants: [] })
    expect(compiled.open(openInput())).toEqual({
      kind: 'plan',
      plan: { mode: 'parallel-private', actors: [] },
    })
  })

  it('announces an unsaved wolf-kill victim', () => {
    const resolution = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p5'),
        prior('night.witch', { victim: WerewolfPlayerId('p5'), saved: false, poisoned: null }),
      ],
    })
    expect(resolution.eliminations).toEqual([{ playerId: WerewolfPlayerId('p5'), cause: 'wolf-kill' }])
    expect(resolution.announcements).toEqual([{
      kind: 'death', key: 'announce.death', data: { playerId: WerewolfPlayerId('p5'), cause: 'wolf-kill' },
    }])
    expect(resolution.outcome).toEqual({ deaths: [{ playerId: WerewolfPlayerId('p5'), cause: 'wolf-kill' }] })
  })

  it('announces no death when the antidote saved the victim', () => {
    const resolution = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p5'),
        prior('night.witch', { victim: WerewolfPlayerId('p5'), saved: true, poisoned: null }),
      ],
    })
    expect(resolution.eliminations).toEqual([])
    expect(resolution.announcements).toEqual([{ kind: 'system', key: 'announce.no-death' }])
    expect(resolution.outcome).toEqual({ deaths: [] })
  })

  it('announces a poison death beside or instead of the wolf-kill death', () => {
    const both = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p2'),
        prior('night.witch', { victim: WerewolfPlayerId('p2'), saved: false, poisoned: WerewolfPlayerId('p5') }),
      ],
    })
    expect(both.eliminations).toEqual([
      { playerId: WerewolfPlayerId('p2'), cause: 'wolf-kill' },
      { playerId: WerewolfPlayerId('p5'), cause: 'poison' },
    ])
    expect(both.announcements).toHaveLength(2)

    const savedButPoisoned = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p2'),
        prior('night.witch', { victim: WerewolfPlayerId('p2'), saved: true, poisoned: WerewolfPlayerId('p2') }),
      ],
    })
    expect(savedButPoisoned.eliminations).toEqual([{ playerId: WerewolfPlayerId('p2'), cause: 'poison' }])

    const doubleDeath = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p2'),
        prior('night.witch', { victim: WerewolfPlayerId('p2'), saved: false, poisoned: WerewolfPlayerId('p2') }),
      ],
    })
    expect(doubleDeath.eliminations).toEqual([{ playerId: WerewolfPlayerId('p2'), cause: 'wolf-kill' }])
  })

  it('skips a poisoned player who is dead or unknown', () => {
    const dead = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p2'),
        prior('night.witch', { victim: WerewolfPlayerId('p2'), saved: false, poisoned: WerewolfPlayerId('p6') }),
      ],
    })
    expect(dead.eliminations).toEqual([{ playerId: WerewolfPlayerId('p2'), cause: 'wolf-kill' }])

    const unknown = resolveInput(ANNOUNCE_PHASE, {
      players: sevenPlayers(),
      sameDayHistory: [
        wolfKillPriorStub('p2'),
        prior('night.witch', { victim: WerewolfPlayerId('p2'), saved: true, poisoned: WerewolfPlayerId('p0') }),
      ],
    })
    expect(unknown.eliminations).toEqual([])
    expect(unknown.announcements).toEqual([{ kind: 'system', key: 'announce.no-death' }])
  })

  it('announces no death on a silent night', () => {
    const resolution = resolveInput(ANNOUNCE_PHASE, { players: sevenPlayers() })
    expect(resolution.eliminations).toEqual([])
    expect(resolution.announcements).toEqual([{ kind: 'system', key: 'announce.no-death' }])
  })
})

function wolfKillPriorStub(victim: string): WerewolfPriorResolutionV1 {
  return prior('night.wolf-kill', { victim: WerewolfPlayerId(victim), proposed: [WerewolfPlayerId(victim)] })
}

describe('day.discussion', () => {
  it('parses no options and rejects every role binding', () => {
    expect(DISCUSSION_PHASE.parseOptions(undefined)).toEqual({})
    expect(() => DISCUSSION_PHASE.parseOptions({ order: 'reverse' })).toThrow(/unknown key/)
    expect(() => DISCUSSION_PHASE.parseRoleBinding({
      phaseId: 'day.discussion', phaseVersion: 1, required: false, kind: 'speak', options: {},
    })).toThrow(/accepts no role bindings/)
  })

  it('plans one speech field for every living player in seat order', () => {
    const compiled = DISCUSSION_PHASE.compile({ options: {}, participants: [] })
    const result = compiled.open(openInput({
      players: sevenPlayers(),
      policies: policies({ speechMaxChars: 42 }),
    }))
    expect(result).toEqual({
      kind: 'plan',
      plan: {
        mode: 'seat-order-public',
        actors: [1, 2, 3, 4, 5, 7].map(seat => ({
          playerId: WerewolfPlayerId(`p${seat}`),
          seat,
          actionKind: 'speak',
          spec: { kind: 'text', maxChars: 42, allowSkip: true },
        })),
      },
    })
  })

  it('records the accepted speeches and nothing else', () => {
    const withSpeeches = resolveInput(DISCUSSION_PHASE, {
      players: sevenPlayers(),
      speeches: [{ playerId: WerewolfPlayerId('p1'), text: 'I am innocent.' }],
    })
    expect(withSpeeches.outcome).toEqual({
      speeches: [{ playerId: WerewolfPlayerId('p1'), text: 'I am innocent.' }],
    })
    expect(withSpeeches.eliminations).toEqual([])
    expect(withSpeeches.announcements).toEqual([])

    const silent = resolveInput(DISCUSSION_PHASE, { players: sevenPlayers() })
    expect(silent.outcome).toEqual({ speeches: [] })
  })
})

describe('day.vote', () => {
  it('parses no options and rejects every role binding', () => {
    expect(VOTE_PHASE.parseOptions(undefined)).toEqual({})
    expect(() => VOTE_PHASE.parseOptions({ revote: 2 })).toThrow(/unknown key/)
    expect(() => VOTE_PHASE.parseRoleBinding({
      phaseId: 'day.vote', phaseVersion: 1, required: false, kind: 'vote', options: {},
    })).toThrow(/accepts no role bindings/)
  })

  it('targets every living non-self player at occurrence 0', () => {
    const compiled = VOTE_PHASE.compile({ options: {}, participants: [] })
    const result = compiled.open(openInput({ players: sevenPlayers() }))
    if (result.kind !== 'plan') throw new Error('expected plan')
    const voters = result.plan.actors.map(actor => actor.playerId)
    expect(voters).toEqual([WerewolfPlayerId('p1'), WerewolfPlayerId('p2'), WerewolfPlayerId('p3'), WerewolfPlayerId('p4'), WerewolfPlayerId('p5'), WerewolfPlayerId('p7')])
    const first = result.plan.actors[0]
    if (first === undefined || first.spec.kind !== 'player-target') throw new Error('expected a target spec')
    expect(first.spec.targets).toEqual([WerewolfPlayerId('p2'), WerewolfPlayerId('p3'), WerewolfPlayerId('p4'), WerewolfPlayerId('p5'), WerewolfPlayerId('p7')])
    expect(first.spec.allowSkip).toBe(true)
  })

  it('restricts revote targets to the prior tie among living players', () => {
    const compiled = VOTE_PHASE.compile({ options: {}, participants: [] })
    const tied = compiled.open(openInput({
      occurrence: 1,
      players: sevenPlayers(),
      sameDayHistory: [prior('day.vote', { eliminated: null, tiedPlayers: [] }, {
        voteOutcome: { eliminated: null, tiedPlayers: [WerewolfPlayerId('p2'), WerewolfPlayerId('p6')] },
      })],
    }))
    if (tied.kind !== 'plan') throw new Error('expected plan')
    const tiedVoter = tied.plan.actors.find(actor => actor.playerId === WerewolfPlayerId('p2'))
    if (tiedVoter === undefined || tiedVoter.spec.kind !== 'player-target') throw new Error('expected a target spec')
    expect(tiedVoter.spec.targets).toEqual([])
    const third = tied.plan.actors[2]
    if (third === undefined || third.spec.kind !== 'player-target') throw new Error('expected a target spec')
    expect(third.spec.targets).toEqual([WerewolfPlayerId('p2')])
  })

  it('falls back to every living player without a usable prior tie', () => {
    const compiled = VOTE_PHASE.compile({ options: {}, participants: [] })
    const noHistory = compiled.open(openInput({ occurrence: 1, players: sevenPlayers() }))
    const settled = compiled.open(openInput({
      occurrence: 2,
      players: sevenPlayers(),
      sameDayHistory: [
        prior('day.vote', { eliminated: null, tiedPlayers: [] }, {
          voteOutcome: { eliminated: null, tiedPlayers: [WerewolfPlayerId('p2'), WerewolfPlayerId('p3')] },
        }),
        prior('day.vote', { eliminated: WerewolfPlayerId('p2'), tiedPlayers: [] }, {
          voteOutcome: { eliminated: WerewolfPlayerId('p2'), tiedPlayers: [] },
        }),
      ],
    }))
    for (const result of [noHistory, settled]) {
      if (result.kind !== 'plan') throw new Error('expected plan')
      const first = result.plan.actors[0]
      if (first === undefined || first.spec.kind !== 'player-target') throw new Error('expected a target spec')
      expect(first.spec.targets).toEqual([WerewolfPlayerId('p2'), WerewolfPlayerId('p3'), WerewolfPlayerId('p4'), WerewolfPlayerId('p5'), WerewolfPlayerId('p7')])
    }
  })

  it('eliminates the unique highest vote count', () => {
    const resolution = resolveInput(VOTE_PHASE, {
      players: sevenPlayers(),
      actions: [
        { playerId: WerewolfPlayerId('p1'), action: { value: WerewolfPlayerId('p3') } },
        { playerId: WerewolfPlayerId('p2'), action: { value: null } },
        { playerId: WerewolfPlayerId('p3'), action: { value: WerewolfPlayerId('p5') } },
        { playerId: WerewolfPlayerId('p4'), action: { value: WerewolfPlayerId('p3') } },
      ],
    })
    expect(resolution.votes).toEqual([
      { voterId: WerewolfPlayerId('p1'), targetId: WerewolfPlayerId('p3') },
      { voterId: WerewolfPlayerId('p2'), targetId: null },
      { voterId: WerewolfPlayerId('p3'), targetId: WerewolfPlayerId('p5') },
      { voterId: WerewolfPlayerId('p4'), targetId: WerewolfPlayerId('p3') },
    ])
    expect(resolution.eliminations).toEqual([{ playerId: WerewolfPlayerId('p3'), cause: 'vote' }])
    expect(resolution.announcements).toEqual([{
      kind: 'vote', key: 'vote.eliminated', data: { playerId: WerewolfPlayerId('p3') },
    }])
    expect(resolution.voteOutcome).toEqual({ eliminated: WerewolfPlayerId('p3'), tiedPlayers: [] })
    expect(resolution.outcome).toEqual({ eliminated: WerewolfPlayerId('p3'), tiedPlayers: [] })
  })

  it('reports a tie to the engine without eliminating', () => {
    const resolution = resolveInput(VOTE_PHASE, {
      players: sevenPlayers(),
      actions: [
        { playerId: WerewolfPlayerId('p1'), action: { value: WerewolfPlayerId('p3') } },
        { playerId: WerewolfPlayerId('p2'), action: { value: WerewolfPlayerId('p3') } },
        { playerId: WerewolfPlayerId('p3'), action: { value: WerewolfPlayerId('p5') } },
        { playerId: WerewolfPlayerId('p4'), action: { value: WerewolfPlayerId('p5') } },
      ],
    })
    expect(resolution.eliminations).toEqual([])
    expect(resolution.announcements).toEqual([{
      kind: 'vote', key: 'vote.tie', data: { tiedPlayers: [WerewolfPlayerId('p3'), WerewolfPlayerId('p5')] },
    }])
    expect(resolution.voteOutcome).toEqual({
      eliminated: null,
      tiedPlayers: [WerewolfPlayerId('p3'), WerewolfPlayerId('p5')],
    })
  })

  it('reports an all-abstain vote as no elimination and no tie', () => {
    const resolution = resolveInput(VOTE_PHASE, {
      players: sevenPlayers(),
      actions: [
        { playerId: WerewolfPlayerId('p1'), action: { value: null } },
        { playerId: WerewolfPlayerId('p2'), action: { value: null } },
      ],
    })
    expect(resolution.eliminations).toEqual([])
    expect(resolution.announcements).toEqual([])
    expect(resolution.voteOutcome).toEqual({ eliminated: null, tiedPlayers: [] })
  })
})
