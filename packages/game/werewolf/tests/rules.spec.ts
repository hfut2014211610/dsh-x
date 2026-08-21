import { describe, expect, it } from 'vitest'
import {
  canonicalWerewolfJson,
  parseWerewolfRuleSetInput,
  resolveWerewolfRuleSet,
  WEREWOLF_MAX_LABEL_CHARS,
  werewolfRuleSetDigest,
  werewolfRuleSetSummary,
} from '../src/rules.ts'
import { WerewolfRegistry } from '../src/registry.ts'
import {
  MINI_FACTION_ELIMINATION,
  MINI_KILL,
  MINI_NEVER,
  MINI_NOOP,
  MINI_TALK,
  MINI_VILLAGER,
  MINI_VOTE,
  MINI_WOLF,
} from './fixtures.ts'
import type { WerewolfPhaseDefinition, WerewolfRoleDefinition } from '../src/types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Villager whose kill binding is optional, for the non-required-binding path. */
const OPTIONAL_KILL_ROLE: WerewolfRoleDefinition = {
  id: 'mini.optional',
  version: 1,
  parseOptions: () => ({}),
  compile: () => ({
    id: 'mini.optional',
    version: 1,
    faction: 'village',
    publicName: 'Optional',
    initialRoleState: {},
    phaseBindings: [{ phaseId: 'night.kill', phaseVersion: 1, required: false, kind: 'kill', options: { side: 'no' } }],
    projectPrivateKnowledge: () => ({}),
  }),
}

function registry(): WerewolfRegistry {
  const reg = new WerewolfRegistry()
  reg.registerRole(MINI_VILLAGER)
  reg.registerRole(MINI_WOLF)
  reg.registerRole(OPTIONAL_KILL_ROLE)
  reg.registerPhase(MINI_KILL)
  reg.registerPhase(MINI_NOOP)
  reg.registerPhase(MINI_TALK)
  reg.registerPhase(MINI_VOTE)
  reg.registerVictoryCondition(MINI_FACTION_ELIMINATION)
  reg.registerVictoryCondition(MINI_NEVER)
  return reg
}

const json = (value: unknown): JsonValue => value as JsonValue

function validInput() {
  return {
    schemaVersion: 1,
    id: 'mini',
    revision: 1,
    displayName: 'Mini',
    playerCount: 5,
    deck: [
      { role: 'mini.wolf', roleVersion: 1, count: 2 },
      { role: 'mini.villager', roleVersion: 1, count: 3 },
    ],
    cycle: {
      night: [
        { phase: 'night.kill', phaseVersion: 1 },
        { phase: 'night.noop', phaseVersion: 1 },
      ],
      day: [
        { phase: 'day.talk', phaseVersion: 1 },
        { phase: 'day.vote', phaseVersion: 1, options: { quiet: true } },
      ],
    },
    victory: [{ condition: 'mini.faction-elimination', conditionVersion: 1, priority: 10, options: { strict: false } }],
    policies: {
      voteTie: 'no-elimination',
      wolfTie: 'no-kill',
      deadHuman: 'spectate',
      maxDays: 8,
      speechMaxChars: 40,
    },
  }
}

describe('parseWerewolfRuleSetInput rejections', () => {
  const parse = (value: JsonValue): ReturnType<typeof parseWerewolfRuleSetInput> => parseWerewolfRuleSetInput(value)

  it('rejects a non-object rule set in every scalar shape', () => {
    expect(() => parse('x')).toThrow(/rule set must be an object/)
    expect(() => parse(null)).toThrow(/rule set must be an object/)
    expect(() => parse(json([1]))).toThrow(/rule set must be an object/)
  })

  it('rejects unknown keys at every nesting level', () => {
    const base = validInput()
    expect(() => parse(json({ ...base, extra: 1 }))).toThrow(/rule set has unknown key "extra"/)
    expect(() => parse(json({ ...base, cycle: { ...base.cycle, extra: 1 } })))
      .toThrow(/rule set.cycle has unknown key/)
    expect(() => parse(json({ ...base, policies: { ...base.policies, extra: 1 } })))
      .toThrow(/rule set.policies has unknown key/)
    expect(() => parse(json({ ...base, deck: [{ ...base.deck[0], extra: 1 }] })))
      .toThrow(/deck\[0\] has unknown key/)
    expect(() => parse(json({ ...base, cycle: { night: [{ phase: 'night.kill', phaseVersion: 1, extra: 1 }], day: base.cycle.day } })))
      .toThrow(/cycle.night\[0\] has unknown key/)
    expect(() => parse(json({ ...base, victory: [{ ...base.victory[0], extra: 1 }] })))
      .toThrow(/victory\[0\] has unknown key/)
  })

  it('rejects any schema version other than 1', () => {
    expect(() => parse(json({ ...validInput(), schemaVersion: 2 }))).toThrow(/schemaVersion must be 1/)
  })

  it('rejects malformed labels', () => {
    expect(() => parse(json({ ...validInput(), id: 5 }))).toThrow(/rule set.id must be a non-empty string/)
    expect(() => parse(json({ ...validInput(), id: '' }))).toThrow(/rule set.id must be a non-empty string/)
    expect(() => parse(json({ ...validInput(), displayName: '' }))).toThrow(/displayName must be a non-empty string/)
    const long = 'x'.repeat(WEREWOLF_MAX_LABEL_CHARS + 1)
    expect(() => parse(json({ ...validInput(), id: long })))
      .toThrow(new RegExp(`exceeds ${WEREWOLF_MAX_LABEL_CHARS} characters`))
  })

  it('rejects non-number, fractional, and out-of-range integers', () => {
    const base = validInput()
    expect(() => parse(json({ ...base, revision: 'one' }))).toThrow(/revision must be an integer between 1 and/)
    expect(() => parse(json({ ...base, revision: 1.5 }))).toThrow(/revision must be an integer/)
    expect(() => parse(json({ ...base, playerCount: 1 }))).toThrow(/playerCount must be an integer between 2 and 128/)
    expect(() => parse(json({ ...base, playerCount: 129 }))).toThrow(/playerCount must be an integer between 2 and 128/)
    expect(() => parse(json({ ...base, policies: { ...base.policies, maxDays: 0 } })))
      .toThrow(/maxDays must be an integer between 1 and 512/)
    expect(() => parse(json({ ...base, policies: { ...base.policies, speechMaxChars: 4097 } })))
      .toThrow(/speechMaxChars must be an integer between 1 and 4096/)
    expect(() => parse(json({
      ...base,
      deck: [{ role: 'mini.wolf', roleVersion: 0, count: 1 }, base.deck[1]],
    }))).toThrow(/roleVersion must be an integer/)
    expect(() => parse(json({
      ...base,
      deck: [{ role: 'mini.wolf', roleVersion: 1, count: 1.5 }, base.deck[1]],
    }))).toThrow(/count must be an integer/)
    expect(() => parse(json({
      ...base,
      victory: [{ condition: 'mini.never', conditionVersion: 1, priority: -1 }],
    }))).toThrow(/priority must be an integer between 0 and/)
    expect(() => parse(json({
      ...base,
      cycle: { night: [{ phase: 'night.kill', phaseVersion: 1.5 }], day: base.cycle.day },
    }))).toThrow(/phaseVersion must be an integer/)
  })

  it('rejects a missing, non-array, malformed, empty, or repeating deck', () => {
    const base = validInput()
    const withoutDeck = { ...base } as Partial<ReturnType<typeof validInput>>
    delete withoutDeck.deck
    expect(() => parse(json(withoutDeck))).toThrow(/rule set.deck must be an array/)
    expect(() => parse(json({ ...base, deck: 'x' }))).toThrow(/rule set.deck must be an array/)
    expect(() => parse(json({ ...base, deck: [42] }))).toThrow(/rule set.deck\[0\] must be an object/)
    expect(() => parse(json({ ...base, deck: [] }))).toThrow(/rule set.deck must not be empty/)
    expect(() => parse(json({
      ...base,
      deck: [
        { role: 'mini.wolf', roleVersion: 1, count: 1 },
        { role: 'mini.wolf', roleVersion: 1, count: 1 },
        base.deck[1],
      ],
    }))).toThrow(/deck repeats mini.wolf@1; merge its counts/)
    expect(() => parse(json({
      ...base,
      deck: [{ role: 'mini.wolf', roleVersion: 1, count: 2, options: undefined }, base.deck[1]],
    }))).toThrow(/deck\[0\].options must carry a JSON value when present/)
  })

  it('rejects malformed cycle containers and segments', () => {
    const base = validInput()
    expect(() => parse(json({ ...base, cycle: 'x' }))).toThrow(/rule set.cycle must be an object/)
    expect(() => parse(json({ ...base, cycle: json([1]) }))).toThrow(/rule set.cycle must be an object/)
    expect(() => parse(json({ ...base, cycle: null }))).toThrow(/rule set.cycle must be an object/)
    expect(() => parse(json({ ...base, cycle: { ...base.cycle, night: 'x' } })))
      .toThrow(/rule set.cycle.night must be an array/)
    expect(() => parse(json({ ...base, cycle: { ...base.cycle, day: [] } })))
      .toThrow(/rule set.cycle.day must not be empty/)
    expect(() => parse(json({ ...base, cycle: { ...base.cycle, night: [] } })))
      .toThrow(/rule set.cycle.night must not be empty/)
    expect(() => parse(json({ ...base, cycle: { ...base.cycle, setup: 'x' } })))
      .toThrow(/rule set.cycle.setup must be an array/)
    expect(() => parse(json({ ...base, cycle: { ...base.cycle, night: [42] } })))
      .toThrow(/rule set.cycle.night\[0\] must be an object/)
  })

  it('rejects malformed victory lists', () => {
    const base = validInput()
    const withoutVictory = { ...base } as Partial<ReturnType<typeof validInput>>
    delete withoutVictory.victory
    expect(() => parse(json(withoutVictory))).toThrow(/rule set.victory must be an array/)
    expect(() => parse(json({ ...base, victory: 'x' }))).toThrow(/rule set.victory must be an array/)
    expect(() => parse(json({ ...base, victory: [] }))).toThrow(/rule set.victory must not be empty/)
    expect(() => parse(json({ ...base, victory: [42] }))).toThrow(/rule set.victory\[0\] must be an object/)
    expect(() => parse(json({
      ...base,
      victory: [
        { condition: 'mini.never', conditionVersion: 1, priority: 3 },
        { condition: 'mini.never', conditionVersion: 1, priority: 3 },
      ],
    }))).toThrow(/victory repeats mini.never@1@3/)
  })

  it('rejects a malformed policies record and closed-union violations', () => {
    const base = validInput()
    expect(() => parse(json({ ...base, policies: 'x' }))).toThrow(/rule set.policies must be an object/)
    expect(() => parse(json({ ...base, policies: { ...base.policies, voteTie: 'coin-flip' } })))
      .toThrow(/voteTie must be one of "no-elimination" \| "revote-once" \| "seeded-random"/)
    expect(() => parse(json({ ...base, policies: { ...base.policies, wolfTie: 'both-die' } })))
      .toThrow(/wolfTie must be one of "no-kill" \| "seeded-random"/)
    expect(() => parse(json({ ...base, policies: { ...base.policies, deadHuman: 'revive' } })))
      .toThrow(/deadHuman must be one of "spectate" \| "auto-advance"/)
  })
})

describe('parseWerewolfRuleSetInput acceptance', () => {
  it('detaches the parsed input and carries entry options through', () => {
    const source = validInput()
    const parsed = parseWerewolfRuleSetInput(json(source))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.cycle).not.toHaveProperty('setup')
    const vote = parsed.cycle.day.find(entry => entry.phase === 'day.vote')
    expect(vote?.options).toEqual({ quiet: true })
    expect(parsed.victory[0]?.options).toEqual({ strict: false })
    source.policies.maxDays = 99
    expect(parsed.policies.maxDays).toBe(8)
  })

  it('omits an empty setup segment and keeps a populated one', () => {
    const base = validInput()
    const emptySetup = parseWerewolfRuleSetInput(json({ ...base, cycle: { ...base.cycle, setup: [] } }))
    expect(emptySetup.cycle).not.toHaveProperty('setup')
    const withSetup = parseWerewolfRuleSetInput(json({
      ...base,
      cycle: { ...base.cycle, setup: [{ phase: 'night.noop', phaseVersion: 1 }] },
    }))
    expect(withSetup.cycle.setup).toEqual([{ phase: 'night.noop', phaseVersion: 1 }])
  })
})

describe('resolveWerewolfRuleSet rejections', () => {
  it('rejects a deck that does not sum to playerCount', () => {
    const base = validInput()
    expect(() => resolveWerewolfRuleSet(json({
      ...base,
      deck: [
        { role: 'mini.wolf', roleVersion: 1, count: 2 },
        { role: 'mini.villager', roleVersion: 1, count: 2 },
      ],
    }), registry())).toThrow(/deck counts sum to 4, not playerCount 5/)
  })

  it('rejects an unregistered role at its exact version', () => {
    const base = validInput()
    expect(() => resolveWerewolfRuleSet(json({
      ...base,
      deck: [{ role: 'mini.wolf', roleVersion: 2, count: 5 }],
    }), registry())).toThrow(/references role mini.wolf@2 which is not registered/)
  })

  it('rejects an unregistered phase and victory condition', () => {
    const reg = registry()
    const base = validInput()
    expect(() => resolveWerewolfRuleSet(json({
      ...base,
      deck: [{ role: 'mini.villager', roleVersion: 1, count: 5 }],
      cycle: {
        ...base.cycle,
        night: [{ phase: 'night.ghost', phaseVersion: 1 }, { phase: 'night.noop', phaseVersion: 1 }],
      },
    }), reg)).toThrow(/references phase night.ghost@1 which is not registered/)
    expect(() => resolveWerewolfRuleSet(json({
      ...base,
      victory: [{ condition: 'ghost', conditionVersion: 1, priority: 1 }],
    }), reg)).toThrow(/references victory condition ghost@1 which is not registered/)
  })

  it('rejects a required role binding the cycle does not include', () => {
    const base = validInput()
    expect(() => resolveWerewolfRuleSet(json({
      ...base,
      cycle: { night: [{ phase: 'night.noop', phaseVersion: 1 }], day: base.cycle.day },
    }), registry())).toThrow(/role mini.wolf@1 requires phase night.kill@1 which the cycle does not include/)
  })

  it('rejects a non-repeatable phase occurring twice in one segment', () => {
    const base = validInput()
    expect(() => resolveWerewolfRuleSet(json({
      ...base,
      cycle: {
        night: [{ phase: 'night.kill', phaseVersion: 1 }, { phase: 'night.kill', phaseVersion: 1 }],
        day: base.cycle.day,
      },
    }), registry())).toThrow(/cycle.night repeats phase night.kill@1 which is not repeatable/)
  })
})

describe('resolveWerewolfRuleSet acceptance', () => {
  it('compiles the valid input with roles, occurrences, and victory conditions', () => {
    const compiled = resolveWerewolfRuleSet(json(validInput()), registry())
    expect(compiled.roles.size).toBe(2)
    expect(compiled.cycle.night.map(entry => entry.phaseId)).toEqual(['night.kill', 'night.noop'])
    expect(compiled.cycle.day.map(entry => entry.phaseId)).toEqual(['day.talk', 'day.vote'])
    expect(compiled.victory[0]?.definition.id).toBe('mini.faction-elimination')
    expect(compiled.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts an optional binding and a repeatable phase repeated in one segment', () => {
    const reg = registry()
    const base = validInput()
    const optional = resolveWerewolfRuleSet(json({
      ...base,
      deck: [{ role: 'mini.optional', roleVersion: 1, count: 5 }],
    }), reg)
    expect(optional.roles.has('mini.optional@1')).toBe(true)
    const repeatedVote = resolveWerewolfRuleSet(json({
      ...base,
      cycle: {
        ...base.cycle,
        day: [{ phase: 'day.vote', phaseVersion: 1 }, { phase: 'day.vote', phaseVersion: 1 }],
      },
    }), reg)
    expect(repeatedVote.cycle.day).toHaveLength(2)
  })

  it('parses phase options once and stores owner-normalized role bindings for runtime', () => {
    let optionParseCount = 0
    let compiledBinding: JsonValue | undefined
    const phase: WerewolfPhaseDefinition = {
      id: 'night.normalized',
      version: 1,
      parseOptions: () => {
        optionParseCount += 1
        return { normalizedOption: true }
      },
      parseRoleBinding: binding => ({ normalizedBinding: binding.options }),
      compile(input) {
        compiledBinding = input.participants[0]?.binding
        return {
          id: 'night.normalized',
          version: 1,
          open: () => ({ kind: 'skip', reason: 'test' }),
          resolve: () => ({
            eliminations: [], prevented: [], resourceReplacements: [], roleStateReplacements: [],
            privateNotices: [], announcements: [], votes: [], outcome: {},
          }),
        }
      },
    }
    const role: WerewolfRoleDefinition = {
      id: 'normalized-role',
      version: 1,
      parseOptions: () => ({}),
      compile: () => ({
        id: 'normalized-role',
        version: 1,
        faction: 'village',
        publicName: 'Normalized',
        initialRoleState: {},
        phaseBindings: [{
          phaseId: 'night.normalized',
          phaseVersion: 1,
          required: true,
          kind: 'normalized',
          options: { raw: true },
        }],
        projectPrivateKnowledge: () => ({}),
      }),
    }
    const reg = new WerewolfRegistry()
    reg.registerRole(role)
    reg.registerPhase(phase)
    reg.registerPhase(MINI_TALK)
    reg.registerVictoryCondition(MINI_NEVER)
    const compiled = resolveWerewolfRuleSet({
      schemaVersion: 1,
      id: 'normalized',
      revision: 1,
      displayName: 'Normalized',
      playerCount: 2,
      deck: [{ role: 'normalized-role', roleVersion: 1, count: 2 }],
      cycle: {
        night: [{ phase: 'night.normalized', phaseVersion: 1 }],
        day: [{ phase: 'day.talk', phaseVersion: 1 }],
      },
      victory: [{ condition: 'mini.never', conditionVersion: 1, priority: 1 }],
      policies: {
        voteTie: 'no-elimination', wolfTie: 'no-kill', deadHuman: 'spectate', maxDays: 1, speechMaxChars: 8,
      },
    }, reg)
    expect(optionParseCount).toBe(1)
    expect(compiledBinding).toEqual({ normalizedBinding: { raw: true } })
    expect(compiled.roles.get('normalized-role@1')?.phaseBindings[0]?.options)
      .toEqual({ normalizedBinding: { raw: true } })
  })

  it('preserves an optional binding when its phase is absent', () => {
    const input = validInput()
    const compiled = resolveWerewolfRuleSet(json({
      ...input,
      deck: [{ role: 'mini.optional', roleVersion: 1, count: 5 }],
      cycle: {
        night: [{ phase: 'night.noop', phaseVersion: 1 }],
        day: [{ phase: 'day.talk', phaseVersion: 1 }],
      },
    }), registry())
    expect(compiled.roles.get('mini.optional@1')?.phaseBindings[0]?.options).toEqual({ side: 'no' })
  })

  it('rejects compiled identity drift, duplicate bindings, and an unknown bound phase', () => {
    const input = validInput()
    const badRole: WerewolfRoleDefinition = {
      ...MINI_VILLAGER,
      id: 'bad-role',
      compile(compileInput) {
        return { ...MINI_VILLAGER.compile(compileInput), id: 'other-role' }
      },
    }
    {
      const reg = registry()
      reg.registerRole(badRole)
      expect(() => resolveWerewolfRuleSet(json({
        ...input,
        deck: [{ role: 'bad-role', roleVersion: 1, count: 5 }],
      }), reg)).toThrow(/role bad-role@1 compiled as other-role@1/)
    }
    const badPhase: WerewolfPhaseDefinition = {
      ...MINI_TALK,
      id: 'day.bad',
      compile(compileInput) {
        return { ...MINI_TALK.compile(compileInput), id: 'day.other' }
      },
    }
    {
      const reg = registry()
      reg.registerPhase(badPhase)
      expect(() => resolveWerewolfRuleSet(json({
        ...input,
        deck: [{ role: 'mini.villager', roleVersion: 1, count: 5 }],
        cycle: {
          night: [{ phase: 'night.noop', phaseVersion: 1 }],
          day: [{ phase: 'day.bad', phaseVersion: 1 }],
        },
      }), reg)).toThrow(/phase day.bad@1 compiled as day.other@1/)
    }
    const duplicateBindingRole: WerewolfRoleDefinition = {
      ...OPTIONAL_KILL_ROLE,
      id: 'duplicate-binding',
      compile: () => {
        const binding = { phaseId: 'night.kill', phaseVersion: 1, required: false, kind: 'kill', options: {} }
        return {
          id: 'duplicate-binding',
          version: 1,
          faction: 'village',
          publicName: 'Duplicate',
          initialRoleState: {},
          phaseBindings: [binding, binding],
          projectPrivateKnowledge: () => ({}),
        }
      },
    }
    {
      const reg = registry()
      reg.registerRole(duplicateBindingRole)
      expect(() => resolveWerewolfRuleSet(json({
        ...input,
        deck: [{ role: 'duplicate-binding', roleVersion: 1, count: 5 }],
      }), reg)).toThrow(/repeats phase binding night.kill@1/)
    }
    const unknownBindingRole: WerewolfRoleDefinition = {
      ...OPTIONAL_KILL_ROLE,
      id: 'unknown-binding',
      compile: () => ({
        id: 'unknown-binding',
        version: 1,
        faction: 'village',
        publicName: 'Unknown',
        initialRoleState: {},
        phaseBindings: [{ phaseId: 'night.missing', phaseVersion: 1, required: true, kind: 'act', options: {} }],
        projectPrivateKnowledge: () => ({}),
      }),
    }
    {
      const reg = registry()
      reg.registerRole(unknownBindingRole)
      expect(() => resolveWerewolfRuleSet(json({
        ...input,
        deck: [{ role: 'unknown-binding', roleVersion: 1, count: 5 }],
        cycle: {
          night: [{ phase: 'night.missing', phaseVersion: 1 }],
          day: [{ phase: 'day.talk', phaseVersion: 1 }],
        },
      }), reg)).toThrow(/phase night.missing@1 which is not registered/)
    }
  })
})

describe('canonicalWerewolfJson', () => {
  it('serializes primitives and empty containers', () => {
    expect(canonicalWerewolfJson(null)).toBe('null')
    expect(canonicalWerewolfJson(true)).toBe('true')
    expect(canonicalWerewolfJson(1)).toBe('1')
    expect(canonicalWerewolfJson('s')).toBe('"s"')
    expect(canonicalWerewolfJson([])).toBe('[]')
    expect(canonicalWerewolfJson({})).toBe('{}')
  })

  it('sorts object keys recursively inside arrays', () => {
    expect(canonicalWerewolfJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}')
  })

  it('gives equal values with different key orders one serialization', () => {
    const first = { z: 1, a: { y: [1, { b: 2, a: 1 }] } }
    const second = { a: { y: [1, { a: 1, b: 2 }] }, z: 1 }
    expect(canonicalWerewolfJson(json(first))).toBe(canonicalWerewolfJson(json(second)))
  })
})

describe('werewolfRuleSetDigest and werewolfRuleSetSummary', () => {
  it('derives one stable digest from key-order-independent inputs', () => {
    const base = validInput()
    const parsed = parseWerewolfRuleSetInput(json(base))
    const reordered = parseWerewolfRuleSetInput(json({
      policies: {
        speechMaxChars: 40,
        wolfTie: 'no-kill',
        maxDays: 8,
        deadHuman: 'spectate',
        voteTie: 'no-elimination',
      },
      victory: [{ priority: 10, options: { strict: false }, conditionVersion: 1, condition: 'mini.faction-elimination' }],
      deck: [
        { count: 2, roleVersion: 1, role: 'mini.wolf' },
        { roleVersion: 1, count: 3, role: 'mini.villager' },
      ],
      cycle: {
        night: [{ phaseVersion: 1, phase: 'night.kill' }, { phase: 'night.noop', phaseVersion: 1 }],
        day: [
          { phaseVersion: 1, phase: 'day.talk' },
          { options: { quiet: true }, phaseVersion: 1, phase: 'day.vote' },
        ],
      },
      displayName: 'Mini',
      playerCount: 5,
      id: 'mini',
      revision: 1,
      schemaVersion: 1,
    }))
    expect(werewolfRuleSetDigest(reordered)).toBe(werewolfRuleSetDigest(parsed))
    expect(werewolfRuleSetDigest({ ...parsed, revision: 2 })).not.toBe(werewolfRuleSetDigest(parsed))
  })

  it('projects the summary role compilation receives', () => {
    const parsed = parseWerewolfRuleSetInput(json(validInput()))
    expect(werewolfRuleSetSummary(parsed)).toEqual({
      id: 'mini',
      revision: 1,
      displayName: 'Mini',
      playerCount: 5,
      policies: parsed.policies,
      deck: parsed.deck,
    })
  })
})
