/** Global view-model aggregation: totals, per-model breakdown, day-bucketed heatmap series, formatters. */

import { describe, expect, it } from 'vitest'
import type { UsageRequestRecord, UsageStatsProjection } from '@deepseek-ai/dsh-usage-stats/client'
import {
  HEATMAP_WINDOW_DAYS, dailyUsage, formatDuration, formatTokens, heatmapDaysOf, intensityOf,
  modelBreakdown, usageOverviewOf,
} from '../src/client/view-model.ts'
import type { UsageSessionInput } from '../src/client/view-model.ts'

const DAY_MS = 86_400_000
/** A fixed aggregation instant: 2026-08-15 mid-day. */
const NOW = Date.UTC(2026, 7, 15, 12)

const record = (overrides: Partial<UsageRequestRecord>): UsageRequestRecord => ({
  turn: 1,
  step: 1,
  time: NOW,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  usage: null,
  llmMs: null,
  ...overrides,
})

describe('modelBreakdown', () => {
  it('aggregates one row per model, most requests first, unreported routes grouped under null', () => {
    const rows = modelBreakdown([
      record({ usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }, llmMs: 400 }),
      record({ model: 'deepseek-v4-pro', usage: { inputTokens: 5, outputTokens: 5 } }),
      record({ model: 'deepseek-v4-pro', usage: { inputTokens: 6, outputTokens: 6, reasoningTokens: 1 }, llmMs: 1_200 }),
      record({ model: null, usage: null }),
    ])
    expect(rows).toEqual([
      {
        model: 'deepseek-v4-pro',
        requests: 2,
        inputTokens: 11,
        cacheReadTokens: 0,
        outputTokens: 11,
        reasoningTokens: 1,
        llmMs: 1_200,
      },
      {
        model: null,
        requests: 1,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        llmMs: 0,
      },
      {
        model: 'deepseek-v4-flash',
        requests: 1,
        inputTokens: 11,
        cacheReadTokens: 2,
        outputTokens: 3,
        llmMs: 400,
      },
    ])
    // cacheWriteTokens stays absent: no request reported it anywhere.
    expect('cacheWriteTokens' in rows[0]!).toBe(false)
  })
})

describe('dailyUsage', () => {
  it('buckets by calendar day inside the window, filling empty days oldest first', () => {
    const days = dailyUsage([
      record({ time: NOW - 2 * DAY_MS, usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }),
      record({ time: NOW - 2 * DAY_MS - 3_600_000, usage: { inputTokens: 7, outputTokens: 5 } }),
      record({ time: NOW, usage: { inputTokens: 1, outputTokens: 1 } }),
      record({ time: NOW - 40 * DAY_MS, usage: { inputTokens: 999, outputTokens: 999 } }),
      record({ time: NOW + DAY_MS, usage: { inputTokens: 5, outputTokens: 5 } }),
      record({ time: NOW - DAY_MS, usage: null }),
    ], NOW, HEATMAP_WINDOW_DAYS)
    expect(days).toHaveLength(HEATMAP_WINDOW_DAYS)
    // Days outside the window (40 days ago, tomorrow) and unreported requests drop.
    const byAgo = new Map(days.map(day => [day.daysAgo, day]))
    expect(byAgo.get(0)).toMatchObject({ promptTokens: 1, outputTokens: 1 })
    expect(byAgo.get(1)).toMatchObject({ promptTokens: 0, outputTokens: 0 })
    expect(byAgo.get(2)).toMatchObject({ promptTokens: 20, outputTokens: 8 })
    expect(days.at(-1)?.daysAgo).toBe(0)
    expect(days[0]?.daysAgo).toBe(HEATMAP_WINDOW_DAYS - 1)
  })

  it('grades intensity in quadrants of the busiest day, 0 for empty days', () => {
    const days = dailyUsage([
      record({ time: NOW, usage: { inputTokens: 100, outputTokens: 0 } }),
      record({ time: NOW - DAY_MS, usage: { inputTokens: 40, outputTokens: 10 } }),
      record({ time: NOW - 2 * DAY_MS, usage: { inputTokens: 1, outputTokens: 0 } }),
    ], NOW, HEATMAP_WINDOW_DAYS)
    // Busiest day is today at 100; yesterday at 50 grades half → 2.
    expect(intensityOf(days.at(-1)!, 100)).toBe(4)
    expect(intensityOf(days.at(-2)!, 100)).toBe(2)
    expect(intensityOf(days.at(-3)!, 100)).toBe(1)
    expect(intensityOf(days.at(-4)!, 100)).toBe(0)
    expect(intensityOf(days.at(-1)!, 0)).toBe(0)
  })
})

describe('usageOverviewOf', () => {
  const usage = (requests: readonly UsageRequestRecord[]): UsageStatsProjection =>
    ({ requests, contextWindow: null })
  const input = (sessionId: string, requests: readonly UsageRequestRecord[]): UsageSessionInput =>
    ({ sessionId, title: sessionId, updatedAt: 1, usage: usage(requests) })

  it('joins every session into one global overview, dropping usage-less rows', () => {
    const overview = usageOverviewOf([
      input('a', [
        record({ usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }, llmMs: 400 }),
      ]),
      { sessionId: 'none', title: undefined, updatedAt: 2, usage: null },
      input('b', [
        record({ model: 'deepseek-v4-pro', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 }, llmMs: 1_200 }),
      ]),
    ], NOW, HEATMAP_WINDOW_DAYS)
    expect(overview.totals).toEqual({
      requests: 2,
      inputTokens: 18,
      cacheReadTokens: 2,
      outputTokens: 8,
      reasoningTokens: 1,
      llmMs: 1_600,
    })
    expect(overview.sessionsWithUsage).toBe(2)
    expect(overview.models.map(row => row.model)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(overview.days).toHaveLength(HEATMAP_WINDOW_DAYS)
  })

  it('renders an empty overview for an empty list', () => {
    expect(usageOverviewOf([], NOW, HEATMAP_WINDOW_DAYS)).toEqual({
      totals: { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, llmMs: 0 },
      models: [],
      days: Array.from({ length: HEATMAP_WINDOW_DAYS }, (_, index): unknown => ({
        daysAgo: HEATMAP_WINDOW_DAYS - 1 - index,
        promptTokens: 0,
        outputTokens: 0,
      })),
      maxDayTokens: 0,
      sessionsWithUsage: 0,
    })
  })
})

describe('range filtering', () => {
  const usage = (requests: readonly UsageRequestRecord[]): UsageStatsProjection =>
    ({ requests, contextWindow: null })
  const input = (sessionId: string, requests: readonly UsageRequestRecord[]): UsageSessionInput =>
    ({ sessionId, title: sessionId, updatedAt: 1, usage: usage(requests) })
  const requests = [
    record({ time: NOW - 2 * DAY_MS, usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }),
    record({ time: NOW - 9 * DAY_MS, model: 'deepseek-v4-pro', usage: { inputTokens: 9, outputTokens: 9 } }),
  ]

  it('aggregates only the requests inside the window and shrinks the dot grid with it', () => {
    const week = usageOverviewOf([input('a', requests)], NOW, 7)
    expect(week.totals).toMatchObject({ requests: 1, inputTokens: 11, outputTokens: 3 })
    expect(week.sessionsWithUsage).toBe(1)
    expect(week.days).toHaveLength(7)
    expect(week.models.map(row => row.model)).toEqual(['deepseek-v4-flash'])

    const fortnightPlus = usageOverviewOf([input('a', requests)], NOW, 28)
    expect(fortnightPlus.totals).toMatchObject({ requests: 2, inputTokens: 20, outputTokens: 12 })
    expect(fortnightPlus.days).toHaveLength(28)

    const all = usageOverviewOf([input('a', requests)], NOW, 'all')
    expect(all.totals).toMatchObject({ requests: 2, inputTokens: 20, outputTokens: 12 })
    // 'all' still draws the capped 28-dot grid.
    expect(all.days).toHaveLength(28)
  })

  it('drops a session whose every request falls outside the window', () => {
    const oldOnly = [record({ time: NOW - 9 * DAY_MS, usage: { inputTokens: 9, outputTokens: 9 } })]
    expect(usageOverviewOf([input('a', oldOnly)], NOW, 7).sessionsWithUsage).toBe(0)
  })

  it('heatmapDaysOf caps the grid at the heatmap window', () => {
    expect(heatmapDaysOf(7)).toBe(7)
    expect(heatmapDaysOf(28)).toBe(28)
    expect(heatmapDaysOf(90)).toBe(28)
    expect(heatmapDaysOf('all')).toBe(28)
  })
})

describe('formatters', () => {
  it('scales token counts', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_307)).toBe('1.3k')
    expect(formatTokens(5_003)).toBe('5k')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })

  it('scales durations through ms, s, and m', () => {
    expect(formatDuration(450)).toBe('450 ms')
    expect(formatDuration(1_200)).toBe('1.2 s')
    expect(formatDuration(90_000)).toBe('1.5 m')
  })
})
