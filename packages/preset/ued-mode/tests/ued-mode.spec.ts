/**
 * UED-mode policy section: the section registers under `ued:policy` at the
 * order that places it after the persona and before tool guidance; the policy
 * text names the deployment's delegation tool and thread cap; both required
 * config fields are validated; an unknown key fails at mount; and the section
 * leaves with the plugin fiber.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import * as uedMode from '@deepseek-ai/dsh-ued-mode'
import type { Config } from '@deepseek-ai/dsh-ued-mode'

const CONFIG: Config = { delegationTool: 'subagent', maxActiveThreads: 4 }

/** One config object with one field replaced, for the rejection cases. */
function variant(field: string, value: unknown): Config {
  return { delegationTool: 'subagent', maxActiveThreads: 4, [field]: value }
}

async function mount(config: Config = CONFIG): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(uedMode, config)
  return ctx
}

/** One section's text from the assembled prompt. */
async function section(ctx: Context, name: string): Promise<string | undefined> {
  const assembly: PromptAssembly = await ctx.systemPrompt.assemble({})
  return assembly.sections.find(entry => entry.name === name)?.text
}

/** The order the assembled prompt placed one section at. */
async function orderOf(ctx: Context, name: string): Promise<number> {
  const assembly = await ctx.systemPrompt.assemble({})
  return assembly.sections.findIndex(entry => entry.name === name)
}

describe('ued-mode policy', () => {
  it('registers the section under ued:policy', async () => {
    const ctx = await mount()
    expect(await section(ctx, 'ued:policy')).toContain('You are in UED mode.')
    await ctx.fiber.dispose()
  })

  it('lands after the persona and before tool guidance', async () => {
    const ctx = await mount()
    const policy = await orderOf(ctx, 'ued:policy')
    const identity = await orderOf(ctx, 'harness:identity')
    expect(policy).toBeGreaterThan(identity)
    await ctx.fiber.dispose()
  })

  it('names the deployment delegation tool and thread cap', async () => {
    const ctx = await mount({ delegationTool: 'design-thread', maxActiveThreads: 7 })
    const text = await section(ctx, 'ued:policy')
    expect(text).toContain('`design-thread` thread')
    expect(text).toContain('Keep at most 7 threads active at once.')
    await ctx.fiber.dispose()
  })

  it('states both hazards the guard does not cover', async () => {
    const ctx = await mount()
    const text = await section(ctx, 'ued:policy')
    expect(text).toContain('DOCUMENT_STALE_VERSION')
    expect(text).toContain('Never write back the content you read before the failure.')
    expect(text).toContain('conflicting intent')
    await ctx.fiber.dispose()
  })

  it('removes the section when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    const fiber = await ctx.plugin(uedMode, CONFIG)
    expect(await section(ctx, 'ued:policy')).toBeDefined()
    await fiber.dispose()
    expect(await section(ctx, 'ued:policy')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects an unknown config key at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    expect(() => {
      uedMode.apply(ctx, variant('nope', true))
    }).toThrow(/unknown config key/)
    await ctx.fiber.dispose()
  })

  it('rejects a missing or empty delegation tool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    expect(() => {
      uedMode.apply(ctx, { maxActiveThreads: 1 } as never)
    }).toThrow()
    expect(() => {
      uedMode.apply(ctx, variant('delegationTool', ''))
    }).toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects a thread cap below one', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    expect(() => {
      uedMode.apply(ctx, variant('maxActiveThreads', 0))
    }).toThrow()
    await ctx.fiber.dispose()
  })
})
