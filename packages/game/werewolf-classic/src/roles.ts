/**
 * Classic role definitions at version 1 — villager, wolf, seer, and witch —
 * plus the two classic faction ids. Options parse strictly at the config
 * boundary; `compile` returns detached per-game state and bindings.
 * @module @deepseek-ai/dsh-werewolf-classic/roles
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {
  WerewolfPlayerId,
  WerewolfRoleDefinition,
  WerewolfRoleKnowledgeInputV1,
} from '@deepseek-ai/dsh-werewolf'
import {
  asOptionsRecord,
  detachJson,
  optionsInvalid,
  parseNoOptions,
  rejectUnknownOptions,
} from './shared.ts'

/** The two classic faction ids shared by the shipped roles and victory conditions. */
export const WEREWOLF_CLASSIC_FACTIONS = { village: 'village', wolf: 'wolf' } as const

/**
 * Parsed witch options: potion counts and the self-save rule. The compiled
 * witch's role state mirrors these values, so the night phase can read the
 * configured self-save policy from participant facts.
 */
export type WitchRoleOptions = {
  antidoteUses: number
  poisonUses: number
  selfSave: 'first-night-only' | 'never'
}

/**
 * Read one witch potion count: a safe integer in 0..2.
 * @param value - the raw configured value.
 * @param key - the option key diagnostics name.
 * @returns the validated count.
 */
function requireWitchUses(value: JsonValue | undefined, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2) {
    optionsInvalid(`witch options.${key} must be an integer between 0 and 2`)
  }
  return value
}

/**
 * Read the witch self-save policy.
 * @param value - the raw configured value.
 * @returns the validated policy.
 */
function requireSelfSave(value: JsonValue | undefined): WitchRoleOptions['selfSave'] {
  if (value !== 'first-night-only' && value !== 'never') {
    optionsInvalid('witch options.selfSave must be "first-night-only" or "never"')
  }
  return value
}

/**
 * Parse witch options with explicit defaults: one antidote, one poison, and
 * self-save on the first night only.
 * @param value - the raw options value.
 * @returns the validated witch options.
 */
function parseWitchOptions(value: JsonValue | undefined): WitchRoleOptions {
  const record = asOptionsRecord(value, 'witch options')
  rejectUnknownOptions(record, ['antidoteUses', 'poisonUses', 'selfSave'], 'witch options')
  return {
    antidoteUses: record.antidoteUses === undefined ? 1 : requireWitchUses(record.antidoteUses, 'antidoteUses'),
    poisonUses: record.poisonUses === undefined ? 1 : requireWitchUses(record.poisonUses, 'poisonUses'),
    selfSave: record.selfSave === undefined ? 'first-night-only' : requireSelfSave(record.selfSave),
  }
}

/**
 * The private-knowledge record every classic role projects: the day, own role
 * state, own resources, and own notices, fully detached.
 */
type CommonKnowledge = {
  day: number
  roleState: JsonValue
  resources: { [key: string]: number }
  notices: Array<{ toPlayerId: WerewolfPlayerId; kind: string; data: JsonValue }>
}

/**
 * Project the private knowledge every classic role shares.
 * @param input - the actor-authorized knowledge input.
 * @returns the detached private-knowledge projection.
 */
function commonKnowledge(input: WerewolfRoleKnowledgeInputV1): CommonKnowledge {
  return {
    day: input.day,
    roleState: detachJson(input.self.roleState),
    resources: { ...input.self.resources },
    notices: input.self.notices.map(notice => ({
      toPlayerId: notice.toPlayerId,
      kind: notice.kind,
      data: detachJson(notice.data),
    })),
  }
}

/** The villager: plain village vote, no night action, no starting state. */
export const VILLAGER_ROLE: WerewolfRoleDefinition = {
  id: 'villager',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'villager options')
  },
  compile: () => ({
    id: 'villager',
    version: 1,
    faction: WEREWOLF_CLASSIC_FACTIONS.village,
    publicName: 'Villager',
    initialRoleState: null,
    phaseBindings: [],
    projectPrivateKnowledge: commonKnowledge,
  }),
}

/** The wolf: kills at night and knows its living faction teammates. */
export const WOLF_ROLE: WerewolfRoleDefinition = {
  id: 'wolf',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'wolf options')
  },
  compile: () => ({
    id: 'wolf',
    version: 1,
    faction: WEREWOLF_CLASSIC_FACTIONS.wolf,
    publicName: 'Wolf',
    initialRoleState: null,
    seesFactionTeammates: true,
    phaseBindings: [{
      phaseId: 'night.wolf-kill',
      phaseVersion: 1,
      required: true,
      kind: 'kill',
      options: {},
    }],
    projectPrivateKnowledge(input) {
      return {
        ...commonKnowledge(input),
        teammates: input.teammates.map(member => ({
          playerId: member.playerId,
          seat: member.seat,
          alive: member.alive,
        })),
      }
    },
  }),
}

/** The seer: inspects one player each night; checks accumulate in role state. */
export const SEER_ROLE: WerewolfRoleDefinition = {
  id: 'seer',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'seer options')
  },
  compile: () => ({
    id: 'seer',
    version: 1,
    faction: WEREWOLF_CLASSIC_FACTIONS.village,
    publicName: 'Seer',
    initialRoleState: { checks: [] },
    phaseBindings: [{
      phaseId: 'night.seer-inspect',
      phaseVersion: 1,
      required: true,
      kind: 'inspect',
      options: {},
    }],
    projectPrivateKnowledge: commonKnowledge,
  }),
}

/** The witch: holds one antidote and one poison by default; role state mirrors the configured uses. */
export const WITCH_ROLE: WerewolfRoleDefinition = {
  id: 'witch',
  version: 1,
  parseOptions: parseWitchOptions,
  compile({ options }) {
    const parsed = options as unknown as WitchRoleOptions
    return {
      id: 'witch',
      version: 1,
      faction: WEREWOLF_CLASSIC_FACTIONS.village,
      publicName: 'Witch',
      initialRoleState: {
        antidoteUses: parsed.antidoteUses,
        poisonUses: parsed.poisonUses,
        selfSave: parsed.selfSave,
      },
      initialResources: {
        antidote: parsed.antidoteUses,
        poison: parsed.poisonUses,
      },
      phaseBindings: [{
        phaseId: 'night.witch',
        phaseVersion: 1,
        required: true,
        kind: 'act',
        options: {},
      }],
      projectPrivateKnowledge: commonKnowledge,
    }
  },
}
