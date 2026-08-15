/**
 * The `usageStats` projection unit: a pure fold of request routes, step
 * boundaries, and logged usage reports into one record per model request.
 *
 * A record exists for every step that reported usage or assembled a message.
 * `assistant/chunk` usage reports create or update the step's record early —
 * so a request that failed after streaming usage stays billed — and the
 * `assistant/message` settles the same record with the final usage and the
 * model wall time (`step/start` → message, the same boundary session-stats
 * sums as `llmMs`). The single-record-per-step upsert relies on the log
 * invariant token-meter also relies on: usage reports for one turn/step are
 * adjacent, so checking the last record decides match-vs-append. Provider and
 * model ride the latest `request/context` (logged only on route or capacity
 * change), which is the request the step actually dispatched on.
 *
 * @module @deepseek-ai/dsh-usage-stats/projection
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { UsageRequestRecord, UsageStatsProjection } from './types.ts'

/** Fold-state twin of {@link UsageRequestRecord}; fields stay writable until the record settles. */
interface MutableUsageRequestRecord {
  turn: number
  step: number
  time: number
  provider: string | null
  model: string | null
  usage: TokenUsage | null
  llmMs: number | null
}

/**
 * Fold state: the records plus the routing and boundary facts they accrue
 * from. Plain JSON per the unit contract (persisted-cache precondition).
 */
interface UsageStatsState {
  requests: MutableUsageRequestRecord[]
  /** The open step's start facts; null outside a step or after its message assembled. */
  openStep: { turn: number; step: number; startTime: number } | null
  /** Route of the latest `request/context`; null before the first. */
  provider: string | null
  model: string | null
  /** Advertised context window of the latest `request/context`; null when never advertised. */
  contextWindow: number | null
}

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
}).strict()

// Cast for the optional usage buckets: under exactOptionalPropertyTypes zod
// infers `number | undefined` where TokenUsage declares absent-or-number
// fields (the same cast token-meter's pressure schema carries).
const usageStatsSchema = z.object({
  requests: z.array(z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().positive(),
    time: z.number(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    usage: tokenUsageSchema.nullable(),
    llmMs: z.number().nonnegative().nullable(),
  }).strict()),
  contextWindow: z.number().int().positive().nullable(),
}).strict() as unknown as z.ZodType<UsageStatsProjection>

/**
 * Create or settle the last record for one step's usage report.
 * @param state - the state covering all prior events.
 * @param time - the reporting event's time.
 * @param turn - the reporting step's turn.
 * @param step - the reporting step's number.
 * @param usage - the reported accounting, or null when this report carries none (a message without usage keeps an earlier chunk's sample).
 * @param llmMs - the settled model wall time, or null when this report cannot supply one.
 * @returns the next state.
 */
function upsertRecord(
  state: UsageStatsState,
  time: number,
  turn: number,
  step: number,
  usage: TokenUsage | null,
  llmMs: number | null,
): UsageStatsState {
  const last = state.requests.at(-1)
  if (last !== undefined && last.turn === turn && last.step === step) {
    const requests = state.requests.slice()
    requests[requests.length - 1] = {
      ...last,
      time,
      usage: usage ?? last.usage,
      ...llmMs === null ? {} : { llmMs },
    }
    return { ...state, requests }
  }
  const record: MutableUsageRequestRecord = {
    turn,
    step,
    time,
    provider: state.provider,
    model: state.model,
    usage,
    llmMs,
  }
  return { ...state, requests: [...state.requests, record] }
}

/** The `usageStats` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const usageStatsProjectionDefinition: ProjectionDefinition<'usageStats', UsageStatsState> = {
  key: 'usageStats',
  schema: usageStatsSchema,
  init: () => ({ requests: [], openStep: null, provider: null, model: null, contextWindow: null }),
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    switch (event.type) {
      case 'step/start':
        return {
          ...state,
          openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time },
        }
      case 'request/context': {
        const provider = event.data.provider
        const model = event.data.model
        const contextWindow = event.data.contextWindow ?? null
        return provider === state.provider && model === state.model && contextWindow === state.contextWindow
          ? state
          : { ...state, provider, model, contextWindow }
      }
      case 'assistant/chunk': {
        if (event.data.chunk.type !== 'usage') return state
        return upsertRecord(state, event.time, event.data.turn, event.data.step, event.data.chunk.usage, null)
      }
      case 'assistant/message': {
        const open = state.openStep
        const llmMs = open !== null && open.turn === event.data.turn && open.step === event.data.step
          ? Math.max(0, event.time - open.startTime)
          : null
        const upserted = upsertRecord(
          state,
          event.time,
          event.data.turn,
          event.data.step,
          event.data.usage ?? null,
          llmMs,
        )
        // One assembled message per step closes the boundary; a defensive
        // duplicate message against a closed boundary keeps the first llmMs.
        return llmMs === null ? upserted : { ...upserted, openStep: null }
      }
      default:
        return state
    }
  },
  view: state => ({
    requests: state.requests.map((record): UsageRequestRecord => ({ ...record })),
    contextWindow: state.contextWindow,
  }),
  stateVersion: 1,
}
