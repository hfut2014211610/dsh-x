/**
 * Tool discovery: keyword search requiring every token, the no-match and
 * truncation replies, unlock-only and empty calls, malformed arguments
 * contributing nothing, a failing registry reporting one line instead of
 * throwing, and the registration itself being an effect of the plugin fiber.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type JsonSchemaNode, type ToolDefinition, type ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import * as devToolSearch from '@deepseek-ai/dsh-tool-dev-search'

const SIGNAL = new AbortController().signal

/** Tools the search surface offers, in registration order. */
const CATALOG = [
  { name: 'bash', description: 'Run a persistent shell session' },
  { name: 'web_search', description: 'Search the internet for pages and results' },
  { name: 'web_fetch', description: 'Retrieve one web page as text' },
  { name: 'mcp_browser', description: 'Drive a browser over the MCP bridge' },
  { name: 'todo_write', description: 'Track tasks for this session' },
]

const TEXT_OUTPUT: ToolOutputDefinition = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  } satisfies JsonSchemaNode,
  render: (_args: unknown, value: JsonValue) => {
    const { text } = value as { readonly text: string }
    return [{ type: 'text', text }]
  },
}

/** A catalog tool that returns `text`, so the registry accepts its registration. */
function textTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    output: TEXT_OUTPUT,
    execute: async () => ({ text: '' }),
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  for (const tool of CATALOG) ctx.tools.register(textTool(tool.name, tool.description))
  await ctx.plugin(devToolSearch)
  return ctx
}

/** Call `dev_tool_search` through the registry and return its rendered text. */
async function call(ctx: Context, args: unknown): Promise<string> {
  const result = await ctx.tools.execute({
    callId: ToolCallId('call-1'),
    name: 'dev_tool_search',
    arguments: args,
    signal: SIGNAL,
  })
  if (result.isError) throw new Error('dev_tool_search reported a failure')
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('dev tool search', () => {
  it('registers dev_tool_search with the unlockable index in its description', async () => {
    const ctx = await mount()
    const schema = ctx.tools.schemas().find(s => s.name === 'dev_tool_search')
    expect(schema?.description).toContain('web_search — internet search and web retrieval')
    expect(schema?.description).toContain('ask_user_question — ask the user')
    await ctx.fiber.dispose()
  })

  it('answers an empty call with the usage hint', async () => {
    const ctx = await mount()
    expect(await call(ctx, {})).toContain('Provide `query` to search the catalog')
    await ctx.fiber.dispose()
  })

  it('requires every token to match', async () => {
    const ctx = await mount()
    const text = await call(ctx, { query: 'web' })
    expect(text).toContain('web_search:')
    expect(text).toContain('web_fetch:')
    expect(text).not.toContain('todo_write:')

    const narrowed = await call(ctx, { query: 'mcp browser' })
    expect(narrowed).toContain('mcp_browser:')
    expect(narrowed).not.toContain('web_search:')
    await ctx.fiber.dispose()
  })

  it('reports a query that matches nothing', async () => {
    const ctx = await mount()
    expect(await call(ctx, { query: 'nonexistentcapability' }))
      .toContain('No tools match "nonexistentcapability".')
    await ctx.fiber.dispose()
  })

  it('confirms an unlock without searching', async () => {
    const ctx = await mount()
    expect(await call(ctx, { toolNames: ['web_search', 'todo_write'] }))
      .toBe('Unlocked for the next request: web_search, todo_write')
    await ctx.fiber.dispose()
  })

  it('confirms an unlock and answers a search in one call', async () => {
    const ctx = await mount()
    const text = await call(ctx, { toolNames: ['web_search'], query: 'todo' })
    expect(text).toContain('Unlocked for the next request: web_search')
    expect(text).toContain('todo_write:')
    await ctx.fiber.dispose()
  })

  it('ignores malformed argument fields', async () => {
    const ctx = await mount()
    expect(await call(ctx, { query: 42, toolNames: 'web_search' }))
      .toContain('Provide `query` to search the catalog')
    expect(await call(ctx, { toolNames: ['web_search', '', 7] }))
      .toBe('Unlocked for the next request: web_search')
    expect(await call(ctx, 'not an object'))
      .toContain('Provide `query` to search the catalog')
    await ctx.fiber.dispose()
  })

  it('truncates a broad match list and says so', async () => {
    const ctx = await mount()
    for (let index = 0; index < 30; index += 1) {
      ctx.tools.register(textTool(`filler_${index}`, 'shared filler token'))
    }
    const text = await call(ctx, { query: 'filler' })
    expect(text).toContain('Matching tools (25 of 30):')
    expect(text).toContain('(truncated at 25')
    await ctx.fiber.dispose()
  })

  it('quotes only the first description line, truncated', async () => {
    const ctx = await mount()
    ctx.tools.register(textTool('verbose_tool', `first line ${'x'.repeat(200)}\nsecond line`))
    const text = await call(ctx, { query: 'verbose_tool' })
    expect(text).not.toContain('second line')
    const line = text.split('\n').find(entry => entry.startsWith('- verbose_tool:'))
    expect(line?.length).toBeLessThan(120)
    await ctx.fiber.dispose()
  })

  it('removes the tool when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(devToolSearch)
    expect(ctx.tools.schemas().some(s => s.name === 'dev_tool_search')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'dev_tool_search')).toBe(false)
    await ctx.fiber.dispose()
  })
})
