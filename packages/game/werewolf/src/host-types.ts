/** Public wire types for the dedicated Werewolf UI. @module @deepseek-ai/dsh-werewolf/types */

import type { WerewolfGameActionV1, WerewolfGameStartV1 } from './module-adapter.ts'

export type { WerewolfHumanViewV1, WerewolfReplayV1 } from './human-projection.ts'
export type { WerewolfGameActionV1, WerewolfGameStartV1 } from './module-adapter.ts'

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
