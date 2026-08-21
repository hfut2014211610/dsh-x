/**
 * Typed errors for rejected Werewolf reads, registrations, and mutations.
 * User-visible text may group codes, but logs and tests keep the exact code.
 * @module @deepseek-ai/dsh-werewolf/error
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Stable error codes for rejected Werewolf operations. */
export type WerewolfErrorCode =
  | 'WEREWOLF_INVALID_RULE_SET'
  | 'WEREWOLF_UNKNOWN_DEFINITION'
  | 'WEREWOLF_DUPLICATE_REGISTRATION'
  | 'WEREWOLF_STALE_REVISION'
  | 'WEREWOLF_IDEMPOTENCY_CONFLICT'
  | 'WEREWOLF_GAME_ALREADY_ACTIVE'
  | 'WEREWOLF_NO_ACTIVE_GAME'
  | 'WEREWOLF_NOT_AWAITING_HUMAN'
  | 'WEREWOLF_ILLEGAL_ACTION'
  | 'WEREWOLF_INVALID_CONTEXT_DELTA'
  | 'WEREWOLF_VICTORY_CONFLICT'

/** One typed Werewolf failure; `detail` is detached JSON for logs and tests. */
export class WerewolfError extends Error {
  /** The stable failure code. */
  readonly code: WerewolfErrorCode
  /** Optional detached JSON facts for logs and tests. */
  readonly detail?: JsonValue

  /**
   * @param code - the stable failure code.
   * @param message - the exact diagnostic.
   * @param detail - optional detached JSON facts (parsed payload, ids).
   */
  constructor(code: WerewolfErrorCode, message: string, detail?: JsonValue) {
    super(message)
    this.name = 'WerewolfError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}
