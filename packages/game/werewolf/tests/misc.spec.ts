import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  WerewolfDecisionId,
  WerewolfGameId,
  WerewolfHumanActionId,
  WerewolfPhaseInstanceId,
  WerewolfPlayerId,
} from '../src/brand.ts'
import { definitionKey, WerewolfRegistry } from '../src/registry.ts'
import WerewolfRuntime from '../src/runtime.ts'
import { parseWerewolfRuleSetInput, resolveWerewolfRuleSet } from '../src/rules.ts'
import {
  applyWerewolfBotContextDelta,
  BOT_PROFILE_CATALOG,
  initialWerewolfBotContext,
  validateWerewolfBotContextDelta,
} from '../src/bot-context.ts'
import {
  buildWerewolfBotRequests,
  collectWerewolfResolveSubmissions,
  commitWerewolfBotDecisions,
  defaultWerewolfEngineIds,
  driveWerewolfGame,
  openNextWerewolfPhase,
  resolveOpenWerewolfPhase,
  startWerewolfGame,
  submitWerewolfHumanAction,
  validateWerewolfAction,
} from '../src/engine.ts'
import { applyWerewolfEvent } from '../src/reducer.ts'
import type { WerewolfEvent } from '../src/events.ts'
import type {
  WerewolfBotContextV1,
  WerewolfCompiledRuleSetV1,
  WerewolfContextLimitsV1,
  WerewolfPhaseDefinition,
  WerewolfRuleSetInputV1,
  WerewolfVictoryConditionDefinition,
} from '../src/types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  counterIds,
  EMPTY_DELTA,
  MINI_FACTION_ELIMINATION,
  MINI_KILL,
  MINI_NEVER,
  MINI_NOOP,
  MINI_TALK,
  MINI_VILLAGER,
  MINI_VOTE,
  MINI_WOLF,
  testLimits,
} from './fixtures.ts'

describe('brand id factories', () => {
  it('return the input string unchanged for every branded id', () => {
    expect(WerewolfGameId('g')).toBe('g')
    expect(WerewolfPlayerId('p')).toBe('p')
    expect(WerewolfPhaseInstanceId('i')).toBe('i')
    expect(WerewolfDecisionId('d')).toBe('d')
    expect(WerewolfHumanActionId('h')).toBe('h')
  })
})

describe('WerewolfRegistry', () => {
  const parsedRuleSet = (): WerewolfRuleSetInputV1 => parseWerewolfRuleSetInput({
    schemaVersion: 1,
    id: 'misc',
    revision: 1,
    displayName: 'Misc',
    playerCount: 2,
    deck: [{ role: 'a', roleVersion: 1, count: 2 }],
    cycle: {
      night: [{ phase: 'n', phaseVersion: 1 }],
      day: [{ phase: 'd', phaseVersion: 1 }],
    },
    victory: [{ condition: 'v', conditionVersion: 1, priority: 0 }],
    policies: { voteTie: 'no-elimination', wolfTie: 'no-kill', deadHuman: 'spectate', maxDays: 1, speechMaxChars: 8 },
  })

  it('keys every registry by id and version', () => {
    const reg = new WerewolfRegistry()
    reg.registerRole(MINI_VILLAGER)
    reg.registerPhase(MINI_NOOP)
    reg.registerVictoryCondition(MINI_NEVER)
    reg.registerRuleSet(parsedRuleSet())
    expect(reg.getRole('mini.villager', 1)).toBe(MINI_VILLAGER)
    expect(reg.getPhase('night.noop', 1)).toBe(MINI_NOOP)
    expect(reg.getVictoryCondition('mini.never', 1)).toBe(MINI_NEVER)
    expect(reg.getRuleSet('misc', 1)?.id).toBe('misc')
    expect(reg.getRole('mini.villager', 2)).toBeUndefined()
    expect(reg.getPhase('night.noop', 2)).toBeUndefined()
    expect(reg.getVictoryCondition('ghost', 1)).toBeUndefined()
    expect(reg.getRuleSet('misc', 2)).toBeUndefined()
    expect([...reg.listRoles().keys()]).toEqual([definitionKey('mini.villager', 1)])
    expect([...reg.listPhases().keys()]).toEqual([definitionKey('night.noop', 1)])
    expect([...reg.listVictoryConditions().keys()]).toEqual([definitionKey('mini.never', 1)])
    expect([...reg.listRuleSets().keys()]).toEqual([definitionKey('misc', 1)])
  })

  it('rejects a duplicate id at the same version in every registry', () => {
    const reg = new WerewolfRegistry()
    reg.registerRole(MINI_VILLAGER)
    expect(() => reg.registerRole(MINI_VILLAGER)).toThrow(/werewolf role mini.villager@1 is already registered/)
    reg.registerPhase(MINI_NOOP)
    expect(() => reg.registerPhase(MINI_NOOP)).toThrow(/already registered/)
    reg.registerVictoryCondition(MINI_NEVER)
    expect(() => reg.registerVictoryCondition(MINI_NEVER)).toThrow(/already registered/)
    const input = parsedRuleSet()
    reg.registerRuleSet(input)
    expect(() => reg.registerRuleSet(input)).toThrow(/already registered/)
  })

  it('disposers remove exactly their registration and stay inert once replaced', () => {
    const reg = new WerewolfRegistry()
    const dispose = reg.registerRole(MINI_VILLAGER)
    expect(reg.getRole('mini.villager', 1)).toBeDefined()
    dispose()
    expect(reg.getRole('mini.villager', 1)).toBeUndefined()
    const replace = reg.registerRole({ ...MINI_VILLAGER })
    dispose()
    expect(reg.getRole('mini.villager', 1)).toBeDefined()
    replace()
    expect(reg.getRole('mini.villager', 1)).toBeUndefined()
    expect(reg.listRoles().size).toBe(0)
  })
})

describe('WerewolfRuntime service', () => {
  it('removes exactly one registration per returned disposer', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime)
    const raw: JsonValue = {
      schemaVersion: 1,
      id: 'misc',
      revision: 1,
      displayName: 'Misc',
      playerCount: 2,
      deck: [{ role: 'a', roleVersion: 1, count: 2 }],
      cycle: {
        night: [{ phase: 'n', phaseVersion: 1 }],
        day: [{ phase: 'd', phaseVersion: 1 }],
      },
      victory: [{ condition: 'v', conditionVersion: 1, priority: 0 }],
      policies: { voteTie: 'no-elimination', wolfTie: 'no-kill', deadHuman: 'spectate', maxDays: 1, speechMaxChars: 8 },
    }
    const disposers = [
      ctx.werewolf.registerRole(MINI_VILLAGER),
      ctx.werewolf.registerPhase(MINI_NOOP),
      ctx.werewolf.registerVictoryCondition(MINI_NEVER),
      ctx.werewolf.registerRuleSet(parseWerewolfRuleSetInput(raw)),
    ]
    expect(ctx.werewolf.listRuleSets().has('misc@1')).toBe(true)
    for (const dispose of disposers) dispose()
    expect(ctx.werewolf.listRuleSets().size).toBe(0)
    expect(() => ctx.werewolf.resolveRuleSet(raw)).toThrow(/references role a@1 which is not registered/)
  })

  it('fails loud on duplicate registrations through the service', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime)
    ctx.werewolf.registerRole(MINI_VILLAGER)
    expect(() => ctx.werewolf.registerRole(MINI_VILLAGER)).toThrow(/already registered/)
  })
})

describe('bot-context boundary cases', () => {
  const P = [WerewolfPlayerId('p1'), WerewolfPlayerId('p2'), WerewolfPlayerId('p3')]
  const gameId = WerewolfGameId('g1')
  const limits = (): WerewolfContextLimitsV1 => ({
    memorySummaryChars: 8,
    beliefBasisChars: 8,
    commitmentChars: 8,
    strategyChars: 8,
    maxCommitments: 2,
  })
  const context = (): WerewolfBotContextV1 =>
    initialWerewolfBotContext(gameId, P[0] as WerewolfPlayerId, BOT_PROFILE_CATALOG[0] as never, P)

  it('rejects a belief update whose player id is not a string', () => {
    expect(() => validateWerewolfBotContextDelta(
      { beliefUpdates: [{ playerId: 5, tendency: 'wolf', confidence: 'low', basis: 'x' }] },
      context(),
      P,
      limits(),
    )).toThrow(/beliefUpdates\[0\].playerId must be a string/)
  })

  it('rejects non-object settle entries and unknown settle keys', () => {
    expect(() => validateWerewolfBotContextDelta({ settleCommitments: ['x'] }, context(), P, limits()))
      .toThrow(/settleCommitments\[0\] must be an object/)
    expect(() => validateWerewolfBotContextDelta(
      { settleCommitments: [{ id: 'a', status: 'fulfilled', bogus: 1 }] },
      context(),
      P,
      limits(),
    )).toThrow(/settleCommitments\[0\] has unknown key "bogus"/)
  })

  it('accepts a strategy without an intended claim', () => {
    const delta = validateWerewolfBotContextDelta(
      { strategy: { objective: 'o', priorityTargets: [] } },
      context(),
      P,
      limits(),
    )
    expect(delta.strategy).not.toHaveProperty('intendedClaim')
  })

  it('appends beliefs for players the checkpoint does not know yet', () => {
    const next = applyWerewolfBotContextDelta(context(), {
      beliefUpdates: [{ playerId: WerewolfPlayerId('p-new'), tendency: 'wolf', confidence: 'low', basis: 'x' }],
    }, { decisionId: WerewolfDecisionId('d1'), phaseId: 'p', actionKind: 'a' })
    expect(next.beliefs.map(belief => belief.playerId)).toEqual([P[1], P[2], WerewolfPlayerId('p-new')])
  })
})

/** Setup segment member that always skips. */
const SETUP_NOOP: WerewolfPhaseDefinition = {
  id: 'setup.noop',
  version: 1,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'setup.noop',
    version: 1,
    open: () => ({ kind: 'skip', reason: 'setup complete' }),
    resolve: () => ({
      eliminations: [], prevented: [], resourceReplacements: [], roleStateReplacements: [],
      privateNotices: [], announcements: [], votes: [], outcome: {},
    }),
  }),
}

/** Night phase that draws from the shared seeded stream before skipping. */
const RNG_NIGHT: WerewolfPhaseDefinition = {
  id: 'night.rng',
  version: 1,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'night.rng',
    version: 1,
    open: (input) => {
      input.rng.pick(['heads', 'tails'])
      return { kind: 'skip', reason: 'coin tossed' }
    },
    resolve: () => ({
      eliminations: [], prevented: [], resourceReplacements: [], roleStateReplacements: [],
      privateNotices: [], announcements: [], votes: [], outcome: {},
    }),
  }),
}

/** Repeatable day vote whose revote occurrence skips, so the engine falls back to no elimination. */
const REVOTE_SKIP: WerewolfPhaseDefinition = {
  id: 'day.revote-skip',
  version: 1,
  repeatable: true,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'day.revote-skip',
    version: 1,
    open: (input) => {
      if (input.occurrence > 0) return { kind: 'skip', reason: 'revote declined' }
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private' as const,
          actors: input.players.filter(player => player.alive).map(player => ({
            playerId: player.playerId,
            seat: player.seat,
            actionKind: 'vote',
            spec: { kind: 'text' as const, maxChars: input.policies.speechMaxChars, allowSkip: true },
          })),
        },
      }
    },
    resolve: input => ({
      eliminations: [],
      prevented: [],
      resourceReplacements: [],
      roleStateReplacements: [],
      privateNotices: [],
      announcements: [],
      votes: [],
      voteOutcome: {
        eliminated: null,
        tiedPlayers: input.players.filter(player => player.alive).slice(0, 2).map(player => player.playerId),
      },
      outcome: {},
    }),
  }),
}

/** Claims a tie outcome unconditionally. */
const TIE_CLAIM: WerewolfVictoryConditionDefinition = {
  id: 'misc.tie-claim',
  version: 1,
  parseOptions: () => ({}),
  evaluate: () => ({ outcome: { kind: 'tie' }, evidence: { why: 'fixture' } }),
}

/** Day speech whose actors carry phase-authored action context. */
const CONTEXTUAL_TALK: WerewolfPhaseDefinition = {
  id: 'day.context-talk',
  version: 1,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'day.context-talk',
    version: 1,
    open: input => ({
      kind: 'plan',
      plan: {
        mode: 'seat-order-public' as const,
        actors: input.players.filter(player => player.alive).map(player => ({
          playerId: player.playerId,
          seat: player.seat,
          actionKind: 'speech',
          spec: { kind: 'text' as const, maxChars: input.policies.speechMaxChars, allowSkip: true },
          context: { hint: 'phase fact' },
        })),
      },
    }),
    resolve: () => ({
      eliminations: [], prevented: [], resourceReplacements: [], roleStateReplacements: [],
      privateNotices: [], announcements: [], votes: [], outcome: {},
    }),
  }),
}

interface MiscVariant {
  cycle: { setup?: string[]; night: string[]; day: string[] }
  deck?: ReadonlyArray<{ role: string; count: number }>
  victory?: string
  voteTie?: 'no-elimination' | 'revote-once' | 'seeded-random'
  maxDays?: number
  speechMaxChars?: number
}

/** Compile a rule set over the mini vocabulary plus the local phases above. */
function compileMisc(variant: MiscVariant): WerewolfCompiledRuleSetV1 {
  const reg = new WerewolfRegistry()
  reg.registerRole(MINI_VILLAGER)
  reg.registerRole(MINI_WOLF)
  reg.registerPhase(MINI_KILL)
  reg.registerPhase(MINI_NOOP)
  reg.registerPhase(MINI_TALK)
  reg.registerPhase(MINI_VOTE)
  reg.registerPhase(SETUP_NOOP)
  reg.registerPhase(RNG_NIGHT)
  reg.registerPhase(REVOTE_SKIP)
  reg.registerPhase(CONTEXTUAL_TALK)
  reg.registerVictoryCondition(MINI_FACTION_ELIMINATION)
  reg.registerVictoryCondition(MINI_NEVER)
  reg.registerVictoryCondition(TIE_CLAIM)
  const deck = variant.deck ?? [{ role: 'mini.villager', count: 5 }]
  const seg = (names: readonly string[]): Array<{ phase: string; phaseVersion: number }> =>
    names.map(phase => ({ phase, phaseVersion: 1 }))
  return resolveWerewolfRuleSet({
    schemaVersion: 1,
    id: 'misc',
    revision: 1,
    displayName: 'Misc',
    playerCount: deck.reduce((sum, entry) => sum + entry.count, 0),
    deck: deck.map(entry => ({ role: entry.role, roleVersion: 1, count: entry.count })),
    cycle: {
      ...(variant.cycle.setup === undefined ? {} : { setup: seg(variant.cycle.setup) }),
      night: seg(variant.cycle.night),
      day: seg(variant.cycle.day),
    },
    victory: [{ condition: variant.victory ?? 'mini.never', conditionVersion: 1, priority: 10 }],
    policies: {
      voteTie: variant.voteTie ?? 'no-elimination',
      wolfTie: 'no-kill',
      deadHuman: 'spectate',
      maxDays: variant.maxDays ?? 8,
      speechMaxChars: variant.speechMaxChars ?? 40,
    },
  }, reg)
}

describe('engine default plumbing', () => {
  it('mints default UUID ids for phase instances and human actions', () => {
    const defaults = defaultWerewolfEngineIds()
    expect(defaults.phaseInstance().length).toBeGreaterThan(10)
    expect(defaults.humanAction().length).toBeGreaterThan(10)
  })

  it('drives without injected ids', () => {
    const rules = miniRuleSetNever()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 4, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, {
      bot: _request => ({ action: { value: null }, contextDelta: EMPTY_DELTA }),
      limits: testLimits(),
    })
    expect(driven.stop).toMatchObject({ kind: 'awaiting-human' })
  })
})

function miniRuleSetNever(): WerewolfCompiledRuleSetV1 {
  const reg = new WerewolfRegistry()
  reg.registerRole(MINI_VILLAGER)
  reg.registerRole(MINI_WOLF)
  reg.registerPhase(MINI_KILL)
  reg.registerPhase(MINI_NOOP)
  reg.registerPhase(MINI_TALK)
  reg.registerPhase(MINI_VOTE)
  reg.registerVictoryCondition(MINI_NEVER)
  return resolveWerewolfRuleSet({
    schemaVersion: 1,
    id: 'never',
    revision: 1,
    displayName: 'Never',
    playerCount: 5,
    deck: [{ role: 'mini.villager', roleVersion: 1, count: 5 }],
    cycle: {
      night: [{ phase: 'night.noop', phaseVersion: 1 }],
      day: [
        { phase: 'day.talk', phaseVersion: 1 },
        { phase: 'day.vote', phaseVersion: 1 },
      ],
    },
    victory: [{ condition: 'mini.never', conditionVersion: 1, priority: 10 }],
    policies: { voteTie: 'no-elimination', wolfTie: 'no-kill', deadHuman: 'spectate', maxDays: 1, speechMaxChars: 40 },
  }, reg)
}

describe('engine custom cycles', () => {
  it('walks a setup segment into night and records its definition version', () => {
    const rules = compileMisc({ cycle: { setup: ['setup.noop'], night: ['night.noop'], day: ['day.talk'] }, maxDays: 1 })
    const { state, events } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    expect(state.segment).toBe('setup')
    expect((events[0] as WerewolfEvent<'werewolf/game-started'>).data.definitionVersions.phases).toContainEqual({ id: 'setup.noop', version: 1 })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    const openedPhases = opened.events
      .filter(event => event.type === 'werewolf/phase-opened')
      .map(event => event.data.phaseId)
    expect(openedPhases).toEqual(['setup.noop', 'night.noop', 'day.talk'])
    expect(opened.state.openPhase?.phaseId).toBe('day.talk')
  })

  it('hands definitions a seeded rng whose draws advance the recorded state', () => {
    const rules = compileMisc({ cycle: { night: ['night.rng'], day: ['day.talk'] }, maxDays: 1 })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 5, ids: counterIds() })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    const coin = opened.events.find(event => event.type === 'werewolf/phase-opened' && event.data.phaseId === 'night.rng') as WerewolfEvent<'werewolf/phase-opened'> | undefined
    expect(coin?.data.outcome).toBe('skipped')
    expect(coin?.data.skipReason).toBe('coin tossed')
    expect(coin?.data.rngState).not.toBe(state.rngState)
  })

  it('ends the game with a tie outcome when a condition claims one', () => {
    const rules = compileMisc({ cycle: { night: ['night.noop'], day: ['day.talk'] }, victory: 'misc.tie-claim' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 2, ids: counterIds() })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    expect(opened.state.status).toBe('ended')
    expect(opened.state.result?.outcome).toEqual({ kind: 'tie' })
    expect(opened.state.result?.evidence[0]).toMatchObject({ source: 'condition', conditionId: 'misc.tie-claim' })
  })

  it('falls back to no elimination when the revote re-open is skipped', () => {
    const rules = compileMisc({ cycle: { night: ['night.noop'], day: ['day.revote-skip'] }, voteTie: 'revote-once', maxDays: 1 })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 1, ids: counterIds() })
    const driven = driveWerewolfGame(state, rules, {
      bot: _request => ({ action: { value: 'words' }, contextDelta: EMPTY_DELTA }),
      human: () => ({ value: 'my words' }),
      limits: testLimits(),
      ids: counterIds(),
    })
    expect(driven.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'tie' } } })
    const resolved = driven.events.filter(event => event.type === 'werewolf/phase-resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.data.resolution.announcements.some(entry => entry.key === 'vote.no-elimination')).toBe(true)
    const revoteOpens = driven.events
      .filter(event => event.type === 'werewolf/phase-opened' && event.data.phaseId === 'day.revote-skip')
    expect(revoteOpens).toHaveLength(1)
  })
})

describe('engine guard and collection paths', () => {
  it('passes phase-authored actor context through to the human request', () => {
    const rules = compileMisc({ cycle: { night: ['night.noop'], day: ['day.context-talk'] }, maxDays: 1 })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 6, humanSeatPreference: 1, ids: counterIds() })
    let seenContext: JsonValue | undefined
    const driven = driveWerewolfGame(state, rules, {
      bot: _request => ({ action: { value: 'words' }, contextDelta: EMPTY_DELTA }),
      human: (request) => {
        seenContext = request.context
        return { value: 'hi' }
      },
      limits: testLimits(),
      ids: counterIds(),
    })
    expect(seenContext).toEqual({ hint: 'phase fact' })
    expect(driven.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'tie' } } })
  })

  it('validates text and compound action shapes at their edges', () => {
    const lax = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'speech',
      spec: { kind: 'text' as const, maxChars: 8, allowSkip: true },
    }
    expect(validateWerewolfAction(lax, { value: 42 })).toMatch(/text value must be a string/)
    expect(validateWerewolfAction(lax, { value: '   ' })).toBeUndefined()
    const strict = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'speech',
      spec: { kind: 'text' as const, maxChars: 8, allowSkip: false },
    }
    expect(validateWerewolfAction(strict, { value: '  ' })).toMatch(/text value is empty/)
    const compound = {
      playerId: WerewolfPlayerId('p1'),
      seat: 1,
      actionKind: 'witch',
      spec: {
        kind: 'compound' as const,
        allowSkip: false,
        fields: [
          { id: 'note', spec: { kind: 'text' as const, maxChars: 8, allowSkip: true } },
        ],
      },
    }
    expect(validateWerewolfAction(compound, { note: '' })).toBeUndefined()
  })

  it('treats a null segment as night whether or not the cursor was consumed', () => {
    const rules = miniRuleSetNever()
    const base = startWerewolfGame({ ruleSet: rules, seed: 8, ids: counterIds() }).state
    const unconsumed = openNextWerewolfPhase({ ...base, segment: null }, rules, counterIds())
    expect(unconsumed.state.openPhase?.phaseId).toBe('day.talk')
    const consumed = openNextWerewolfPhase({ ...base, segment: null, positionConsumed: true }, rules, counterIds())
    expect(consumed.state.openPhase?.phaseId).toBe('day.talk')
  })

  it('rejects a human action when no phase is open', () => {
    const rules = miniRuleSetNever()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    expect(() => submitWerewolfHumanAction(state, { value: null })).toThrow(/no phase is open/)
  })

  it('rejects an illegal human action and commits a legal one with default ids', () => {
    const rules = wolfHumanRules()
    const started = startWerewolfGame({ ruleSet: rules, seed: wolfHumanSeed(), ids: counterIds() })
    const opened = openNextWerewolfPhase(started.state, rules, counterIds())
    const phase = opened.state.openPhase
    expect(phase?.phaseId).toBe('night.kill')
    expect(() => submitWerewolfHumanAction(opened.state, { value: WerewolfPlayerId('not-a-player') }))
      .toThrow(/illegal human action/)
    const actor = phase?.plan.actors.find(entry => entry.playerId === opened.state.humanPlayerId)
    const target = actor !== undefined && actor.spec.kind === 'player-target' ? actor.spec.targets[0] ?? null : null
    const committed = submitWerewolfHumanAction(opened.state, { value: target })
    expect(committed.state.openPhase?.settled).toHaveLength(1)
  })

  it('rejects a bot request when the actor carries no bot context', () => {
    const rules = wolfHumanRules()
    const started = startWerewolfGame({ ruleSet: rules, seed: wolfHumanSeed(), ids: counterIds() })
    const opened = openNextWerewolfPhase(started.state, rules, counterIds())
    expect(() => buildWerewolfBotRequests({ ...opened.state, contexts: {} })).toThrow(/has no bot context/)
  })

  it('returns no bot requests when only the human still owes a public action', () => {
    const rules = compileMisc({ cycle: { night: ['night.noop'], day: ['day.talk'] }, maxDays: 2 })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 6, humanSeatPreference: 5, ids: counterIds() })
    const ids = counterIds()
    let current = openNextWerewolfPhase(state, rules, ids).state
    expect(current.openPhase?.phaseId).toBe('day.talk')
    for (let round = 0; round < 4; round += 1) {
      const pending = buildWerewolfBotRequests(current, ids)
      expect(pending).toHaveLength(1)
      current = commitWerewolfBotDecisions(current, pending.map(request => ({
        request,
        envelope: { action: { value: 'words' }, contextDelta: EMPTY_DELTA },
      })), testLimits()).state
    }
    expect(buildWerewolfBotRequests(current, ids)).toEqual([])
  })

  it('bounds public speeches by the policy and derives collected speeches from text actions', () => {
    const rules = compileMisc({ cycle: { night: ['night.noop'], day: ['day.talk'] }, maxDays: 2, speechMaxChars: 12 })
    const started = startWerewolfGame({ ruleSet: rules, seed: 6, humanSeatPreference: 2, ids: counterIds() })
    const ids = counterIds()
    const opened = openNextWerewolfPhase(started.state, rules, ids)
    const openPhase = opened.state.openPhase
    expect(openPhase?.plan.mode).toBe('seat-order-public')
    const requests = buildWerewolfBotRequests(opened.state, ids)
    expect(requests).toHaveLength(1)
    const request = requests[0]
    if (request === undefined || openPhase === null) throw new Error('fixture produced no pending bot')
    expect(() => commitWerewolfBotDecisions(opened.state, [{
      request,
      envelope: { action: { value: 'ok' }, publicSpeech: 'this speech is too long', contextDelta: EMPTY_DELTA },
    }], testLimits())).toThrow(/publicSpeech exceeds the speechMaxChars policy/)
    const committed = commitWerewolfBotDecisions(opened.state, [{
      request,
      envelope: { action: { value: '  real  words ' }, contextDelta: EMPTY_DELTA },
    }], testLimits())
    const entry = committed.events[0]?.type === 'werewolf/bot-decision' ? committed.events[0].data.entries[0] : undefined
    expect(entry?.publicSpeech).toBeUndefined()
    const submissions = collectWerewolfResolveSubmissions(
      [...started.events, ...opened.events, ...committed.events],
      openPhase,
    )
    expect(submissions[0]?.publicSpeech).toBe('real words')
    expect(collectWerewolfResolveSubmissions([], openPhase)).toEqual([])
  })

  it('resolves a settled phase when submissions carry null actions', () => {
    const rules = compileMisc({ cycle: { night: ['night.noop'], day: ['day.revote-skip'] }, voteTie: 'no-elimination', maxDays: 2 })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 7, ids: counterIds() })
    const ids = counterIds()
    const opened = openNextWerewolfPhase(state, rules, ids)
    expect(opened.state.openPhase?.phaseId).toBe('day.revote-skip')
    const actors = opened.state.openPhase?.plan.actors ?? []
    const humanDone = submitWerewolfHumanAction(opened.state, { value: 'my words' }, ids).state
    const pending = buildWerewolfBotRequests(humanDone, ids)
    const committed = commitWerewolfBotDecisions(humanDone, pending.map(request => ({
      request,
      envelope: { action: { value: 'words' }, contextDelta: EMPTY_DELTA },
    })), testLimits())
    const resolved = resolveOpenWerewolfPhase(committed.state, rules, actors.map(actor => ({ playerId: actor.playerId, action: null })))
    expect(resolved.events[0]?.type).toBe('werewolf/phase-resolved')
    expect(resolved.state.openPhase).toBeNull()
  })
})

/** Standard mini rule set used by the guard tests. */
function miniRules(): WerewolfCompiledRuleSetV1 {
  const reg = new WerewolfRegistry()
  reg.registerRole(MINI_VILLAGER)
  reg.registerRole(MINI_WOLF)
  reg.registerPhase(MINI_KILL)
  reg.registerPhase(MINI_NOOP)
  reg.registerPhase(MINI_TALK)
  reg.registerPhase(MINI_VOTE)
  reg.registerVictoryCondition(MINI_FACTION_ELIMINATION)
  return resolveWerewolfRuleSet({
    schemaVersion: 1,
    id: 'guards',
    revision: 1,
    displayName: 'Guards',
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
        { phase: 'day.vote', phaseVersion: 1 },
      ],
    },
    victory: [{ condition: 'mini.faction-elimination', conditionVersion: 1, priority: 10 }],
    policies: { voteTie: 'no-elimination', wolfTie: 'no-kill', deadHuman: 'spectate', maxDays: 8, speechMaxChars: 40 },
  }, reg)
}

function wolfHumanRules(): WerewolfCompiledRuleSetV1 {
  return miniRules()
}

function wolfHumanSeed(): number {
  const rules = wolfHumanRules()
  let seed = 1
  while (true) {
    const { state } = startWerewolfGame({ ruleSet: rules, seed, ids: counterIds() })
    if (state.players.find(player => player.playerId === state.humanPlayerId)?.faction === 'wolf') return seed
    seed += 1
  }
}

describe('reducer edge folds', () => {
  it('maps result announcements to data-less announcement timeline entries', () => {
    const rules = miniRules()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const resolved = {
      type: 'werewolf/phase-resolved',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        decisionIds: [],
        humanActionIds: [],
        resolution: {
          eliminations: [],
          prevented: [],
          resourceReplacements: [],
          roleStateReplacements: [],
          privateNotices: [],
          announcements: [{ kind: 'result', key: 'day.summary' }, { kind: 'vote', key: 'vote.cast' }],
          votes: [],
          outcome: {},
        },
        rngState: state.rngState,
      },
    } as never as WerewolfEvent<'werewolf/phase-resolved'>
    const next = applyWerewolfEvent(state, resolved)
    const entries = next?.timeline ?? []
    expect(entries.map(entry => [entry.kind, entry.key])).toEqual([
      ['announcement', 'day.summary'],
      ['vote', 'vote.cast'],
    ])
    expect(entries[0]).not.toHaveProperty('data')
  })

  it('folds an awaiting open without a plan onto the empty default plan', () => {
    const rules = miniRules()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const opened = applyWerewolfEvent(state, {
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
        rngState: state.rngState,
      },
    })
    expect(opened?.openPhase?.plan).toEqual({ mode: 'parallel-private', actors: [] })
  })

  it('folds human actions without an open phase, non-object actions, and requests', () => {
    const rules = miniRules()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const orphan = applyWerewolfEvent(state, {
      type: 'werewolf/human-action',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 2,
        humanActionId: WerewolfHumanActionId('h1'),
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        playerId: state.humanPlayerId,
        action: { value: 'hi' },
      },
    })
    expect(orphan?.openPhase).toBeNull()
    expect(orphan?.timeline.filter(entry => entry.kind === 'speech')).toHaveLength(0)
    const withRequest = applyWerewolfEvent(orphan ?? state, {
      type: 'werewolf/human-action',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 3,
        humanActionId: WerewolfHumanActionId('h2'),
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        playerId: state.humanPlayerId,
        action: { value: 'hi' },
        request: { requestId: 'r1', digest: 'd1' },
      },
    })
    expect(withRequest?.idempotencyKeys.get('submitAction\u0000r1')).toBe('d1')
  })

  it('folds a non-object text action without recording a speech', () => {
    const rules = miniRules()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const withPhase = applyWerewolfEvent(state, {
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
    })
    const spoken = applyWerewolfEvent(withPhase, {
      type: 'werewolf/human-action',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 3,
        humanActionId: WerewolfHumanActionId('h1'),
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        playerId: state.humanPlayerId,
        action: 'raw words' as JsonValue,
      },
    })
    expect(spoken?.timeline.filter(entry => entry.kind === 'speech')).toHaveLength(0)
    expect(spoken?.openPhase?.settled).toHaveLength(1)
  })

  it('folds bot decisions without an open phase and drops their speeches', () => {
    const rules = miniRules()
    const started = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const bot = started.state.players.find(player => !player.human)
    const next = applyWerewolfEvent(started.state, {
      type: 'werewolf/bot-decision',
      data: {
        version: 1,
        gameId: started.state.gameId,
        gameRevision: 2,
        sourceGameRevision: 1,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        mode: 'parallel-private',
        entries: [{
          decisionId: WerewolfDecisionId('d1'),
          playerId: bot?.playerId,
          phaseInstanceId: WerewolfPhaseInstanceId('i1'),
          actorContextRevision: 0,
          action: { value: null },
          publicSpeech: 'words',
          contextDelta: {},
          contextAfter: {} as never,
        }],
      },
    })
    expect(next?.openPhase).toBeNull()
    expect(next?.timeline.filter(entry => entry.kind === 'speech')).toHaveLength(0)
    expect(next?.contexts[String(bot?.playerId)]).toEqual({})
  })

  it('folds a resume without a request and a resolution without an open phase or segment', () => {
    const rules = miniRules()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 3, ids: counterIds() })
    const resumed = applyWerewolfEvent(state, {
      type: 'werewolf/game-resumed',
      data: { version: 1, gameId: state.gameId, gameRevision: 2, retryEpoch: 0 },
    })
    expect(resumed?.status).toBe('running')
    expect(resumed?.idempotencyKeys.size).toBe(0)
    const gutted = { ...state, segment: null, openPhase: null }
    const resolved = applyWerewolfEvent(gutted, {
      type: 'werewolf/phase-resolved',
      data: {
        version: 1,
        gameId: state.gameId,
        gameRevision: 3,
        phaseInstanceId: WerewolfPhaseInstanceId('i1'),
        decisionIds: [],
        humanActionIds: [],
        resolution: {
          eliminations: [],
          prevented: [],
          resourceReplacements: [],
          roleStateReplacements: [],
          privateNotices: [],
          announcements: [],
          votes: [],
          outcome: {},
        },
        rngState: state.rngState,
      },
    })
    expect(resolved?.sameDayResolutions).toHaveLength(1)
    expect(resolved?.sameDayResolutions[0]).toMatchObject({ phaseId: '', phaseVersion: 0, segment: 'night' })
  })
})
