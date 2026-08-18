import { describe, expect, it } from 'vitest'
import { deriveKeyRef, mergeRouteLayers, planImport } from '../src/decompile.ts'
import { prepareProviderEntry } from '../src/index.ts'

describe('deriveKeyRef', () => {
  it('upper-cases kebab-case provider keys into the stock convention', () => {
    expect(deriveKeyRef('my-gateway')).toBe('MY_GATEWAY_API_KEY')
    expect(deriveKeyRef('x-models')).toBe('X_MODELS_API_KEY')
  })

  it('stays a valid reference when the key starts with a digit', () => {
    expect(deriveKeyRef('0bench')).toBe('K_0BENCH_API_KEY')
  })
})

describe('mergeRouteLayers', () => {
  it('prefers user scalars, merges nested maps, and replaces the models list', () => {
    const merged = mergeRouteLayers(
      { baseURL: 'http://base/v1', api: 'openai-completions', headers: { a: '1', b: '2' }, models: [{ id: 'base-m' }] },
      { baseURL: 'http://user/v1', headers: { b: '3' }, models: [{ id: 'user-m' }] },
    )
    expect(merged).toEqual({
      baseURL: 'http://user/v1',
      api: 'openai-completions',
      headers: { a: '1', b: '3' },
      models: [{ id: 'user-m' }],
    })
  })

  it('returns the one layer that exists', () => {
    expect(mergeRouteLayers(undefined, { baseURL: 'http://x/v1' })).toEqual({ baseURL: 'http://x/v1' })
    expect(mergeRouteLayers({ baseURL: 'http://x/v1' }, undefined)).toEqual({ baseURL: 'http://x/v1' })
    expect(mergeRouteLayers(undefined, undefined)).toBeUndefined()
  })
})

describe('planImport', () => {
  const route = {
    api: 'openai-completions',
    baseURL: 'http://gw/v1',
    models: [{ id: 'm1', contextWindow: 1000 }],
  }

  it('imports a bare route as provider plus models with the route protocol', () => {
    const plan = planImport({ gw: { ...route, displayName: 'gw', apiKeyEnv: 'GW_API_KEY' } })
    expect(plan.providers).toEqual({ gw: { baseURL: 'http://gw/v1', apiKeyEnv: 'GW_API_KEY' } })
    expect(plan.models).toEqual({
      m1: { provider: 'gw', api: 'openai-completions', contextWindow: 1000 },
    })
    expect(plan.notes).toEqual([])
  })

  it('groups provider~api routes of one provider and derives their protocols', () => {
    const plan = planImport({
      'gw~openai-completions': { baseURL: 'http://gw/v1', models: [{ id: 'm1' }] },
      'gw~anthropic-messages': { baseURL: 'http://gw/v1', models: [{ id: 'm2' }] },
    })
    expect(Object.keys(plan.providers)).toEqual(['gw'])
    expect(plan.models.m1).toEqual({ provider: 'gw', api: 'openai-completions' })
    expect(plan.models.m2).toEqual({ provider: 'gw', api: 'anthropic-messages' })
  })

  it('never re-imports routes the hub itself generated', () => {
    const plan = planImport({ gw: route }, { managedRoutes: ['gw'] })
    expect(plan.providers).toEqual({})
    expect(plan.models).toEqual({})
    expect(plan.notes).toEqual([])
  })

  it('skips catalog routes, protocol-less routes, and endpoint-less routes with notes', () => {
    const plan = planImport({
      catalog: { baseURL: 'http://gw/v1' },
      protoless: { baseURL: 'http://gw/v1', models: [{ id: 'm' }] },
      homeless: { api: 'openai-completions', models: [{ id: 'n' }] },
    })
    expect(plan.notes).toEqual([
      { subject: 'catalog', reason: 'catalog-route' },
      { subject: 'protoless', reason: 'unknown-protocol' },
      { subject: 'homeless', reason: 'no-endpoint' },
    ])
    expect(plan.providers).toEqual({})
  })

  it('attaches models to an existing hub provider when the endpoint agrees', () => {
    const plan = planImport({ gw: route }, {
      existingProviders: { gw: { baseURL: 'http://gw/v1' } },
    })
    expect(plan.providers).toEqual({})
    expect(Object.keys(plan.models)).toEqual(['m1'])
  })

  it('refuses models onto a provider whose endpoint disagrees', () => {
    const plan = planImport({ gw: route }, {
      existingProviders: { gw: { baseURL: 'http://other/v1' } },
    })
    expect(plan.models).toEqual({})
    expect(plan.notes).toEqual([{ subject: 'gw', reason: 'endpoint-conflict' }])
  })

  it('skips duplicate model ids and drops a provider left with nothing', () => {
    const plan = planImport({ gw: route }, { existingModels: { m1: { provider: 'x', api: 'openai-completions' } } })
    expect(plan.providers).toEqual({})
    expect(plan.models).toEqual({})
    expect(plan.notes).toEqual([{ subject: 'm1', reason: 'duplicate-model' }])
  })

  it('merges the same model id on a second imported route into an ordered fallback', () => {
    const plan = planImport({
      gw: { ...route },
      'backup~anthropic-messages': { baseURL: 'http://backup/v1', models: [{ id: 'm1' }] },
    })
    expect(plan.models.m1).toEqual({
      provider: 'gw',
      api: 'openai-completions',
      contextWindow: 1000,
      fallbacks: [{ provider: 'backup', api: 'anthropic-messages' }],
    })
    expect(plan.notes).toEqual([])
  })

  it('still notes a true duplicate (same provider and protocol twice)', () => {
    const plan = planImport({
      gw: { ...route },
      'gw~openai-completions': { baseURL: 'http://gw/v1', models: [{ id: 'm1' }] },
    })
    expect(plan.models.m1!.fallbacks).toBeUndefined()
    expect(plan.notes).toEqual([{ subject: 'm1', reason: 'duplicate-model' }])
  })

  it('keeps model fields that compile round-trips: name, capacities, input, efforts, compat', () => {
    const plan = planImport({
      gw: {
        ...route,
        defaultInput: ['text', 'image'],
        compat: { thinkingFormat: 'deepseek' },
        models: [{
          id: 'm1',
          name: 'M One',
          contextWindow: 1000,
          maxTokens: 500,
          input: ['text'],
          reasoningEfforts: { off: null, high: 'high' },
          compat: { supportsReasoningEffort: true },
        }],
      },
    })
    expect(plan.providers.gw).toMatchObject({ defaultInput: ['text', 'image'], compat: { thinkingFormat: 'deepseek' } })
    expect(plan.models.m1).toEqual({
      provider: 'gw',
      api: 'openai-completions',
      name: 'M One',
      contextWindow: 1000,
      maxTokens: 500,
      input: ['text'],
      reasoningEfforts: { off: null, high: 'high' },
      compat: { supportsReasoningEffort: true },
    })
  })
})

describe('prepareProviderEntry', () => {
  it('passes a plain entry through without a credential write', () => {
    expect(prepareProviderEntry('gw', { baseURL: 'http://x/v1' })).toEqual({ entry: { baseURL: 'http://x/v1' } })
  })

  it('derives the credential reference from the provider key for a pasted key', () => {
    expect(prepareProviderEntry('my-gw', { baseURL: 'http://x/v1' }, 'sk-secret')).toEqual({
      entry: { baseURL: 'http://x/v1', apiKeyEnv: 'MY_GW_API_KEY' },
      credential: { ref: 'MY_GW_API_KEY', value: 'sk-secret' },
    })
  })

  it('stores a pasted key under the declared reference instead of deriving one', () => {
    expect(prepareProviderEntry('gw', { baseURL: 'http://x/v1', apiKeyEnv: 'CUSTOM_REF' }, 'sk-secret').credential)
      .toEqual({ ref: 'CUSTOM_REF', value: 'sk-secret' })
  })

  it('rejects a pasted key sitting in the reference field', () => {
    expect(() => prepareProviderEntry('gw', { baseURL: 'http://x/v1', apiKeyEnv: 'sk-gw-123' }))
      .toThrow(/not a credential reference/)
  })

  it('ignores a blank pasted key', () => {
    expect(prepareProviderEntry('gw', { baseURL: 'http://x/v1' }, '')).toEqual({ entry: { baseURL: 'http://x/v1' } })
  })
})
