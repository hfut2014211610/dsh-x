/** Public wire types for the dedicated Werewolf UI. @module @deepseek-ai/dsh-werewolf/types */

export type { WerewolfHumanViewV1, WerewolfReplayV1, WerewolfRuleSetOptionV1 } from './human-projection.ts'
export type { WerewolfActionSpecJsonV1, WerewolfSingleActionSpecJsonV1 } from './types.ts'
import type { WerewolfHumanViewV1, WerewolfRuleSetOptionV1 } from './human-projection.ts'

/** User input accepted by the typed start method. */
export interface WerewolfGameStartV1 {
  ruleSetId: string
  ruleSetRevision: number
  seed: number
  humanSeatPreference?: number
  playerNames?: string[]
}

/** User input accepted by the typed action method. */
export interface WerewolfGameActionV1 {
  phaseInstanceId: string
  action: import('@deepseek-ai/dsh-session/types').JsonValue
}

/** Lobby projection available before any game exists. */
export interface WerewolfLobbyViewV1 {
  version: 1
  availableRuleSets: WerewolfRuleSetOptionV1[]
  /** Running or paused games the local principal may continue, newest first. */
  activeGames: WerewolfLobbyGameV1[]
}

/** One resumable game shown by the local lobby. */
export interface WerewolfLobbyGameV1 extends Pick<WerewolfHumanViewV1, 'gameId' | 'gameRevision' | 'day' | 'ruleSet'> {
  status: Extract<WerewolfHumanViewV1['status'], 'running' | 'paused'>
}

/** Typed remote request for creating one game. */
export interface WerewolfStartRequestV1 extends WerewolfGameStartV1 {
  requestId: string
  expectedGameRevision: 0
}

/** Typed remote request for one human action. */
export interface WerewolfSubmitActionRequestV1 extends WerewolfGameActionV1 {
  gameId: string
  requestId: string
  expectedGameRevision: number
}

/** Typed remote request for resume or abort. */
export interface WerewolfHostMutationRequestV1 {
  gameId: string
  requestId: string
  expectedGameRevision: number
}
