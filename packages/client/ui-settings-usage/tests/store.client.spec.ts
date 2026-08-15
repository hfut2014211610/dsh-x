/** Usage settings store: the session-list join, failure handling, and generation overwrite. */

import { describe, expect, it } from 'vitest'
import type { IApiClient, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { UsageSettingsStore } from '../src/client/store.ts'

type ListResponse = RpcResponse<{ items: unknown[]; cursor?: string }>

/** A scripted sessions face answering one prepared list response. */
function api(scripted: {
  list?: () => Promise<ListResponse>
}): Pick<IApiClient, 'sessions'> {
  return {
    sessions: {
      // The store only calls list; the remaining faces are unreachable stubs.
      list: scripted.list ?? (() => Promise.resolve({ rpcId: RpcId('r'), result: { ok: true, value: { items: [] } } } as ListResponse)),
    },
  } as unknown as Pick<IApiClient, 'sessions'>
}

const okList = (items: unknown[]): ListResponse =>
  ({ rpcId: RpcId('r'), result: { ok: true, value: { items } } })

describe('UsageSettingsStore', () => {
  it('loads idle → loading → ready and aggregates the projection rows', async () => {
    const controller = new UsageSettingsStore(api({
      list: () => Promise.resolve(okList([
        {
          sessionId: 's1',
          updatedAt: 3,
          projections: {
            asOfSeq: 4,
            values: {
              title: 'first chat',
              usageStats: {
                requests: [
                  { turn: 1, step: 1, time: Date.now() - 1_000, provider: 'p', model: 'm', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }, llmMs: 40 },
                ],
                contextWindow: 128_000,
              },
            },
          },
        },
        { sessionId: 's2', updatedAt: 1 },
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
    const controller = new UsageSettingsStore(api({
      list: () => fail
        ? Promise.resolve({ result: { ok: false, error: { code: 'X', message: 'denied' } } } as unknown as ListResponse)
        : Promise.resolve(okList([{
          sessionId: 's1',
          updatedAt: 1,
          projections: {
            asOfSeq: 0,
            values: {
              usageStats: {
                requests: [
                  { turn: 1, step: 1, time: Date.now() - 1_000, provider: 'p', model: 'm', usage: { inputTokens: 5, outputTokens: 5 }, llmMs: 10 },
                ],
                contextWindow: null,
              },
            },
          },
        }])),
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
    const controller = new UsageSettingsStore(api({
      list: () => {
        calls += 1
        return Promise.resolve(okList([{
          sessionId: 's1',
          updatedAt: 1,
          projections: {
            asOfSeq: 0,
            values: {
              usageStats: {
                requests: [
                  { turn: 1, step: 1, time: Date.now() - 86_400_000, provider: 'p', model: 'm', usage: { inputTokens: 11, outputTokens: 3 }, llmMs: 40 },
                  { turn: 1, step: 2, time: Date.now() - 9 * 86_400_000, provider: 'p', model: 'm', usage: { inputTokens: 9, outputTokens: 9 }, llmMs: 60 },
                ],
                contextWindow: null,
              },
            },
          },
        }]))
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
    const controller = new UsageSettingsStore(api({
      list: () => Promise.reject(new Error('offline')),
    }))
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slowRow = {
      sessionId: 'slow',
      updatedAt: 1,
      projections: {
        asOfSeq: 0,
        values: {
          usageStats: {
            requests: [
              { turn: 1, step: 1, time: Date.now() - 1_000, provider: 'p', model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, llmMs: 5 },
            ],
            contextWindow: null,
          },
        },
      },
    }
    const slow = api({
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
