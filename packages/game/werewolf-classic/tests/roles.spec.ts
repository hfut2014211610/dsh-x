import { describe, expect, it } from 'vitest'
import type {
  WerewolfRoleKnowledgeInputV1,
  WerewolfRuleSetSummaryV1,
} from '@deepseek-ai/dsh-werewolf'
import { WerewolfPlayerId } from '@deepseek-ai/dsh-werewolf'
import {
  SEER_ROLE,
  VILLAGER_ROLE,
  WEREWOLF_CLASSIC_FACTIONS,
  WITCH_ROLE,
  WOLF_ROLE,
} from '../src/roles.ts'

function summary(): WerewolfRuleSetSummaryV1 {
  return {
    id: 'quick-7',
    revision: 1,
    displayName: 'Quick 7-player game',
    playerCount: 7,
    policies: {
      voteTie: 'revote-once',
      wolfTie: 'seeded-random',
      deadHuman: 'spectate',
      maxDays: 8,
      speechMaxChars: 160,
    },
    deck: [],
  }
}

function knowledge(): WerewolfRoleKnowledgeInputV1 {
  return {
    self: {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      alive: true,
      roleState: { checks: [{ target: 'p2', faction: 'unknown', day: 1 }] },
      resources: { antidote: 0 },
      notices: [{ toPlayerId: WerewolfPlayerId('p1'), kind: 'seer-inspect', data: { seen: ['p2'] } }],
    },
    teammates: [{ playerId: WerewolfPlayerId('p3'), seat: 3, alive: false }],
    day: 2,
  }
}

describe('villager role', () => {
  it('accepts no options and rejects anything else', () => {
    expect(VILLAGER_ROLE.parseOptions(undefined)).toEqual({})
    expect(VILLAGER_ROLE.parseOptions({})).toEqual({})
    expect(() => VILLAGER_ROLE.parseOptions({ extra: 1 })).toThrow(/unknown key/)
    expect(() => VILLAGER_ROLE.parseOptions('none')).toThrow(/must be an object/)
    expect(() => VILLAGER_ROLE.parseOptions([1])).toThrow(/must be an object/)
  })

  it('compiles with no state, no resources, and no bindings', () => {
    const role = VILLAGER_ROLE.compile({ options: {}, ruleSet: summary() })
    expect(role.id).toBe('villager')
    expect(role.version).toBe(1)
    expect(role.faction).toBe(WEREWOLF_CLASSIC_FACTIONS.village)
    expect(role.publicName).toBe('Villager')
    expect(role.initialRoleState).toBeNull()
    expect(role.initialResources).toBeUndefined()
    expect(role.phaseBindings).toEqual([])
  })

  it('projects only own day, role state, resources, and notices', () => {
    const role = VILLAGER_ROLE.compile({ options: {}, ruleSet: summary() })
    const input = knowledge()
    const projected = role.projectPrivateKnowledge(input)
    expect(projected).toEqual({
      day: 2,
      roleState: { checks: [{ target: 'p2', faction: 'unknown', day: 1 }] },
      resources: { antidote: 0 },
      notices: [{ toPlayerId: 'p1', kind: 'seer-inspect', data: { seen: ['p2'] } }],
    })
    expect((projected as { roleState: unknown }).roleState).not.toBe(input.self.roleState)
    expect((projected as { notices: unknown[] }).notices[0]).not.toBe(input.self.notices[0])
  })
})

describe('wolf role', () => {
  it('accepts no options and rejects unknown keys', () => {
    expect(WOLF_ROLE.parseOptions(undefined)).toEqual({})
    expect(() => WOLF_ROLE.parseOptions({ pack: 'big' })).toThrow(/unknown key/)
  })

  it('compiles with teammates knowledge and the required kill binding', () => {
    const role = WOLF_ROLE.compile({ options: {}, ruleSet: summary() })
    expect(role.faction).toBe(WEREWOLF_CLASSIC_FACTIONS.wolf)
    expect(role.publicName).toBe('Wolf')
    expect(role.seesFactionTeammates).toBe(true)
    expect(role.initialRoleState).toBeNull()
    expect(role.phaseBindings).toEqual([{
      phaseId: 'night.wolf-kill',
      phaseVersion: 1,
      required: true,
      kind: 'kill',
      options: {},
    }])
  })

  it('projects the shared knowledge plus teammates', () => {
    const role = WOLF_ROLE.compile({ options: {}, ruleSet: summary() })
    expect(role.projectPrivateKnowledge(knowledge())).toEqual({
      day: 2,
      roleState: { checks: [{ target: 'p2', faction: 'unknown', day: 1 }] },
      resources: { antidote: 0 },
      notices: [{ toPlayerId: 'p1', kind: 'seer-inspect', data: { seen: ['p2'] } }],
      teammates: [{ playerId: 'p3', seat: 3, alive: false }],
    })
  })
})

describe('seer role', () => {
  it('accepts no options and rejects unknown keys', () => {
    expect(SEER_ROLE.parseOptions(undefined)).toEqual({})
    expect(() => SEER_ROLE.parseOptions({ range: 3 })).toThrow(/unknown key/)
  })

  it('compiles with an empty check log and the required inspect binding', () => {
    const role = SEER_ROLE.compile({ options: {}, ruleSet: summary() })
    expect(role.faction).toBe(WEREWOLF_CLASSIC_FACTIONS.village)
    expect(role.publicName).toBe('Seer')
    expect(role.initialRoleState).toEqual({ checks: [] })
    expect(SEER_ROLE.compile({ options: {}, ruleSet: summary() }).initialRoleState)
      .not.toBe(role.initialRoleState)
    expect(role.phaseBindings).toEqual([{
      phaseId: 'night.seer-inspect',
      phaseVersion: 1,
      required: true,
      kind: 'inspect',
      options: {},
    }])
  })
})

describe('witch role', () => {
  it('parses defaults and full options', () => {
    expect(WITCH_ROLE.parseOptions(undefined)).toEqual({
      antidoteUses: 1,
      poisonUses: 1,
      selfSave: 'first-night-only',
    })
    expect(WITCH_ROLE.parseOptions({})).toEqual({
      antidoteUses: 1,
      poisonUses: 1,
      selfSave: 'first-night-only',
    })
    expect(WITCH_ROLE.parseOptions({ antidoteUses: 0, poisonUses: 2, selfSave: 'never' })).toEqual({
      antidoteUses: 0,
      poisonUses: 2,
      selfSave: 'never',
    })
  })

  it('rejects unknown keys and out-of-range values', () => {
    expect(() => WITCH_ROLE.parseOptions({ broom: true })).toThrow(/unknown key/)
    expect(() => WITCH_ROLE.parseOptions({ antidoteUses: 3 })).toThrow(/antidoteUses must be an integer/)
    expect(() => WITCH_ROLE.parseOptions({ poisonUses: -1 })).toThrow(/poisonUses must be an integer/)
    expect(() => WITCH_ROLE.parseOptions({ antidoteUses: 1.5 })).toThrow(/antidoteUses must be an integer/)
    expect(() => WITCH_ROLE.parseOptions({ poisonUses: '1' })).toThrow(/poisonUses must be an integer/)
    expect(() => WITCH_ROLE.parseOptions({ selfSave: 'always' })).toThrow(/selfSave/)
    expect(() => WITCH_ROLE.parseOptions('witchy')).toThrow(/must be an object/)
  })

  it('compiles resources and a mirroring role state from parsed options', () => {
    const role = WITCH_ROLE.compile({
      options: WITCH_ROLE.parseOptions({ antidoteUses: 2, poisonUses: 0, selfSave: 'never' }),
      ruleSet: summary(),
    })
    expect(role.faction).toBe(WEREWOLF_CLASSIC_FACTIONS.village)
    expect(role.publicName).toBe('Witch')
    expect(role.initialResources).toEqual({ antidote: 2, poison: 0 })
    expect(role.initialRoleState).toEqual({ antidoteUses: 2, poisonUses: 0, selfSave: 'never' })
    expect(role.phaseBindings).toEqual([{
      phaseId: 'night.witch',
      phaseVersion: 1,
      required: true,
      kind: 'act',
      options: {},
    }])
  })

  it('returns a detached compile for every game', () => {
    const first = WITCH_ROLE.compile({ options: WITCH_ROLE.parseOptions(undefined), ruleSet: summary() })
    const second = WITCH_ROLE.compile({ options: WITCH_ROLE.parseOptions(undefined), ruleSet: summary() })
    ;(first.initialResources as { antidote: number }).antidote = 99
    ;(first.initialRoleState as { poisonUses: number }).poisonUses = 99
    expect(second.initialResources).toEqual({ antidote: 1, poison: 1 })
    expect(second.initialRoleState).toEqual({ antidoteUses: 1, poisonUses: 1, selfSave: 'first-night-only' })
  })
})
