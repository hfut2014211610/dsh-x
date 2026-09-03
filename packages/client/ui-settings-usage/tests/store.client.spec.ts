/** Usage settings store: the session-list join, failure handling, and generation overwrite. */

import { describe, expect, it } from 'vitest'
import { UsageSettingsStore } from '../src/client/store.ts'

type ListValue = { items: unknown[]; cursor?: string }
type ListResponse =
  | { ok: true; value: ListValue }
  | { ok: false; error: { code: string; message: string } }

/** A scripted session-list face behind the store's `ctx.remote.session`. */
function scriptedCtx(scripted: {
  list?: () => Promise<ListResponse>
}): never {
  return {
    remote: {
      session: {
        // The store only calls list; the remaining faces are unreachable stubs.
        list: scripted.list ?? (() => Promise.resolve({ ok: true, value: { items: [] } } as ListResponse)),
      },
    },
  } as never
}

const okList = (items: unknown[]): ListResponse =>
  ({ ok: true, value: { items } })

/** One wire row carrying the projections the panel aggregates. */
function row(sessionId: string, updatedAt: number, values?: Record<string, unknown>): unknown {
  return {
    sessionId,
    updatedAt,
    running: false,
    blank: false,
    ...(values === undefined ? {} : { projections: { asOfSeq: 4, values } }),
  }
}

describe('UsageSettingsStore', () => {
  it('loads idle → loading → ready and aggregates the projection rows', async () => {
    const controller = new UsageSettingsStore(scriptedCtx({
      list: () => Promise.resolve(okList([
        row('s1', 3, {
          title: 'first chat',
          usageStats: {
            requests: [
              { turn: 1, step: 1, time: Date.now() - 1_000, provider: 'p', model: 'm', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }, llmMs: 40 },
            ],
            contextWindow: 128_000,
          },
        }),
        row('s2', 1),
      ])),
    }))
    expect(controller.store.getSnapshot().status).toBe('idle')
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.overview.sessionsWithUsage).toBe(1)
    expect(state.overview.models[0]).toMatchObject({ model: 'm', requests: 1 })
    expect(state.overview.totals.requests).toBe(1)
  })

  it('surfaces a business rejection and keeps the last good overview', async () => {
    let fail = false
    const controller = new UsageSettingsStore(scriptedCtx({
      list: () => fail
        ? Promise.resolve({ ok: false, error: { code: 'X', message: 'denied' } } as ListResponse)
        : Promise.resolve(okList([
          row('s1', 1, {
            usageStats: {
              requests: [
                { turn: 1, step: 1, time: Date.now() - 1_000, provider: 'p', model: 'm', usage: { inputTokens: 5, outputTokens: 5 }, llmMs: 10 },
              ],
              contextWindow: null,
            },
          }),
        ])),
    }))
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    fail = true
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('denied')
    expect(state.overview.sessionsWithUsage).toBe(1)
  })

  it('setRange re-aggregates the last good rows without wire traffic', async () => {
    let calls = 0
    const controller = new UsageSettingsStore(scriptedCtx({
      list: () => {
        calls += 1
        return Promise.resolve(okList([
          row('s1', 1, {
            usageStats: {
              requests: [
                { turn: 1, step: 1, time: Date.now() - 86_400_000, provider: 'p', model: 'm', usage: { inputTokens: 11, outputTokens: 3 }, llmMs: 40 },
                { turn: 1, step: 2, time: Date.now() - 9 * 86_400_000, provider: 'p', model: 'm', usage: { inputTokens: 9, outputTokens: 9 }, llmMs: 60 },
              ],
              contextWindow: null,
            },
          }),
        ]))
      },
    }))
    await controller.load()
    expect(calls).toBe(1)
    expect(controller.store.getSnapshot().overview.totals.requests).toBe(2)
    expect(controller.store.getSnapshot().range).toBe(28)

    controller.setRange(7)
    expect(calls).toBe(1)
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', range: 7 })
    expect(controller.store.getSnapshot().overview.totals.requests).toBe(1)
    expect(controller.store.getSnapshot().overview.days).toHaveLength(7)

    controller.setRange('all')
    expect(controller.store.getSnapshot().overview.totals.requests).toBe(2)
    expect(controller.store.getSnapshot().overview.days).toHaveLength(28)
  })

  it('keeps a transport failure message and skips stale generations', async () => {
    const controller = new UsageSettingsStore(scriptedCtx({
      list: () => Promise.reject(new Error('offline')),
    }))
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slowRow = row('slow', 1, {
      usageStats: {
        requests: [
          { turn: 1, step: 1, time: Date.now() - 1_000, provider: 'p', model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, llmMs: 5 },
        ],
        contextWindow: null,
      },
    })
    const slow = scriptedCtx({
      list: () => gate.then(() => okList([slowRow])),
    })
    const racing = new UsageSettingsStore(slow)
    const first = racing.load()
    const second = racing.load()
    release?.()
    await first
    await second
    // The earlier response of the pair resolves against the newer generation
    // and must not overwrite it; the final snapshot is the second load's.
    expect(racing.store.getSnapshot().overview.sessionsWithUsage).toBe(1)
  })
})
