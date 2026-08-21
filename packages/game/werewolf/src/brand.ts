/**
 * Branded ids that cross the Werewolf package boundary. Construction goes
 * through these factories in the OWNING package; runtime behavior is plain
 * string, so ids serialize, log, and compare unchanged inside durable events.
 * @module @deepseek-ai/dsh-werewolf/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** One game instance inside a session log; stable across forked timelines. */
export type WerewolfGameId = Branded<'WerewolfGameId'>

/** One seat's durable identity across a whole game. */
export type WerewolfPlayerId = Branded<'WerewolfPlayerId'>

/** One opened occurrence of a configured phase within a game. */
export type WerewolfPhaseInstanceId = Branded<'WerewolfPhaseInstanceId'>

/** One logical bot decision; reused across retries of the same decision. */
export type WerewolfDecisionId = Branded<'WerewolfDecisionId'>

/** One accepted human action inside a phase. */
export type WerewolfHumanActionId = Branded<'WerewolfHumanActionId'>

/**
 * Brand a game id (a plain cast — zero runtime cost).
 *
 * @param id - the raw id string.
 * @returns the branded id.
 */
export function WerewolfGameId(id: string): WerewolfGameId {
  return id as WerewolfGameId
}

/**
 * Brand a player id (a plain cast — zero runtime cost).
 *
 * @param id - the raw id string.
 * @returns the branded id.
 */
export function WerewolfPlayerId(id: string): WerewolfPlayerId {
  return id as WerewolfPlayerId
}

/**
 * Brand a phase instance id (a plain cast — zero runtime cost).
 *
 * @param id - the raw id string.
 * @returns the branded id.
 */
export function WerewolfPhaseInstanceId(id: string): WerewolfPhaseInstanceId {
  return id as WerewolfPhaseInstanceId
}

/**
 * Brand a decision id (a plain cast — zero runtime cost).
 *
 * @param id - the raw id string.
 * @returns the branded id.
 */
export function WerewolfDecisionId(id: string): WerewolfDecisionId {
  return id as WerewolfDecisionId
}

/**
 * Brand a human action id (a plain cast — zero runtime cost).
 *
 * @param id - the raw id string.
 * @returns the branded id.
 */
export function WerewolfHumanActionId(id: string): WerewolfHumanActionId {
  return id as WerewolfHumanActionId
}
