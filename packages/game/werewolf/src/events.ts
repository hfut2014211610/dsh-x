/**
 * The `werewolf/*` session-event declarations. Log-only domain facts: they
 * never enter the model surface or derived history; public and human-private
 * views are projections of these events.
 * @module @deepseek-ai/dsh-werewolf/events
 */

import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type {
  WerewolfBotAttemptFailedV1,
  WerewolfBotDecisionV1,
  WerewolfGameEndedV1,
  WerewolfGamePausedV1,
  WerewolfGameResumedV1,
  WerewolfGameStartedV1,
  WerewolfHumanActionV1,
  WerewolfPhaseOpenedV1,
  WerewolfPhaseResolvedV1,
} from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete start-of-game facts: shuffled roster, secret role assignment,
     * initial role state and resources, human player id, immutable bot
     * profiles, seed, normalized rule set, digest, and definition versions.
     * Log-only; one Session may start a new game after an earlier one ended.
     */
    'werewolf/game-started': WerewolfGameStartedV1
    /**
     * One phase occurrence opened (awaiting actions) or skipped. Log-only;
     * carries the immutable action plan or the skip reason.
     */
    'werewolf/phase-opened': WerewolfPhaseOpenedV1
    /**
     * One committed human action inside an open phase. Log-only; committed
     * before sibling bot requests start so commit order cannot disclose it.
     */
    'werewolf/human-action': WerewolfHumanActionV1
    /**
     * One failed bot child attempt: decision id, attempt number, retry epoch,
     * child session id, and exact failure category. Log-only; changes neither
     * game revision nor bot context.
     */
    'werewolf/bot-attempt-failed': WerewolfBotAttemptFailedV1
    /**
     * Accepted bot decisions for one open phase: one entry per sequential
     * actor, or one seat-ordered batch per parallel phase. Log-only; each
     * entry records the prior context revision, action, optional speech,
     * validated delta, and full computed `contextAfter`.
     */
    'werewolf/bot-decision': WerewolfBotDecisionV1
    /**
     * One resolved phase occurrence: accepted decision and human-action ids
     * plus the complete declarative resolution. Log-only; replay applies only
     * the recorded effects and never re-runs role or phase code.
     */
    'werewolf/phase-resolved': WerewolfPhaseResolvedV1
    /** Log-only pause marker with a typed reason and the resumable phase. */
    'werewolf/game-paused': WerewolfGamePausedV1
    /** Log-only resume marker; increments the retry epoch. */
    'werewolf/game-resumed': WerewolfGameResumedV1
    /** Terminal result for one game id. Log-only; no later event may follow for that game. */
    'werewolf/game-ended': WerewolfGameEndedV1
  }
}

const WEREWOLF_EVENT_TYPES = [
  'werewolf/game-started',
  'werewolf/phase-opened',
  'werewolf/human-action',
  'werewolf/bot-attempt-failed',
  'werewolf/bot-decision',
  'werewolf/phase-resolved',
  'werewolf/game-paused',
  'werewolf/game-resumed',
  'werewolf/game-ended',
] as const

const WEREWOLF_EVENT_TYPE_SET: ReadonlySet<string> = new Set(WEREWOLF_EVENT_TYPES)

/** Every werewolf event-type key this package declares. */
export type WerewolfEventType = (typeof WEREWOLF_EVENT_TYPES)[number]

/** The event types that advance `gameRevision` by exactly one. */
export const WEREWOLF_STATE_CHANGING_EVENTS: ReadonlySet<string> = new Set([
  'werewolf/game-started',
  'werewolf/phase-opened',
  'werewolf/human-action',
  'werewolf/bot-decision',
  'werewolf/phase-resolved',
  'werewolf/game-paused',
  'werewolf/game-resumed',
  'werewolf/game-ended',
])

/**
 * One werewolf event as the engine and reducer pass it around, envelope-free.
 * A homomorphic mapped type over the key union, so the default instantiation
 * is a discriminated union narrowable on `type`.
 */
export type WerewolfEvent<T extends WerewolfEventType = WerewolfEventType> = {
  [K in T]: { type: K; data: SessionEventMap[K] }
}[T]

/**
 * Whether one session event is a werewolf event.
 *
 * @param event - any event-shaped value.
 * @returns whether `event.type` is a declared werewolf event type.
 */
export function isWerewolfEvent(event: { type: string }): event is WerewolfEvent {
  return WEREWOLF_EVENT_TYPE_SET.has(event.type)
}
