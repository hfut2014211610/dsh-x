/**
 * The `usageStats` projection unit: mounting the plugin beside the projection
 * registry (and the command runtime its inject waits on) serves one record per
 * model request folded from request routes, step boundaries, usage chunks, and
 * assembled messages; a request that streamed usage and then failed stays
 * billed through its chunk sample; compositions without the plugin are
 * unaffected and unmounting removes the key (HMR safety). Upsert and timing
 * math run against the exported definition directly, where event times are
 * controlled.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as UsageStatsPlugin from '@deepseek-ai/dsh-usage-stats'
import { usageStatsProjectionDefinition } from '@deepseek-ai/dsh-usage-stats/src/projection.ts'
import type { UsageStatsProjection } from '@deepseek-ai/dsh-usage-stats/types'

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlugin) await ctx.plugin(UsageStatsPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('usage')) }
}

const message = createMessage({
  role: 'assistant',
  content: [{ type: 'text', text: 'answer' }],
  source: { kind: 'model', provider: 'mock', model: 'mock' },
})

describe('usageStats projection unit (registry drive)', () => {
  it('serves an empty value on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.usageStats).toEqual({
      requests: [],
      contextWindow: null,
    })
  })

  it('settles one record per request: chunk sample, message final usage, route, and wall time', async () => {
    const { ctx, session } = await harness(true)
    session.append('request/context', { provider: 'deepseek-official', model: 'flash', contextWindow: 128_000 })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } } })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message,
      usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 },
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const value = ctx.sessionProjections.snapshot(session).values.usageStats
    expect(value?.requests).toHaveLength(1)
    expect(value?.requests[0]).toMatchObject({
      turn: 1,
      step: 1,
      provider: 'deepseek-official',
      model: 'flash',
      usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 },
    })
    expect(value?.contextWindow).toBe(128_000)
  })

  it('keeps a failed request billed through its usage chunk with null wall time', async () => {
    const { ctx, session } = await harness(true)
    session.append('request/context', { provider: 'p', model: 'm' })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } } })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    const record = ctx.sessionProjections.snapshot(session).values.usageStats?.requests[0]
    expect(record).toMatchObject({ turn: 1, step: 1, provider: 'p', usage: { inputTokens: 10, outputTokens: 2 } })
    expect(record?.llmMs).toBeNull()
  })

  it('has no usageStats key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('usageStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(UsageStatsPlugin)
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 1, outputTokens: 1 } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(ctx.sessionProjections.snapshot(session).values.usageStats?.requests).toHaveLength(1)
    await fiber.dispose()
    expect('usageStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

/** Fold a synthetic event list through the definition and view the result. */
function fold(events: readonly SessionEvent[]): UsageStatsProjection {
  const state = events.reduce(
    (folded, event) => usageStatsProjectionDefinition.apply(folded, event),
    usageStatsProjectionDefinition.init(),
  )
  return usageStatsProjectionDefinition.view(state)
}

describe('usageStats fold (controlled timestamps)', () => {
  it('measures model wall time from step start to message and stamps the message time', () => {
    expect(fold([
      at(1_000, 'request/context', { provider: 'p', model: 'm', contextWindow: 128_000 }),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_800, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 } } }),
      at(4_800, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 5, outputTokens: 1 } }),
    ])).toEqual({
      requests: [{ turn: 1, step: 1, time: 4_800, provider: 'p', model: 'm', usage: { inputTokens: 5, outputTokens: 1 }, llmMs: 3_800 }],
      contextWindow: 128_000,
    })
  })

  it('keeps a message without usage on the chunk sample and a duplicate message keeps the first wall time', () => {
    const settled = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 1 } } }),
      at(2_500, 'assistant/message', { turn: 1, step: 1, message }),
      // Defensive duplicate: no open boundary anymore, so llmMs stays the
      // first message's and only the stamp moves.
      at(3_000, 'assistant/message', { turn: 1, step: 1, message }),
    ])
    expect(settled.requests).toEqual([
      { turn: 1, step: 1, time: 3_000, provider: null, model: null, usage: { inputTokens: 5, outputTokens: 1 }, llmMs: 1_500 },
    ])
  })

  it('appends one record per step and rides route changes from request/context', () => {
    expect(fold([
      at(1_000, 'request/context', { provider: 'p1', model: 'm1' }),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(2_000, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 1, outputTokens: 1 } }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      at(3_100, 'request/context', { provider: 'p2', model: 'm2', contextWindow: 64_000 }),
      at(4_000, 'assistant/message', { turn: 1, step: 2, message, usage: { inputTokens: 2, outputTokens: 2 } }),
      at(5_000, 'step/start', { turn: 2, step: 1 }),
      at(6_000, 'assistant/message', { turn: 2, step: 1, message }),
    ])).toEqual({
      requests: [
        { turn: 1, step: 1, time: 2_000, provider: 'p1', model: 'm1', usage: { inputTokens: 1, outputTokens: 1 }, llmMs: 1_000 },
        { turn: 1, step: 2, time: 4_000, provider: 'p2', model: 'm2', usage: { inputTokens: 2, outputTokens: 2 }, llmMs: 1_000 },
        { turn: 2, step: 1, time: 6_000, provider: 'p2', model: 'm2', usage: null, llmMs: 1_000 },
      ],
      contextWindow: 64_000,
    })
  })

  it('treats a repeated identical request/context as no change', () => {
    const init = usageStatsProjectionDefinition.init()
    const first = usageStatsProjectionDefinition.apply(init, at(1, 'request/context', { provider: 'p', model: 'm' }))
    // Same route and window fold to the same reference (Object.is gates the change feed).
    expect(usageStatsProjectionDefinition.apply(first, at(2, 'request/context', { provider: 'p', model: 'm' }))).toBe(first)
    expect(usageStatsProjectionDefinition.view(first).contextWindow).toBeNull()
  })

  it('clears the window when a later request/context omits it', () => {
    const init = usageStatsProjectionDefinition.init()
    const withWindow = usageStatsProjectionDefinition.apply(
      init,
      at(1, 'request/context', { provider: 'p', model: 'm', contextWindow: 1_000 }),
    )
    const cleared = usageStatsProjectionDefinition.apply(withWindow, at(2, 'request/context', { provider: 'p', model: 'm' }))
    expect(usageStatsProjectionDefinition.view(cleared).contextWindow).toBeNull()
  })

  it('ignores non-usage chunks and clamps negative clock skew to zero', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_200, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      at(500, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 1, outputTokens: 1 } }),
    ])).toEqual({
      requests: [{ turn: 1, step: 1, time: 500, provider: null, model: null, usage: { inputTokens: 1, outputTokens: 1 }, llmMs: 0 }],
      contextWindow: null,
    })
  })
})
