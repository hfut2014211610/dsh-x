/**
 * Shared stage-1 test fixtures: a minimal role/phase/victory vocabulary and
 * rule-set factory that exercises the engine without the classic package.
 * Test scripts may close over a started state's secret roster; production
 * code never does.
 * @module ./fixtures
 */

import { resolveWerewolfRuleSet } from '../src/rules.ts'
import { WerewolfRegistry } from '../src/registry.ts'
import type { WerewolfEngineIds } from '../src/engine.ts'
import type {
  WerewolfCompiledRuleSetV1,
  WerewolfContextLimitsV1,
  WerewolfPhaseDefinition,
  WerewolfResolutionV1,
  WerewolfRoleDefinition,
  WerewolfVictoryConditionDefinition,
} from '../src/types.ts'
import { WerewolfPlayerId } from '../src/brand.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Mutable resolution builder; phases push records before returning it. */
type MutableResolution = {
  [K in keyof WerewolfResolutionV1]: WerewolfResolutionV1[K] extends readonly (infer T)[] | undefined ? T[] : WerewolfResolutionV1[K]
}
const emptyResolution = (): MutableResolution => ({
  eliminations: [],
  prevented: [],
  resourceReplacements: [],
  roleStateReplacements: [],
  privateNotices: [],
  announcements: [],
  votes: [],
  outcome: {},
})

function actionsBySeat(input: {
  actions: ReadonlyArray<{ playerId: WerewolfPlayerId; action: JsonValue }>
  players: ReadonlyArray<{ playerId: WerewolfPlayerId; seat: number }>
}) {
  const seatOf = new Map(input.players.map(player => [player.playerId, player.seat]))
  return [...input.actions].sort((a, b) => (seatOf.get(a.playerId) ?? 0) - (seatOf.get(b.playerId) ?? 0))
}

/** Faction-blind villager with no night action. */
export const MINI_VILLAGER: WerewolfRoleDefinition = {
  id: 'mini.villager',
  version: 1,
  parseOptions: () => ({}),
  compile: () => ({
    id: 'mini.villager',
    version: 1,
    faction: 'village',
    publicName: 'Villager',
    initialRoleState: {},
    phaseBindings: [],
    projectPrivateKnowledge: () => ({}),
  }),
}

/** Wolf that sees teammates and must act in `night.kill`. */
export const MINI_WOLF: WerewolfRoleDefinition = {
  id: 'mini.wolf',
  version: 1,
  parseOptions: () => ({}),
  compile: () => ({
    id: 'mini.wolf',
    version: 1,
    faction: 'wolf',
    publicName: 'Wolf',
    initialRoleState: {},
    seesFactionTeammates: true,
    phaseBindings: [{ phaseId: 'night.kill', phaseVersion: 1, required: true, kind: 'kill', options: {} }],
    projectPrivateKnowledge: input => ({ teammates: input.teammates.map(mate => mate.playerId) }),
  }),
}

/** Night kill: living wolves each pick a living other; unanimity kills. */
export const MINI_KILL: WerewolfPhaseDefinition = {
  id: 'night.kill',
  version: 1,
  parseOptions: () => ({}),
  parseRoleBinding: binding => binding.options,
  compile: () => ({
    id: 'night.kill',
    version: 1,
    open(input) {
      const wolves = input.participants.filter(participant => participant.alive)
      if (wolves.length === 0) return { kind: 'skip', reason: 'no living wolves' }
      if (input.players.filter(player => player.alive).length <= 1) {
        return { kind: 'skip', reason: 'not enough living players' }
      }
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private' as const,
          actors: wolves.map(wolf => ({
            playerId: wolf.playerId,
            seat: wolf.seat,
            actionKind: 'kill',
            spec: {
              kind: 'player-target' as const,
              targets: input.players.filter(player => player.alive && player.playerId !== wolf.playerId).map(player => player.playerId),
              allowSkip: false,
            },
          })),
        },
      }
    },
    resolve(input) {
      const resolution = emptyResolution()
      const proposed: WerewolfPlayerId[] = []
      for (const entry of actionsBySeat(input)) {
        const target = (entry.action as { value: WerewolfPlayerId | null }).value
        resolution.votes.push({ voterId: entry.playerId, targetId: target })
        if (target !== null) proposed.push(target)
      }
      const unique = [...new Set(proposed)]
      const victim = unique.length === 1 ? unique[0] : null
      if (victim !== null && victim !== undefined) {
        resolution.privateNotices.push({ toPlayerId: victim, kind: 'kill-mark', data: {} })
      }
      resolution.outcome = { victim: victim === undefined ? null : victim }
      return resolution
    },
  }),
}

/** Always-skipped night phase exercising the skip loop. */
export const MINI_NOOP: WerewolfPhaseDefinition = {
  id: 'night.noop',
  version: 1,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'night.noop',
    version: 1,
    open: () => ({ kind: 'skip', reason: 'nothing to do' }),
    resolve: () => emptyResolution(),
  }),
}

/** Day speech in seat order. */
export const MINI_TALK: WerewolfPhaseDefinition = {
  id: 'day.talk',
  version: 1,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'day.talk',
    version: 1,
    open(input) {
      const speakers = input.players.filter(player => player.alive)
      return {
        kind: 'plan',
        plan: {
          mode: 'seat-order-public' as const,
          actors: speakers.map(player => ({
            playerId: player.playerId,
            seat: player.seat,
            actionKind: 'speech',
            spec: { kind: 'text' as const, maxChars: input.policies.speechMaxChars, allowSkip: true },
          })),
        },
      }
    },
    resolve: input => ({
      ...emptyResolution(),
      outcome: { speeches: input.actions.length },
    }),
  }),
}

/** Day vote: highest count wins; a tie reports tiedPlayers for the engine. */
export const MINI_VOTE: WerewolfPhaseDefinition = {
  id: 'day.vote',
  version: 1,
  repeatable: true,
  parseOptions: () => ({}),
  parseRoleBinding: () => ({}),
  compile: () => ({
    id: 'day.vote',
    version: 1,
    open(input) {
      const tied = input.occurrence > 0
        ? input.sameDayHistory
          .filter(prior => prior.phaseId === 'day.vote')
          .flatMap(prior => prior.resolution.voteOutcome?.tiedPlayers ?? [])
        : []
      const voters = input.players.filter(player => player.alive)
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private' as const,
          actors: voters.map(voter => ({
            playerId: voter.playerId,
            seat: voter.seat,
            actionKind: 'vote',
            spec: {
              kind: 'player-target' as const,
              targets: input.players
                .filter(player => player.alive
                  && player.playerId !== voter.playerId
                  && (tied.length === 0 || tied.includes(player.playerId)))
                .map(player => player.playerId),
              allowSkip: true,
            },
          })),
        },
      }
    },
    resolve(input) {
      const resolution = emptyResolution()
      const counts = new Map<WerewolfPlayerId, number>()
      for (const entry of actionsBySeat(input)) {
        const target = (entry.action as { value: WerewolfPlayerId | null }).value
        resolution.votes.push({ voterId: entry.playerId, targetId: target })
        if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1)
      }
      const high = Math.max(0, ...counts.values())
      const leaders = [...counts.entries()].filter(([, count]) => count === high).map(([player]) => player)
      if (high > 0 && leaders.length === 1 && leaders[0] !== undefined) {
        const eliminated = leaders[0]
        resolution.eliminations.push({ playerId: eliminated, cause: 'vote' })
        resolution.announcements.push({ kind: 'vote', key: 'vote.eliminated', data: { playerId: eliminated } })
        resolution.voteOutcome = { eliminated, tiedPlayers: [] }
      } else {
        resolution.voteOutcome = { eliminated: null, tiedPlayers: leaders }
      }
      resolution.outcome = { counts: [...counts.entries()].map(([player, count]) => ({ player, count })) }
      return resolution
    },
  }),
}

/** Claims the single faction that still has living players. */
export const MINI_FACTION_ELIMINATION: WerewolfVictoryConditionDefinition = {
  id: 'mini.faction-elimination',
  version: 1,
  parseOptions: () => ({}),
  evaluate: (input) => {
    const factions = new Set(input.players.filter(player => player.alive).map(player => player.faction))
    if (factions.size !== 1) return null
    return { outcome: { kind: 'faction', factionId: [...factions][0] ?? 'village' }, evidence: { alive: input.players.filter(player => player.alive).map(player => player.playerId) } }
  },
}

/** Never claims; used to reach the max-days tie. */
export const MINI_NEVER: WerewolfVictoryConditionDefinition = {
  id: 'mini.never',
  version: 1,
  parseOptions: () => ({}),
  evaluate: () => null,
}

/** Claims a fixed faction unconditionally; used for conflict tests. */
function fixedClaimCondition(id: string, factionId: string): WerewolfVictoryConditionDefinition {
  return {
    id,
    version: 1,
    parseOptions: () => ({}),
    evaluate: () => ({ outcome: { kind: 'faction', factionId }, evidence: {} }),
  }
}

/** Variant knobs the mini rule-set factory takes. */
export interface MiniRuleSetVariant {
  voteTie: 'no-elimination' | 'revote-once' | 'seeded-random'
  maxDays?: number
  speechMaxChars?: number
  deck?: ReadonlyArray<{ role: string; count: number }>
  /** Replace the claiming condition with one that never claims. */
  neverVictory?: boolean
  /** Register two fixed divergent claims alongside the base condition. */
  conflictVictory?: boolean
}

/** Compile a mini rule set with fresh registrations. */
export function miniRuleSet(variant: MiniRuleSetVariant): WerewolfCompiledRuleSetV1 {
  const registry = new WerewolfRegistry()
  registry.registerRole(MINI_VILLAGER)
  registry.registerRole(MINI_WOLF)
  registry.registerPhase(MINI_KILL)
  registry.registerPhase(MINI_NOOP)
  registry.registerPhase(MINI_TALK)
  registry.registerPhase(MINI_VOTE)
  registry.registerVictoryCondition(MINI_FACTION_ELIMINATION)
  registry.registerVictoryCondition(MINI_NEVER)
  if (variant.conflictVictory === true) {
    registry.registerVictoryCondition(fixedClaimCondition('mini.claim-a', 'alpha'))
    registry.registerVictoryCondition(fixedClaimCondition('mini.claim-b', 'beta'))
  }
  const deck = variant.deck ?? [{ role: 'mini.wolf', count: 2 }, { role: 'mini.villager', count: 3 }]
  const input: JsonValue = {
    schemaVersion: 1,
    id: 'mini',
    revision: 1,
    displayName: 'Mini',
    playerCount: deck.reduce((sum, entry) => sum + entry.count, 0),
    deck: deck.map(entry => ({ role: entry.role, roleVersion: 1, count: entry.count })),
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
    victory: variant.conflictVictory === true
      ? [
        { condition: 'mini.claim-a', conditionVersion: 1, priority: 10 },
        { condition: 'mini.claim-b', conditionVersion: 1, priority: 10 },
      ]
      : [{ condition: variant.neverVictory === true ? 'mini.never' : 'mini.faction-elimination', conditionVersion: 1, priority: 10 }],
    policies: {
      voteTie: variant.voteTie,
      wolfTie: 'no-kill',
      deadHuman: 'spectate',
      maxDays: variant.maxDays ?? 8,
      speechMaxChars: variant.speechMaxChars ?? 40,
    },
  }
  return resolveWerewolfRuleSet(input, registry)
}

/** Deterministic counter-backed ids so whole event streams compare equal. */
export function counterIds(): WerewolfEngineIds & { dump(): string[] } {
  const minted: string[] = []
  const of = (prefix: string): () => string => {
    let n = 0
    return () => {
      const id = `${prefix}${++n}`
      minted.push(id)
      return id
    }
  }
  const game = of('g')
  const player = of('p')
  const phaseInstance = of('i')
  const decision = of('d')
  const humanAction = of('h')
  return {
    game: () => game() as never,
    player: () => player() as never,
    phaseInstance: () => phaseInstance() as never,
    decision: () => decision() as never,
    humanAction: () => humanAction() as never,
    dump: () => minted,
  }
}

/** Compact context limits for tests. */
export function testLimits(): WerewolfContextLimitsV1 {
  return { memorySummaryChars: 64, beliefBasisChars: 64, commitmentChars: 64, strategyChars: 64, maxCommitments: 8 }
}

/** A valid empty delta. */
export const EMPTY_DELTA = {}
