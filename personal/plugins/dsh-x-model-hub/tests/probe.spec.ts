import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { probeRoutes, resolveProbeRoutes } from '../src/index.ts'

/** A fake stream emitting the given chunks. */
const streamOf = (chunks: StreamChunk[]) => async function* (): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

const finishOk: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
const finishError = (code: string, message: string): StreamChunk => ({
  type: 'finish',
  reason: { kind: 'error', failure: { message, code } },
})

describe('probeRoutes', () => {
  it('reports ok with latency for a clean stream', async () => {
    const [result] = await probeRoutes(() => streamOf([finishOk])(), 'm', ['gw'])
    expect(result).toMatchObject({ route: 'gw', ok: true })
    expect(result!.ms).toBeGreaterThanOrEqual(0)
  })

  it('reports the terminal failure code and message without throwing', async () => {
    const [result] = await probeRoutes(() => streamOf([finishError('RATE_LIMIT', 'slow down')])(), 'm', ['gw'])
    expect(result).toMatchObject({ route: 'gw', ok: false, code: 'RATE_LIMIT', message: 'slow down' })
  })

  it('maps an aborted terminal chunk to a failure', async () => {
    const [result] = await probeRoutes(
      () => streamOf([{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'TIMEOUT' } } }])(),
      'm',
      ['gw'],
    )
    expect(result).toMatchObject({ ok: false, code: 'TIMEOUT' })
  })

  it('contains a dispatch throw into the route result', async () => {
    const [result] = await probeRoutes(
      () => {
        throw new Error('NO_ADAPTER')
      },
      'm',
      ['ghost'],
    )
    expect(result).toMatchObject({ route: 'ghost', ok: false, message: 'NO_ADAPTER' })
  })

  it('probes every route in parallel and preserves input order', async () => {
    const results = await probeRoutes(
      options => streamOf([
        options.provider === 'good' ? finishOk : finishError('TRANSPORT', 'Connection error.'),
      ])(),
      'm',
      ['good', 'bad'],
    )
    expect(results.map(result => [result.route, result.ok])).toEqual([['good', true], ['bad', false]])
  })
})

describe('resolveProbeRoutes', () => {
  const doc = {
    providers: {
      gw: { baseURL: 'http://localhost/v1' },
      backup: { baseURL: 'http://backup/v1' },
    },
    models: {
      'model-a': {
        provider: 'gw',
        api: 'openai-completions',
        fallbacks: [{ provider: 'backup', api: 'openai-completions' }],
      },
    },
  }

  it('throws when no compiled route lists the model', () => {
    expect(() => resolveProbeRoutes(doc, 'ghost', ['gw', 'backup'])).toThrow(/no compiled route lists model "ghost"/)
  })

  it('plans a real probe for every live route in compiled order', () => {
    expect(resolveProbeRoutes(doc, 'model-a', ['gw', 'backup'])).toEqual([{ route: 'gw' }, { route: 'backup' }])
  })

  it('answers a stale route with the pending reconcile failure', () => {
    const plan = resolveProbeRoutes(doc, 'model-a', ['gw'], 'compat refused')
    expect(plan[0]).toEqual({ route: 'gw' })
    expect(plan[1]).toMatchObject({
      route: 'backup',
      stale: {
        ok: false,
        code: 'ROUTE_NOT_LIVE',
        message: 'route not live: llm-pi-ai refused the compiled routes — compat refused',
      },
    })
  })

  it('notes a stale route generically when no reconcile failure is pending', () => {
    const plan = resolveProbeRoutes(doc, 'model-a', ['gw'])
    expect(plan[1]!.stale!.message).toContain('no adapter registered')
  })
})
