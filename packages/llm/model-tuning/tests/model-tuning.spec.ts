import { describe, expect, it } from 'vitest'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import {
  applyTuning,
  assertWellFormedKeys,
  Config,
  createRequestListener,
  runModelTuningCommand,
} from '../src/index.ts'

/** Apply the schema to deliberately invalid input without the static type gate. */
const asConfig = (value: unknown): Config => (Config as (input: unknown) => Config)(value)

const resolvedBase: LlmCallConfig = { provider: 'deepseek', model: 'deepseek-chat' }

describe('Config schema', () => {
  it('defaults an absent profiles dict to empty', () => {
    expect(Config({})).toEqual({ profiles: {} })
  })

  it('accepts a complete entry', () => {
    const resolved = Config({
      profiles: {
        'deepseek/deepseek-chat': { temperature: 0.6, maxTokens: 8192, stop: ['<END>'], reasoningEffort: 'high' },
      },
    })
    expect(resolved.profiles?.['deepseek/deepseek-chat']?.temperature).toBe(0.6)
  })

  it('rejects out-of-range and mistyped field values', () => {
    expect(() => asConfig({ profiles: { 'a/b': { temperature: 2.5 } } })).toThrow()
    expect(() => asConfig({ profiles: { 'a/b': { temperature: -0.1 } } })).toThrow()
    expect(() => asConfig({ profiles: { 'a/b': { maxTokens: 0 } } })).toThrow()
    expect(() => asConfig({ profiles: { 'a/b': { maxTokens: 1.5 } } })).toThrow()
    expect(() => asConfig({ profiles: { 'a/b': { reasoningEffort: 'extreme' } } })).toThrow()
    expect(() => asConfig({ profiles: { 'a/b': { stop: '<END>' } } })).toThrow()
  })
})

describe('assertWellFormedKeys', () => {
  it('accepts provider/model keys, including model ids with slashes', () => {
    expect(() => { assertWellFormedKeys({ profiles: { 'deepseek/deepseek-chat': {}, 'gw/openai/gpt-5': {} } }) }).not.toThrow()
    expect(() => { assertWellFormedKeys({}) }).not.toThrow()
  })

  it('rejects keys without both sides, naming the key', () => {
    expect(() => { assertWellFormedKeys({ profiles: { 'no-slash': {} } }) }).toThrow(/"no-slash"/)
    expect(() => { assertWellFormedKeys({ profiles: { '/model': {} } }) }).toThrow(/"\/model"/)
    expect(() => { assertWellFormedKeys({ profiles: { 'provider/': {} } }) }).toThrow(/"provider\/"/)
  })
})

describe('applyTuning', () => {
  it('returns the resolved config untouched without an entry', () => {
    expect(applyTuning(resolvedBase, undefined)).toBe(resolvedBase)
  })

  it('overrides declared fields and passes undeclared ones through', () => {
    const resolved: LlmCallConfig = { ...resolvedBase, temperature: 1, reasoningEffort: 'low' as ReasoningEffortId }
    const result = applyTuning(resolved, { maxTokens: 4096, reasoningEffort: 'high' })
    expect(result).toEqual({ provider: 'deepseek', model: 'deepseek-chat', temperature: 1, maxTokens: 4096, reasoningEffort: 'high' })
  })

  it('treats an empty stop list as no opinion and copies a declared one', () => {
    const withStop: LlmCallConfig = { ...resolvedBase, stop: ['<INHERITED>'] }
    expect(applyTuning(withStop, { stop: [] }).stop).toEqual(['<INHERITED>'])
    const declared = ['<END>']
    const result = applyTuning(resolvedBase, { stop: declared })
    expect(result.stop).toEqual(['<END>'])
    expect(result.stop).not.toBe(declared)
  })
})

describe('createRequestListener', () => {
  const listener = (profiles: Parameters<typeof createRequestListener>[0]) => createRequestListener(profiles)

  it('delegates through next() before reading the entry', async () => {
    let calls = 0
    const next = async () => {
      calls += 1
      return resolvedBase
    }
    await listener(() => ({}))({}, next)
    expect(calls).toBe(1)
  })

  it('matches entries by provider/model, including slash-bearing model ids', async () => {
    const next = async (): Promise<LlmCallConfig> => ({ provider: 'gw', model: 'openai/gpt-5' })
    const result = await listener(() => ({ 'gw/openai/gpt-5': { temperature: 0.2 } }))({}, next)
    expect(result.temperature).toBe(0.2)
  })

  it('passes the resolved config through when no entry matches', async () => {
    const next = async () => resolvedBase
    const result = await listener(() => ({ 'other/route': { temperature: 0.2 } }))({}, next)
    expect(result).toBe(resolvedBase)
  })
})

describe('runModelTuningCommand', () => {
  type Mutate = Pick<SettingsProvider, 'mutate'>['mutate']
  const settingsCapture = () => {
    const calls: Parameters<Mutate>[1][] = []
    const settings: Pick<SettingsProvider, 'mutate'> = {
      mutate: async (_ns, ops) => {
        calls.push(ops)
      },
    }
    return { calls, settings }
  }

  it('lists entries on the bare form', async () => {
    const result = await runModelTuningCommand('', { 'deepseek/deepseek-chat': { temperature: 0.6 } }, undefined)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('deepseek/deepseek-chat')
    const empty = await runModelTuningCommand('  ', {}, undefined)
    expect(empty.kind).toBe('success')
    expect(empty.text).toContain('没有配置')
  })

  it('writes a parsed set op through the settings seam', async () => {
    const { calls, settings } = settingsCapture()
    const result = await runModelTuningCommand('set deepseek/deepseek-chat temperature 0.5', {}, settings)
    expect(result.kind).toBe('success')
    expect(calls).toEqual([[{ op: 'set', path: ['profiles', 'deepseek/deepseek-chat', 'temperature'], value: 0.5 }]])
  })

  it('collects stop sequences from the remaining arguments', async () => {
    const { calls, settings } = settingsCapture()
    await runModelTuningCommand('set a/b stop <END> <STOP>', {}, settings)
    expect(calls[0]).toEqual([{ op: 'set', path: ['profiles', 'a/b', 'stop'], value: ['<END>', '<STOP>'] }])
  })

  it('unsets one field or a whole entry', async () => {
    const { calls, settings } = settingsCapture()
    await runModelTuningCommand('unset a/b temperature', {}, settings)
    await runModelTuningCommand('unset a/b', {}, settings)
    expect(calls).toEqual([
      [{ op: 'unset', path: ['profiles', 'a/b', 'temperature'] }],
      [{ op: 'unset', path: ['profiles', 'a/b'] }],
    ])
  })

  it('rejects malformed input with a user-facing reason', async () => {
    const { settings } = settingsCapture()
    expect((await runModelTuningCommand('set a/b temperature hot', {}, settings)).kind).toBe('error')
    expect((await runModelTuningCommand('set a/b bogus 1', {}, settings)).kind).toBe('error')
    expect((await runModelTuningCommand('set noslash temperature 1', {}, settings)).kind).toBe('error')
    expect((await runModelTuningCommand('drop a/b', {}, settings)).kind).toBe('error')
    expect((await runModelTuningCommand('set a/b reasoningEffort ultra', {}, settings)).kind).toBe('error')
  })

  it('refuses writes when the settings seam is absent', async () => {
    const result = await runModelTuningCommand('set a/b temperature 1', {}, undefined)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('settings')
  })

  it('surfaces a settings rejection as an error result', async () => {
    const settings = {
      mutate: async () => {
        throw new Error('settings-rejected: bad section')
      },
    }
    const result = await runModelTuningCommand('set a/b temperature 1', {}, settings)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('settings-rejected')
  })
})
