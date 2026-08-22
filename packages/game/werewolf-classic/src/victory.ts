/**
 * Classic victory conditions at version 1: faction elimination (last faction
 * standing) and wolf parity, evaluated over the alive roster's factions.
 * @module @deepseek-ai/dsh-werewolf-classic/victory
 */

import type {
  WerewolfPlayerId,
  WerewolfVictoryConditionDefinition,
} from '@deepseek-ai/dsh-werewolf'
import { asOptionsRecord, optionsInvalid, parseNoOptions, rejectUnknownOptions } from './shared.ts'

/** Faction elimination: exactly one faction still has living players. */
export const FACTION_ELIMINATION_VICTORY: WerewolfVictoryConditionDefinition = {
  id: 'faction-elimination',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'faction-elimination options')
  },
  evaluate(input) {
    const factions: string[] = []
    const alive: WerewolfPlayerId[] = []
    for (const player of input.players) {
      if (!player.alive) continue
      alive.push(player.playerId)
      if (!factions.includes(player.faction)) factions.push(player.faction)
    }
    if (factions.length !== 1) return null
    // The size check just ran; the index cannot miss.
    const factionId = factions[0] as string
    return { outcome: { kind: 'faction', factionId }, evidence: { alive } }
  },
}

/** Wolf parity: at least one living wolf and no fewer wolves than all others combined. */
export const WOLF_PARITY_VICTORY: WerewolfVictoryConditionDefinition = {
  id: 'wolf-parity',
  version: 1,
  parseOptions(value) {
    const record = asOptionsRecord(value, 'wolf-parity options')
    rejectUnknownOptions(record, ['wolfFaction'], 'wolf-parity options')
    const wolfFaction = record.wolfFaction
    if (wolfFaction !== undefined && (typeof wolfFaction !== 'string' || wolfFaction.length === 0)) {
      optionsInvalid('wolf-parity options.wolfFaction must be a non-empty string')
    }
    return { wolfFaction: wolfFaction ?? 'wolf' }
  },
  evaluate(input) {
    const wolfFaction = (input.options as { wolfFaction: string }).wolfFaction
    const wolves = input.players
      .filter(player => player.alive && player.faction === wolfFaction)
      .map(player => player.playerId)
    const others = input.players
      .filter(player => player.alive && player.faction !== wolfFaction)
      .map(player => player.playerId)
    if (wolves.length === 0 || wolves.length < others.length) return null
    return { outcome: { kind: 'faction', factionId: wolfFaction }, evidence: { wolves, others } }
  },
}
