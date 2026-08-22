/**
 * The classic Werewolf definitions plugin: four standard roles, six standard
 * phases, two faction victory conditions, and the `quick-7` rule set,
 * registered on `ctx.werewolf`. Registrations are effects on the loading
 * fiber, so dispose and HMR reload remove and re-add exactly this plugin's
 * entries.
 * @module @deepseek-ai/dsh-werewolf-classic
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { WerewolfRuleSetInputV1 } from '@deepseek-ai/dsh-werewolf'
import { SEER_ROLE, VILLAGER_ROLE, WITCH_ROLE, WOLF_ROLE } from './roles.ts'
import {
  ANNOUNCE_PHASE,
  DISCUSSION_PHASE,
  SEER_INSPECT_PHASE,
  VOTE_PHASE,
  WITCH_PHASE,
  WOLF_KILL_PHASE,
} from './phases.ts'
import { FACTION_ELIMINATION_VICTORY, WOLF_PARITY_VICTORY } from './victory.ts'

export * from './roles.ts'
export * from './phases.ts'
export * from './victory.ts'

/**
 * The shipped 7-player rule set: two wolves, a seer, a witch, and three
 * villagers. The `JsonValue` intersection keeps the record directly usable at
 * the core's raw rule-set parsing and compilation boundaries.
 */
export const QUICK_7_RULE_SET: WerewolfRuleSetInputV1 & JsonValue = {
  schemaVersion: 1,
  id: 'quick-7',
  revision: 1,
  displayName: 'Quick 7-player game',
  playerCount: 7,
  deck: [
    { role: 'wolf', roleVersion: 1, count: 2 },
    { role: 'seer', roleVersion: 1, count: 1 },
    {
      role: 'witch',
      roleVersion: 1,
      count: 1,
      options: { antidoteUses: 1, poisonUses: 1, selfSave: 'first-night-only' },
    },
    { role: 'villager', roleVersion: 1, count: 3 },
  ],
  cycle: {
    night: [
      { phase: 'night.wolf-kill', phaseVersion: 1 },
      { phase: 'night.seer-inspect', phaseVersion: 1 },
      { phase: 'night.witch', phaseVersion: 1 },
    ],
    day: [
      { phase: 'day.announce', phaseVersion: 1 },
      { phase: 'day.discussion', phaseVersion: 1 },
      { phase: 'day.vote', phaseVersion: 1 },
    ],
  },
  victory: [
    { condition: 'faction-elimination', conditionVersion: 1, priority: 10 },
    { condition: 'wolf-parity', conditionVersion: 1, priority: 10 },
  ],
  policies: {
    voteTie: 'revote-once',
    wolfTie: 'seeded-random',
    deadHuman: 'spectate',
    maxDays: 8,
    speechMaxChars: 160,
  },
}

/** Cordis plugin name. */
export const name = 'werewolf-classic'

/** Required service: the Werewolf extension registry service. */
export const inject = ['werewolf']

/**
 * Register every classic definition and the quick-7 rule set.
 * @param ctx - context whose `werewolf` service receives the registrations.
 */
export function apply(ctx: Context): void {
  for (const role of [VILLAGER_ROLE, WOLF_ROLE, SEER_ROLE, WITCH_ROLE]) {
    ctx.werewolf.registerRole(role)
  }
  for (const phase of [WOLF_KILL_PHASE, SEER_INSPECT_PHASE, WITCH_PHASE, ANNOUNCE_PHASE, DISCUSSION_PHASE, VOTE_PHASE]) {
    ctx.werewolf.registerPhase(phase)
  }
  for (const victory of [FACTION_ELIMINATION_VICTORY, WOLF_PARITY_VICTORY]) {
    ctx.werewolf.registerVictoryCondition(victory)
  }
  ctx.werewolf.registerRuleSet(QUICK_7_RULE_SET)
}
