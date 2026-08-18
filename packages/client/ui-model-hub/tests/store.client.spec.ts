import { describe, expect, it } from 'vitest'
import { deriveKeyRef, ModelHubStore, providersInUse, routeNameFor } from '../src/client/store.ts'

describe('routeNameFor', () => {
  it('keeps the bare provider key for a single-protocol provider', () => {
    const models = {
      a: { provider: 'gw', api: 'openai-completions' },
      b: { provider: 'gw', api: 'openai-completions' },
    }
    expect(routeNameFor(models, 'gw', 'openai-completions')).toBe('gw')
  })

  it('suffixes the protocol when the provider spans protocols', () => {
    const models = {
      a: { provider: 'gw', api: 'openai-completions' },
      b: { provider: 'gw', api: 'anthropic-messages' },
    }
    expect(routeNameFor(models, 'gw', 'openai-completions')).toBe('gw~openai-completions')
    expect(routeNameFor(models, 'gw', 'anthropic-messages')).toBe('gw~anthropic-messages')
  })

  it('ignores models on other providers', () => {
    const models = {
      a: { provider: 'gw', api: 'openai-completions' },
      b: { provider: 'elsewhere', api: 'anthropic-messages' },
    }
    expect(routeNameFor(models, 'gw', 'openai-completions')).toBe('gw')
  })

  it('counts fallback placements toward a provider’s protocol diversity', () => {
    const models = {
      a: { provider: 'gw', api: 'openai-completions', fallbacks: [{ provider: 'gw', api: 'anthropic-messages' }] },
    }
    expect(routeNameFor(models, 'gw', 'openai-completions')).toBe('gw~openai-completions')
    expect(routeNameFor(models, 'gw', 'anthropic-messages')).toBe('gw~anthropic-messages')
  })
})

describe('providersInUse', () => {
  it('collects the provider set referenced by models', () => {
    expect([...providersInUse({
      a: { provider: 'gw', api: 'openai-completions' },
      b: { provider: 'elsewhere', api: 'openai-completions' },
    })].sort()).toEqual(['elsewhere', 'gw'])
    expect(providersInUse({}).size).toBe(0)
  })
})

describe('ModelHubStore', () => {
  const doc = {
    providers: { gw: { baseURL: 'http://x/v1' } },
    models: { m: { provider: 'gw', api: 'openai-completions' } },
    writable: true,
    revision: 7,
  }
  const fakeRpc = (writeResult: { ok: true } | { ok: false; error: { message: string } } = { ok: true }) => {
    const calls: { path: string; endpoint: string; args: Record<string, unknown> }[] = []
    return {
      calls,
      rpc: {
        call: async (path: string, endpoint: string, payload: { args: Record<string, unknown> }) => {
          calls.push({ path, endpoint, args: payload.args })
          if (endpoint === 'modelHub/getDoc') return { ok: true as const, value: doc }
          // Presets land on the first load only; the non-empty answer keeps
          // later reloads from refetching, so call indexes below stay stable.
          if (endpoint === 'modelHub/listPresets') {
            return { ok: true as const, value: { presets: [{ key: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', models: [] }] } }
          }
          return writeResult.ok ? { ok: true as const, value: { ok: true } } : { ok: false as const, error: writeResult.error }
        },
      },
    }
  }

  it('loads providers and models from the gateway payload', async () => {
    const { rpc, calls } = fakeRpc()
    const store = new ModelHubStore(rpc)
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(Object.keys(snapshot.providers)).toEqual(['gw'])
    expect(Object.keys(snapshot.models)).toEqual(['m'])
    expect(snapshot.revision).toBe(7)
    expect(snapshot.writable).toBe(true)
    expect(snapshot.presets.map(preset => preset.key)).toEqual(['deepseek'])
    expect(calls[0]).toEqual({ path: '/api', endpoint: 'modelHub/getDoc', args: {} })
  })

  it('probes a model and stores per-route results', async () => {
    const results = [{ route: 'gw', ok: true, ms: 12 }]
    const store = new ModelHubStore({
      call: async (_path: string, endpoint: string) => {
        if (endpoint === 'modelHub/probeModel') return { ok: true as const, value: { results } }
        if (endpoint === 'modelHub/listPresets') return { ok: true as const, value: { presets: [] } }
        return { ok: true as const, value: doc }
      },
    })
    await store.load()
    const pending = store.probe('m')
    expect(store.store.getSnapshot().probing['m']).toBe(true)
    await pending
    const snapshot = store.store.getSnapshot()
    expect(snapshot.probing['m']).toBeUndefined()
    expect(snapshot.probeResults['m']).toEqual(results)
  })

  it('stores a probe wire failure as a route-less result', async () => {
    const store = new ModelHubStore({
      call: async () => ({ ok: false as const, error: { message: 'boom' } }),
    })
    await store.probe('m')
    expect(store.store.getSnapshot().probeResults['m']).toEqual([{ route: '', ok: false, ms: 0, message: 'boom' }])
  })

  it('writes through the matching gateway endpoint', async () => {
    const { rpc, calls } = fakeRpc()
    const store = new ModelHubStore(rpc)
    await store.load()
    const failure = await store.saveModel('m2', { provider: 'gw', api: 'openai-responses' })
    expect(failure).toBeUndefined()
    // calls[0]=getDoc, calls[1]=listPresets (first load), then the write.
    expect(calls[2]).toEqual({
      path: '/api',
      endpoint: 'modelHub/saveModel',
      args: { id: 'm2', value: { provider: 'gw', api: 'openai-responses' } },
    })
  })

  it('surfaces a rejected write as its message', async () => {
    const { rpc } = fakeRpc({ ok: false, error: { message: 'settings-rejected: bad' } })
    const store = new ModelHubStore(rpc)
    await store.load()
    expect(await store.removeProvider('gw')).toBe('settings-rejected: bad')
  })

  it('degrades to the error state on a transport failure, never hanging on loading', async () => {
    const store = new ModelHubStore({
      call: async () => {
        throw new Error('connection lost')
      },
    })
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBe('connection lost')
  })

  it('maps the linkage fields of the gateway payload, defaulting absent ones', async () => {
    const linked = {
      ...doc,
      routeByModel: { m: 'gw' },
      reconcileError: 'settings-rejected: bad ref',
      defaultModel: { provider: 'gw', model: 'm' },
      credentials: { gw: { configured: true, valid: true } },
    }
    const store = new ModelHubStore({
      call: async (_path: string, endpoint: string) => endpoint === 'modelHub/getDoc'
        ? { ok: true as const, value: linked }
        : { ok: true as const, value: { ok: true } },
    })
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.routeByModel).toEqual({ m: 'gw' })
    expect(snapshot.reconcileError).toBe('settings-rejected: bad ref')
    expect(snapshot.defaultModel).toEqual({ provider: 'gw', model: 'm' })
    expect(snapshot.credentials).toEqual({ gw: { configured: true, valid: true } })
  })

  it('sends a pasted API key along with the provider write', async () => {
    const { rpc, calls } = fakeRpc()
    const store = new ModelHubStore(rpc)
    await store.load()
    await store.saveProvider('gw', { baseURL: 'http://x/v1' }, 'sk-secret')
    expect(calls[2]).toEqual({
      path: '/api',
      endpoint: 'modelHub/saveProvider',
      args: { key: 'gw', value: { baseURL: 'http://x/v1' }, apiKey: 'sk-secret' },
    })
    // A blank key never reaches the wire.
    await store.saveProvider('gw', { baseURL: 'http://x/v1' }, '')
    expect(calls[4]!.args).toEqual({ key: 'gw', value: { baseURL: 'http://x/v1' } })
  })

  it('imports hand-written routes and reloads', async () => {
    const outcome = { providers: ['local-gateway'], models: ['m9'], notes: [{ subject: 'deepseek', reason: 'catalog-route' }] }
    const calls: string[] = []
    const store = new ModelHubStore({
      call: async (_path: string, endpoint: string) => {
        calls.push(endpoint)
        if (endpoint === 'modelHub/importFromPiAi') return { ok: true as const, value: outcome }
        if (endpoint === 'modelHub/listPresets') return { ok: true as const, value: { presets: [] } }
        return { ok: true as const, value: endpoint === 'modelHub/getDoc' ? doc : { ok: true } }
      },
    })
    const result = await store.importFromPiAi()
    expect(result.error).toBeUndefined()
    expect(result.outcome).toEqual(outcome)
    expect(calls).toEqual(['modelHub/importFromPiAi', 'modelHub/getDoc', 'modelHub/listPresets'])
  })

  it('returns the import failure instead of throwing', async () => {
    const store = new ModelHubStore({
      call: async () => ({ ok: false as const, error: { message: 'boom' } }),
    })
    expect(await store.importFromPiAi()).toEqual({ error: 'boom' })
  })

  it('sets the default model through the gateway', async () => {
    const { rpc, calls } = fakeRpc()
    const store = new ModelHubStore(rpc)
    await store.load()
    expect(await store.setDefaultModel('gw', 'm')).toBeUndefined()
    expect(calls[2]).toEqual({ path: '/api', endpoint: 'modelHub/setDefaultModel', args: { route: 'gw', model: 'm' } })
  })
})

describe('deriveKeyRef', () => {
  it('mirrors the host derivation for the editor hint', () => {
    expect(deriveKeyRef('my-gateway')).toBe('MY_GATEWAY_API_KEY')
    expect(deriveKeyRef('0bench')).toBe('K_0BENCH_API_KEY')
  })
})
