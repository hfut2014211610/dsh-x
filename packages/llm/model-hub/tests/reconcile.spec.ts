import { describe, expect, it } from 'vitest'
import type { SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { diffRouteOps, reconcileRoutes } from '../src/index.ts'

const settingsCapture = (failWith?: Error) => {
  const calls: { ns: SettingsNamespace; ops: SettingsPathOp[] }[] = []
  return {
    calls,
    settings: {
      mutate: async (ns: SettingsNamespace, ops: readonly SettingsPathOp[]) => {
        if (failWith !== undefined) throw failWith
        calls.push({ ns, ops: [...ops] })
      },
    },
  }
}

describe('diffRouteOps', () => {
  it('unsets only previously generated routes that disappeared', () => {
    const ops = diffRouteOps({ gw: { baseURL: 'http://x/v1', models: [] } }, ['gw', 'gw~old'])
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'gw~old'] },
      { op: 'set', path: ['providers', 'gw'], value: { baseURL: 'http://x/v1', models: [] } },
    ])
  })

  it('never unsets keys it did not generate', () => {
    const ops = diffRouteOps({}, ['mine'])
    expect(ops).toEqual([{ op: 'unset', path: ['providers', 'mine'] }])
    // A hand-written route ("hand-written" was never in the ledger) is untouched:
    expect(diffRouteOps({}, [])).toEqual([])
  })
})

describe('reconcileRoutes', () => {
  const profile = { baseURL: 'http://x/v1', displayName: 'gw', api: 'openai-completions', models: [{ id: 'm' }] }

  it('writes routes and the ledger on the first pass', async () => {
    const { calls, settings } = settingsCapture()
    const result = await reconcileRoutes(settings, {
      providers: { gw: { baseURL: 'http://x/v1' } },
      models: { m: { provider: 'gw', api: 'openai-completions' } },
    })
    expect(result.changed).toBe(true)
    expect(calls).toHaveLength(2)
    expect(String(calls[0]!.ns)).toBe('llm-pi-ai')
    expect(calls[0]!.ops).toEqual([{ op: 'set', path: ['providers', 'gw'], value: profile }])
    expect(String(calls[1]!.ns)).toBe('dsh-x-model-hub')
    expect(calls[1]!.ops).toEqual([{ op: 'set', path: ['_routes'], value: ['gw'] }])
  })

  it('is a no-op when the ledger already matches the compiled routes', async () => {
    const { calls, settings } = settingsCapture()
    const result = await reconcileRoutes(settings, {
      providers: { gw: { baseURL: 'http://x/v1' } },
      models: { m: { provider: 'gw', api: 'openai-completions' } },
      _routes: ['gw'],
    })
    // The upsert op is still emitted (values may have changed), but the ledger is not rewritten.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.ops).toEqual([{ op: 'set', path: ['providers', 'gw'], value: profile }])
    expect(result.changed).toBe(true)
  })

  it('retracts stale generated routes and updates the ledger', async () => {
    const { calls, settings } = settingsCapture()
    // Same provider, protocol switched: single-protocol rule renames the
    // generated route back to the bare provider key.
    await reconcileRoutes(settings, {
      providers: { gw: { baseURL: 'http://x/v1' } },
      models: { m: { provider: 'gw', api: 'anthropic-messages' } },
      _routes: ['gw', 'gw~anthropic-messages'],
    })
    expect(calls[0]!.ops).toHaveLength(2)
    expect(calls[0]!.ops[0]).toEqual({ op: 'unset', path: ['providers', 'gw~anthropic-messages'] })
    expect(calls[0]!.ops[1]).toMatchObject({
      op: 'set',
      path: ['providers', 'gw'],
      value: { api: 'anthropic-messages' },
    })
    expect(calls[1]!.ops).toEqual([{ op: 'set', path: ['_routes'], value: ['gw'] }])
  })

  it('writes nothing when everything is empty and nothing was generated', async () => {
    const { calls, settings } = settingsCapture()
    const result = await reconcileRoutes(settings, { providers: {}, models: {}, _routes: [] })
    expect(result.changed).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('propagates a settings rejection', async () => {
    const { settings } = settingsCapture(new Error('settings-rejected: unserviceable'))
    await expect(reconcileRoutes(settings, {
      providers: { gw: { baseURL: 'http://x/v1' } },
      models: { m: { provider: 'gw', api: 'openai-completions' } },
    })).rejects.toThrow(/settings-rejected/)
  })
})
