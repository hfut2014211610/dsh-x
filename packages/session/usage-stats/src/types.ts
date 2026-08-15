/**
 * Pure types of the usage-stats domain: the ONE home of the `usageStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the command runtime). Host consumers import
 * `./types`; the render face stays value-free so a client compilation face
 * could mirror it without host symbols.
 *
 * @module @deepseek-ai/dsh-usage-stats/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Provider-reported consumption of one model request, folded from the step's
 * logged usage reports. `usage` is null when no report landed (an adapter
 * that reports none, or a request that failed before any usage chunk);
 * request-granularity fields (`llmMs`, `time`) then still describe the
 * attempt when their boundary events exist.
 */
export interface UsageRequestRecord {
  /** Turn the request's step belongs to. */
  readonly turn: number
  /** The request's step within its turn. */
  readonly step: number
  /** Time of the record's latest contributing event, epoch ms. */
  readonly time: number
  /** Provider route the request was dispatched on, from the latest `request/context`. */
  readonly provider: string | null
  /** Model id the request was dispatched on, from the latest `request/context`. */
  readonly model: string | null
  /** Final token accounting, or null when no usage report reached the log. */
  readonly usage: TokenUsage | null
  /** Model wall time (`step/start` → `assistant/message`) in ms, or null when the step assembled no message. */
  readonly llmMs: number | null
}

/**
 * Per-request model consumption for the whole session log. Requests appear in
 * log order; one record exists per step that reported usage or assembled a
 * message, so failed attempts that still streamed a usage chunk stay billed
 * while purely local steps (none today) stay absent.
 */
export interface UsageStatsProjection {
  /** One record per usage-reporting or message-assembling step, in log order. */
  readonly requests: readonly UsageRequestRecord[]
  /** Advertised context window of the latest `request/context`, in tokens; null when never advertised. */
  readonly contextWindow: number | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Per-request model token usage over the whole log; see {@link UsageStatsProjection}. */
    usageStats: UsageStatsProjection
  }
}
