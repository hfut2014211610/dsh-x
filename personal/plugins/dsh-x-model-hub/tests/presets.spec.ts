import { describe, expect, it } from 'vitest'
import { listPresets } from '../src/presets.ts'

describe('listPresets', () => {
  const presets = listPresets()
  const byKey = new Map(presets.map(preset => [preset.key, preset]))

  it('offers every vendor the page advertises', () => {
    expect([...byKey.keys()].sort()).toEqual([
      'claude',
      'deepseek',
      'gemini',
      'glm',
      'gpt',
      'grok',
      'kimi',
      'mimo',
      'minimax',
      'qwen',
    ])
  })

  it('derives catalog vendors with endpoints and fully-specified models', () => {
    const deepseek = byKey.get('deepseek')!
    expect(deepseek.baseURL).toBe('https://api.deepseek.com')
    expect(deepseek.models.map(model => model.id)).toContain('deepseek-v4-pro')
    const pro = deepseek.models.find(model => model.id === 'deepseek-v4-pro')!
    expect(pro).toMatchObject({ api: 'openai-completions', contextWindow: 1000000, maxTokens: 384000 })
    expect(pro.reasoningEfforts).not.toBe(false)
  })

  it('carries the catalog thinking-level map when the model ships one', () => {
    const claude = byKey.get('claude')!
    const fable = claude.models.find(model => model.id === 'claude-fable-5')
    expect(fable?.reasoningEfforts).toEqual({ off: null, xhigh: 'xhigh', max: 'max' })
    // Dated duplicates stay out of the dropdown.
    expect(claude.models.some(model => /-20\d{2}/.test(model.id))).toBe(false)
  })

  it('repoints gemini at the OpenAI-compatible endpoint with a servable protocol', () => {
    const gemini = byKey.get('gemini')!
    expect(gemini.baseURL).toContain('/openai')
    expect(gemini.models.length).toBeGreaterThan(0)
    expect(gemini.models.every(model => model.api === 'openai-completions')).toBe(true)
  })

  it('ships the hand-written qwen table (no pure-vendor builtin exists)', () => {
    const qwen = byKey.get('qwen')!
    expect(qwen.baseURL).toContain('dashscope.aliyuncs.com')
    expect(qwen.models.length).toBeGreaterThan(0)
    expect(qwen.models.every(model => model.api === 'openai-completions')).toBe(true)
  })

  it('keeps per-model protocols when a vendor spans them (grok)', () => {
    const grok = byKey.get('grok')!
    expect(new Set(grok.models.map(model => model.api)).size).toBeGreaterThan(1)
  })
})
