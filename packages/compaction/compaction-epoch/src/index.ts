/**
 * Compaction-epoch promotion state shared by the fork's bootstrap-phase
 * plugins.
 *
 * A compaction rewrites the model-visible surface: the pre-compaction
 * conversation collapses into one synthetic summary message, and the
 * workspace-instruction baseline is re-injected from scratch. The first
 * post-compaction request is therefore a "second first request" — the same
 * first-token conditions a bootstrap-phase plugin exists to control. State is
 * epoch-aware: only a promotion signal recorded after the last
 * `compaction/end` counts, and each `compaction/end` demotes again.
 *
 * The state is a session projection rather than per-process bookkeeping, so a
 * resumed or reloaded session folds the same phase from its durable log
 * instead of restarting its bootstrap phase. The registry owns the history
 * read; this package contributes only the fold.
 *
 * The three consumer rows read the same projection through
 * {@link promotionStatus} and apply their own signal mode, so one projection
 * serves all of them without a second fold.
 *
 * @module @deepseek-ai/dsh-compaction-epoch
 */

import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import type {} from '@deepseek-ai/dsh-compaction/types'

/**
 * Durable event types that can promote a session out of its bootstrap phase.
 * The fold records both so each consumer's mode is a read, not a second
 * projection.
 */
export type PromotionSignal = 'tool/call' | 'assistant/message'

/**
 * Which durable signal promotes a consumer: either event, or one named by the
 * preset's `promoteOn` config. The kebab-case names are the config values;
 * {@link PromotionSignal} names the events they select.
 */
export type PromoteOn = 'tool-call' | 'assistant-message' | 'either'

/** Promotion state of one session's current compaction epoch. */
export interface PromotionEpoch {
  /**
   * Sequence of the `compaction/end` that opened the current epoch, or `null`
   * before the session's first compaction.
   */
  readonly boundary: number | null
  /** Whether a `tool/call` is recorded after `boundary`. */
  readonly toolCall: boolean
  /** Whether an `assistant/message` is recorded after `boundary`. */
  readonly assistantMessage: boolean
}

const promotionEpochSchema = zod.object({
  boundary: zod.number().int().nonnegative().nullable(),
  toolCall: zod.boolean(),
  assistantMessage: zod.boolean(),
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Bootstrap-phase promotion state of one session, folded across compaction epochs. */
    promotionEpoch: PromotionEpoch
  }
}

/** The epoch a session starts in: unpromoted, and predating any compaction. */
const INITIAL_EPOCH: PromotionEpoch = { boundary: null, toolCall: false, assistantMessage: false }

/**
 * Fold one durable event into the current epoch.
 *
 * The fold runs in log order, so a promotion signal that precedes the
 * boundary was already reset when that boundary arrived and needs no
 * sequence comparison here.
 *
 * @param state - the epoch as of the previous event.
 * @param event - the committed durable event.
 * @returns the epoch as of `event`.
 */
function fold(state: PromotionEpoch, event: SessionEvent): PromotionEpoch {
  if (event.type === 'compaction/end') {
    return { boundary: event.seq, toolCall: false, assistantMessage: false }
  }
  if (event.type === 'tool/call') {
    return state.toolCall ? state : { ...state, toolCall: true }
  }
  if (event.type === 'assistant/message') {
    return state.assistantMessage ? state : { ...state, assistantMessage: true }
  }
  return state
}

/**
 * Register the promotion projection on `registry`.
 *
 * The registry reference-counts the key, so the consumer plugins that share
 * this epoch may each call this once; the unit disappears when its last
 * registration is disposed.
 *
 * @param registry - the session projection registry the unit folds into.
 * @returns the exact disposer that unregisters the unit.
 */
export function registerPromotionEpoch(registry: SessionProjectionRegistry): () => void {
  return registry.register({
    key: 'promotionEpoch',
    stateVersion: 1,
    stateSchema: promotionEpochSchema,
    init: () => INITIAL_EPOCH,
    apply: fold,
  })
}

/** Bootstrap phase of one agent, as its consumers read it. */
export interface PromotionStatus {
  /**
   * Sequence of the `compaction/end` that opened the current epoch, or `null`
   * before the session's first compaction.
   */
  readonly boundary: number | null
  /** Whether the configured promotion signal was recorded in this epoch. */
  readonly promoted: boolean
}

/** An agent outside a session reads as promoted: nothing gates a global turn. */
const GLOBAL_STATUS: PromotionStatus = { boundary: null, promoted: true }

/**
 * Read an agent's current bootstrap phase.
 *
 * A subagent (`delegationDepth > 0`) reads as promoted by default, so its
 * first request sees the full catalog and tool set. Pass
 * `includeSubagents` to gate subagents through the same phase as top-level
 * sessions.
 *
 * @param registry - the session projection registry carrying the epoch.
 * @param agent - the assembly or pre-step agent, or `undefined` outside an agent.
 * @param mode - which durable signal promotes this consumer.
 * @param includeSubagents - whether subagents follow the bootstrap phase too.
 * @returns the epoch boundary and whether this consumer's signal promoted it.
 */
export function promotionStatus(
  registry: SessionProjectionRegistry,
  agent: Agent | undefined,
  mode: PromoteOn,
  includeSubagents: boolean,
): PromotionStatus {
  if (agent === undefined) return GLOBAL_STATUS
  const session: Session = agent.session
  if (!includeSubagents && (session.header.delegationDepth ?? 0) > 0) return GLOBAL_STATUS
  const epoch = registry.stateOf(session, 'promotionEpoch')
  if (epoch === undefined) return { boundary: null, promoted: false }
  const promoted = mode === 'tool-call'
    ? epoch.toolCall
    : mode === 'assistant-message'
      ? epoch.assistantMessage
      : epoch.toolCall || epoch.assistantMessage
  return { boundary: epoch.boundary, promoted }
}
