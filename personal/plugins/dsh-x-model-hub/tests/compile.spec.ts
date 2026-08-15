import { describe, expect, it } from 'vitest'
import { assertUsable, compileChains, compileRoutes, Config } from '../src/compile.ts'

/** Apply the schema to deliberately invalid input without the static type gate. */
const asConfig = (value: unknown): Config => (Config as (input: unknown) => Config)(value)

describe('Config schema', () => {
  it('defaults providers and models to empty dicts', () => {
    expect(Config({})).toEqual({ providers: {}, models: {}, _routes: [] })
  })

  it('requires provider and api on every model', () => {
    expect(() => asConfig({ models: { m: { api: 'openai-completions' } } })).toThrow()
    expect(() => asConfig({ models: { m: { provider: 'gw' } } })).toThrow()
  })

  it('restricts api to the stock supported protocols', () => {
    expect(() => asConfig({ models: { m: { provider: 'gw', api: 'google-generative-ai' } } })).toThrow()
    expect(() => asConfig({ models: { m: { provider: 'gw', api: 'openai-completions' } } })).not.toThrow()
    expect(() => asConfig({ models: { m: { provider: 'gw', api: 'openai-responses' } } })).not.toThrow()
    expect(() => asConfig({ models: { m: { provider: 'gw', api: 'anthropic-messages' } } })).not.toThrow()
  })

  it('requires baseURL on every provider and range-checks capacities', () => {
    expect(() => asConfig({ providers: { gw: {} } })).toThrow()
    expect(() => asConfig({ models: { m: { provider: 'gw', api: 'openai-completions', contextWindow: 0 } } })).toThrow()
    expect(() => asConfig({ models: { m: { provider: 'gw', api: 'openai-completions', maxTokens: 1.5 } } })).toThrow()
  })
})

describe('compileRoutes', () => {
  it('keeps the bare provider key as the route for a single-protocol provider', () => {
    const routes = compileRoutes({
      providers: { gw: { baseURL: 'http://localhost:18080/v1', apiKeyEnv: 'GW_KEY' } },
      models: {
        'model-a': { provider: 'gw', api: 'openai-completions', contextWindow: 131072 },
        'model-b': { provider: 'gw', api: 'openai-completions' },
      },
    })
    expect(Object.keys(routes)).toEqual(['gw'])
    expect(routes['gw']).toMatchObject({
      apiKeyEnv: 'GW_KEY',
      displayName: 'gw',
      api: 'openai-completions',
      baseURL: 'http://localhost:18080/v1',
    })
    expect(routes['gw']!.models).toEqual([
      { id: 'model-a', contextWindow: 131072 },
      { id: 'model-b' },
    ])
  })

  it('splits a multi-protocol provider into provider~api routes', () => {
    const routes = compileRoutes({
      providers: { gw: { baseURL: 'http://localhost:18080/v1', displayName: '我的网关' } },
      models: {
        'model-a': { provider: 'gw', api: 'openai-completions' },
        'model-b': { provider: 'gw', api: 'anthropic-messages' },
      },
    })
    expect(Object.keys(routes).sort()).toEqual(['gw~anthropic-messages', 'gw~openai-completions'])
    expect(routes['gw~anthropic-messages']).toMatchObject({
      displayName: '我的网关 · anthropic-messages',
      api: 'anthropic-messages',
      baseURL: 'http://localhost:18080/v1',
      models: [{ id: 'model-b' }],
    })
  })

  it('inherits provider compat switches only onto openai-completions groups', () => {
    const routes = compileRoutes({
      providers: {
        gw: {
          baseURL: 'http://localhost/v1',
          compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
        },
      },
      models: {
        'model-a': { provider: 'gw', api: 'openai-completions' },
        'model-b': { provider: 'gw', api: 'anthropic-messages' },
      },
    })
    expect(routes['gw~openai-completions']!.compat).toEqual({ thinkingFormat: 'deepseek', supportsReasoningEffort: true })
    expect(routes['gw~anthropic-messages']!.compat).toBeUndefined()
  })

  it('routes each protocol group to its endpoint override, defaulting to baseURL', () => {
    const routes = compileRoutes({
      providers: {
        gw: {
          baseURL: 'http://localhost:18080/v1',
          endpoints: { 'anthropic-messages': 'http://localhost:18080' },
        },
      },
      models: {
        'model-a': { provider: 'gw', api: 'openai-completions' },
        'model-b': { provider: 'gw', api: 'anthropic-messages' },
      },
    })
    expect(routes['gw~openai-completions']!.baseURL).toBe('http://localhost:18080/v1')
    expect(routes['gw~anthropic-messages']!.baseURL).toBe('http://localhost:18080')
  })

  it('passes provider defaults and per-model capability fields through', () => {
    const routes = compileRoutes({
      providers: {
        gw: {
          baseURL: 'http://localhost:18080/v1',
          headers: { 'X-Tenant': 'dev' },
          compat: { thinkingFormat: 'deepseek' },
          defaultInput: ['text', 'image'],
          defaultContextWindow: 262144,
          defaultMaxTokens: 32768,
        },
      },
      models: {
        reasoner: {
          provider: 'gw',
          api: 'openai-completions',
          name: 'Reasoner',
          maxTokens: 65536,
          input: ['text'],
          reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
          compat: { supportsReasoningEffort: true },
        },
        plain: { provider: 'gw', api: 'openai-completions', reasoningEfforts: false },
      },
    })
    const route = routes['gw']!
    expect(route).toMatchObject({
      headers: { 'X-Tenant': 'dev' },
      compat: { thinkingFormat: 'deepseek' },
      defaultInput: ['text', 'image'],
      defaultContextWindow: 262144,
      defaultMaxTokens: 32768,
    })
    expect(route.models).toEqual([
      {
        id: 'reasoner',
        name: 'Reasoner',
        maxTokens: 65536,
        input: ['text'],
        reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
        compat: { supportsReasoningEffort: true },
      },
      { id: 'plain', reasoningEfforts: false },
    ])
  })

  it('throws naming the model when its provider is unknown', () => {
    expect(() => compileRoutes({
      providers: { gw: { baseURL: 'http://localhost/v1' } },
      models: { 'model-a': { provider: 'elsewhere', api: 'openai-completions' } },
    })).toThrow(/"model-a".*"elsewhere"/)
  })

  it('places a multi-provider model on every one of its routes', () => {
    const routes = compileRoutes({
      providers: {
        gw: { baseURL: 'http://localhost/v1' },
        backup: { baseURL: 'http://backup/v1' },
      },
      models: {
        'model-a': {
          provider: 'gw',
          api: 'openai-completions',
          fallbacks: [{ provider: 'backup', api: 'anthropic-messages' }],
        },
      },
    })
    expect(Object.keys(routes).sort()).toEqual(['backup', 'gw'])
    expect(routes['gw']!.models).toEqual([{ id: 'model-a' }])
    expect(routes['backup']).toMatchObject({ api: 'anthropic-messages', models: [{ id: 'model-a' }] })
  })
})

describe('compileChains', () => {
  it('orders the chain primary-first and omits single-placement models', () => {
    const chains = compileChains({
      providers: {
        gw: { baseURL: 'http://localhost/v1' },
        backup: { baseURL: 'http://backup/v1' },
        third: { baseURL: 'http://third/v1' },
      },
      models: {
        'model-a': {
          provider: 'gw',
          api: 'openai-completions',
          fallbacks: [{ provider: 'backup', api: 'openai-completions' }, { provider: 'third', api: 'openai-completions' }],
        },
        solo: { provider: 'gw', api: 'openai-completions' },
      },
    })
    expect(chains).toEqual({ 'model-a': ['gw', 'backup', 'third'] })
  })

  it('names chain routes with the same provider~api rule as compileRoutes', () => {
    const config = {
      providers: { gw: { baseURL: 'http://localhost/v1' }, backup: { baseURL: 'http://backup/v1' } },
      models: {
        // The fallback speaks a second protocol ON the same provider, pushing
        // that provider into multi-protocol naming; the chain must agree.
        'model-a': {
          provider: 'gw',
          api: 'openai-completions',
          fallbacks: [{ provider: 'gw', api: 'anthropic-messages' }, { provider: 'backup', api: 'openai-completions' }],
        },
      },
    }
    const chains = compileChains(config)
    expect(chains['model-a']).toEqual(['gw~openai-completions', 'gw~anthropic-messages', 'backup'])
    expect(Object.keys(compileRoutes(config)).sort()).toEqual(['backup', 'gw~anthropic-messages', 'gw~openai-completions'])
  })
})

describe('assertUsable', () => {
  it('rejects a provider key containing the route separator', () => {
    expect(() => assertUsable({
      providers: { 'gw~x': { baseURL: 'http://localhost/v1' } },
      models: {},
    })).toThrow(/"gw~x"/)
  })

  it('rejects an empty baseURL and unknown provider references', () => {
    expect(() => assertUsable({ providers: { gw: { baseURL: '' } }, models: {} })).toThrow(/"gw"/)
    expect(() => assertUsable({
      providers: {},
      models: { m: { provider: 'ghost', api: 'openai-completions' } },
    })).toThrow(/"m".*"ghost"/)
  })

  it('rejects duplicate placements on one model', () => {
    expect(() => assertUsable({
      providers: { gw: { baseURL: 'http://localhost/v1' }, backup: { baseURL: 'http://backup/v1' } },
      models: {
        m: {
          provider: 'gw',
          api: 'openai-completions',
          fallbacks: [{ provider: 'gw', api: 'openai-completions' }],
        },
      },
    })).toThrow(/"m".*"gw"/)
  })

  it('accepts a serviceable section', () => {
    expect(() => assertUsable({
      providers: { gw: { baseURL: 'http://localhost/v1' } },
      models: { m: { provider: 'gw', api: 'openai-completions' } },
    })).not.toThrow()
  })
})
