import { describe, expect, it } from 'vitest'
import type { WerewolfVictoryEvaluationInputV1 } from '@deepseek-ai/dsh-werewolf'
import { WerewolfPlayerId } from '@deepseek-ai/dsh-werewolf'
import { FACTION_ELIMINATION_VICTORY, WOLF_PARITY_VICTORY } from '../src/victory.ts'

function roster(entries: Array<[seat: string, faction: string, alive: boolean]>): WerewolfVictoryEvaluationInputV1['players'] {
  return entries.map(([id, faction, alive]) => ({ playerId: WerewolfPlayerId(id), faction, alive }))
}

function evaluateFaction(players: WerewolfVictoryEvaluationInputV1['players']) {
  return FACTION_ELIMINATION_VICTORY.evaluate({ day: 2, players, options: {} })
}

describe('faction-elimination victory', () => {
  it('parses no options and rejects unknown keys', () => {
    expect(FACTION_ELIMINATION_VICTORY.parseOptions(undefined)).toEqual({})
    expect(() => FACTION_ELIMINATION_VICTORY.parseOptions({ mercy: true })).toThrow(/unknown key/)
  })

  it('claims the last faction standing with the living players as evidence', () => {
    const claim = evaluateFaction(roster([
      ['p1', 'village', true],
      ['p2', 'village', true],
      ['p3', 'wolf', false],
    ]))
    expect(claim).toEqual({
      outcome: { kind: 'faction', factionId: 'village' },
      evidence: { alive: [WerewolfPlayerId('p1'), WerewolfPlayerId('p2')] },
    })
  })

  it('claims a wolf win when only wolves remain', () => {
    const claim = evaluateFaction(roster([
      ['p1', 'wolf', true],
      ['p2', 'village', false],
    ]))
    expect(claim?.outcome).toEqual({ kind: 'faction', factionId: 'wolf' })
  })

  it('claims nothing while two factions live or nobody lives', () => {
    expect(evaluateFaction(roster([
      ['p1', 'village', true],
      ['p2', 'wolf', true],
    ]))).toBeNull()
    expect(evaluateFaction(roster([
      ['p1', 'village', false],
      ['p2', 'wolf', false],
    ]))).toBeNull()
  })
})

describe('wolf-parity victory', () => {
  it('parses the wolf faction with a default and rejects bad values', () => {
    expect(WOLF_PARITY_VICTORY.parseOptions(undefined)).toEqual({ wolfFaction: 'wolf' })
    expect(WOLF_PARITY_VICTORY.parseOptions({})).toEqual({ wolfFaction: 'wolf' })
    expect(WOLF_PARITY_VICTORY.parseOptions({ wolfFaction: 'shadow' })).toEqual({ wolfFaction: 'shadow' })
    expect(() => WOLF_PARITY_VICTORY.parseOptions({ pack: 'a' })).toThrow(/unknown key/)
    expect(() => WOLF_PARITY_VICTORY.parseOptions({ wolfFaction: '' })).toThrow(/wolfFaction/)
    expect(() => WOLF_PARITY_VICTORY.parseOptions({ wolfFaction: 7 })).toThrow(/wolfFaction/)
  })

  it('claims the wolf faction at parity and above', () => {
    const parity = WOLF_PARITY_VICTORY.evaluate({
      day: 3,
      players: roster([
        ['p1', 'wolf', true],
        ['p2', 'village', true],
        ['p3', 'village', false],
      ]),
      options: WOLF_PARITY_VICTORY.parseOptions(undefined),
    })
    expect(parity).toEqual({
      outcome: { kind: 'faction', factionId: 'wolf' },
      evidence: { wolves: [WerewolfPlayerId('p1')], others: [WerewolfPlayerId('p2')] },
    })

    const above = WOLF_PARITY_VICTORY.evaluate({
      day: 3,
      players: roster([
        ['p1', 'wolf', true],
        ['p2', 'wolf', true],
        ['p3', 'village', true],
        ['p4', 'village', true],
        ['p5', 'village', false],
      ]),
      options: WOLF_PARITY_VICTORY.parseOptions(undefined),
    })
    expect(above?.outcome).toEqual({ kind: 'faction', factionId: 'wolf' })
    expect(above?.evidence).toEqual({
      wolves: [WerewolfPlayerId('p1'), WerewolfPlayerId('p2')],
      others: [WerewolfPlayerId('p3'), WerewolfPlayerId('p4')],
    })
  })

  it('claims nothing without living wolves or below parity', () => {
    const noWolves = WOLF_PARITY_VICTORY.evaluate({
      day: 3,
      players: roster([
        ['p1', 'wolf', false],
        ['p2', 'village', true],
      ]),
      options: WOLF_PARITY_VICTORY.parseOptions(undefined),
    })
    expect(noWolves).toBeNull()

    const belowParity = WOLF_PARITY_VICTORY.evaluate({
      day: 3,
      players: roster([
        ['p1', 'wolf', true],
        ['p2', 'wolf', true],
        ['p3', 'village', true],
        ['p4', 'village', true],
        ['p5', 'village', true],
      ]),
      options: WOLF_PARITY_VICTORY.parseOptions(undefined),
    })
    expect(belowParity).toBeNull()
  })

  it('honors a configured wolf faction id', () => {
    const claim = WOLF_PARITY_VICTORY.evaluate({
      day: 3,
      players: roster([
        ['p1', 'shadow', true],
        ['p2', 'village', true],
      ]),
      options: WOLF_PARITY_VICTORY.parseOptions({ wolfFaction: 'shadow' }),
    })
    expect(claim).toEqual({
      outcome: { kind: 'faction', factionId: 'shadow' },
      evidence: { wolves: [WerewolfPlayerId('p1')], others: [WerewolfPlayerId('p2')] },
    })
  })
})
