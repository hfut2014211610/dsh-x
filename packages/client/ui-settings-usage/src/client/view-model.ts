/**
 * Pure aggregation of wire-delivered `usageStats` projection rows into the
 * settings panel's GLOBAL view model: whole-list totals, one row per model,
 * and a day-bucketed dot-heatmap series. The panel is session-blind by
 * design — sessions contribute their requests, never their identity. Missing
 * buckets stay `undefined`: an absent count is a reporting gap, not a
 * measured zero, and the panel renders it as `—`.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-usage/view-model
 */

import type { UsageRequestRecord, UsageStatsProjection } from '@deepseek-ai/dsh-usage-stats/client'

/** One session-list row narrowed to what the panel aggregates. */
export interface UsageSessionInput {
  sessionId: string
  /** Display title; the wire may not have one yet. */
  title: string | undefined
  /** Later of creation and the latest human prompt, epoch ms. */
  updatedAt: number
  /** The row's `usageStats` projection value; null when the row carries none. */
  usage: UsageStatsProjection | null
}

/** Token and wall-time sums; optional buckets stay absent when unreported anywhere. */
export interface UsageTotals {
  requests: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens?: number
  outputTokens: number
  reasoningTokens?: number
  llmMs: number
}

/** One model's whole-list aggregate; a null model groups unreported routes. */
export interface ModelUsageRow extends UsageTotals {
  /** Model id the requests ran on; null when the route never landed in the log. */
  model: string | null
}

/** One day bucket of the dot heatmap. */
export interface DayUsage {
  /** Days before the aggregation instant (0 = that day). */
  daysAgo: number
  /** Summed prompt-side tokens (uncached input plus cache traffic) over the day's requests. */
  promptTokens: number
  /** Summed output tokens over the day's requests. */
  outputTokens: number
}

/** The whole panel's view model. */
export interface UsageOverview {
  totals: UsageTotals
  /** Model aggregates, most requests first. */
  models: readonly ModelUsageRow[]
  /** Day buckets covering the newest {@link HEATMAP_WINDOW_DAYS} days, oldest first. */
  days: readonly DayUsage[]
  /** Largest day total inside the window (the heatmap's intensity scale). */
  maxDayTokens: number
  /** Sessions contributing at least one request. */
  sessionsWithUsage: number
}

/** Statistics windows the panel offers; 'all' aggregates the whole log. */
export type UsageRange = 7 | 28 | 90 | 'all'

/** Selectable statistics windows, in panel order. */
export const USAGE_RANGES: readonly UsageRange[] = [7, 28, 90, 'all']

/** Days the dot heatmap covers at most, ending at the aggregation instant's day. */
export const HEATMAP_WINDOW_DAYS = 28

/**
 * Day cells a range draws: its own span, capped at the heatmap window.
 * @param range - the selected statistics window.
 * @returns the number of day cells the heatmap renders.
 */
export const heatmapDaysOf = (range: UsageRange): number =>
  range === 'all' ? HEATMAP_WINDOW_DAYS : Math.min(range, HEATMAP_WINDOW_DAYS)

const DAY_MS = 86_400_000

const emptyTotals = (): UsageTotals => ({
  requests: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  llmMs: 0,
})

/** Prompt-side tokens of one request: uncached input plus cache traffic. */
const promptTokensOf = (usage: UsageRequestRecord['usage']): number =>
  usage === null ? 0 : usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

/** Fold one request's buckets into an accumulator in place. */
const accrue = (totals: UsageTotals, record: UsageRequestRecord): void => {
  totals.requests += 1
  totals.llmMs += record.llmMs ?? 0
  if (record.usage === null) return
  totals.inputTokens += record.usage.inputTokens
  totals.cacheReadTokens += record.usage.cacheReadTokens ?? 0
  totals.outputTokens += record.usage.outputTokens
  if (record.usage.cacheWriteTokens !== undefined) {
    totals.cacheWriteTokens = (totals.cacheWriteTokens ?? 0) + record.usage.cacheWriteTokens
  }
  if (record.usage.reasoningTokens !== undefined) {
    totals.reasoningTokens = (totals.reasoningTokens ?? 0) + record.usage.reasoningTokens
  }
}

/**
 * Aggregate every request into one row per model.
 * @param requests - every session's per-request records.
 * @returns model aggregates, most requests first.
 */
export function modelBreakdown(requests: readonly UsageRequestRecord[]): ModelUsageRow[] {
  const rows = new Map<string | null, UsageTotals>()
  for (const record of requests) {
    const totals = rows.get(record.model) ?? emptyTotals()
    accrue(totals, record)
    rows.set(record.model, totals)
  }
  return [...rows.entries()]
    .map(([model, totals]): ModelUsageRow => ({ model, ...totals }))
    .sort((left, right) => right.requests - left.requests || (left.model ?? '').localeCompare(right.model ?? ''))
}

/**
 * Bucket the requests into day cells covering the newest `windowDays` days
 * before `now`.
 * @param requests - every session's per-request records.
 * @param now - the aggregation instant, epoch ms.
 * @param windowDays - day cells to cover.
 * @returns day buckets oldest first, empty days included, each stamped with
 *   its distance in days from `now`'s day.
 */
export function dailyUsage(requests: readonly UsageRequestRecord[], now: number, windowDays: number): DayUsage[] {
  const days: DayUsage[] = Array.from({ length: windowDays }, (_, index): DayUsage => ({
    daysAgo: windowDays - 1 - index,
    promptTokens: 0,
    outputTokens: 0,
  }))
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS
  for (const record of requests) {
    const daysAgo = Math.floor((todayStart + DAY_MS - 1 - record.time) / DAY_MS)
    if (daysAgo < 0 || daysAgo >= windowDays) continue
    const day = days[windowDays - 1 - daysAgo]
    if (day === undefined) continue
    if (record.usage === null) continue
    day.promptTokens += promptTokensOf(record.usage)
    day.outputTokens += record.usage.outputTokens
  }
  return days
}

/**
 * Build the panel's whole global view model from the session-list rows.
 * @param inputs - every listed session narrowed to its usage facts.
 * @param now - the aggregation instant, epoch ms (default: the call time).
 * @param range - the statistics window (default: the last 28 days).
 * @returns totals, per-model aggregates, and the day heatmap series — all
 *   over the requests whose time falls inside the window.
 */
export function usageOverviewOf(
  inputs: readonly UsageSessionInput[],
  now: number = Date.now(),
  range: UsageRange = 28,
): UsageOverview {
  const windowDays = heatmapDaysOf(range)
  const cutoff = range === 'all' ? -Infinity : now - range * DAY_MS
  const requests: UsageRequestRecord[] = []
  for (const input of inputs) {
    if (input.usage === null) continue
    requests.push(...input.usage.requests)
  }
  const windowed = requests.filter(record => record.time >= cutoff)
  // Session counting follows the same window: a session contributes only
  // while at least one of its requests falls inside it.
  let sessionsWithUsage = 0
  for (const input of inputs) {
    if (input.usage === null) continue
    if (input.usage.requests.some(record => record.time >= cutoff)) sessionsWithUsage += 1
  }
  const totals = emptyTotals()
  for (const record of windowed) accrue(totals, record)
  const days = dailyUsage(windowed, now, windowDays)
  return {
    totals,
    models: modelBreakdown(windowed),
    days,
    maxDayTokens: Math.max(0, ...days.map(day => day.promptTokens + day.outputTokens)),
    sessionsWithUsage,
  }
}

/**
 * Render one token count with k/M scaling.
 * @param tokens - the count to render.
 * @returns the compact count (`999`, `1.2k`, `3.4M`).
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${trimZero(tokens / 1000)}k`
  return `${trimZero(tokens / 1_000_000)}M`
}

/**
 * Render one fractional value with a single decimal, dropping a trailing zero.
 * @param value - the value to render.
 * @returns the trimmed one-decimal string.
 */
function trimZero(value: number): string {
  const fixed = value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

/**
 * Render one wall-time duration.
 * @param ms - the duration in milliseconds.
 * @returns the duration in ms, s, or m.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${trimZero(ms / 1000)} s`
  return `${trimZero(ms / 60_000)} m`
}

/** Heatmap intensity grades: 0 is an empty day, 1–4 fill quadrants of the scale. */
export const MAX_INTENSITY = 4

/**
 * Heatmap intensity grade of one day against the window maximum.
 * @param day - the day bucket.
 * @param maxDayTokens - the window's largest day total.
 * @returns 0 for an empty day, otherwise 1–4 in quadrants of the maximum.
 */
export function intensityOf(day: DayUsage, maxDayTokens: number): number {
  const total = day.promptTokens + day.outputTokens
  if (total <= 0 || maxDayTokens <= 0) return 0
  return Math.min(MAX_INTENSITY, Math.max(1, Math.ceil((total / maxDayTokens) * MAX_INTENSITY)))
}
