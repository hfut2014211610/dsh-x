/**
 * Tool bootstrap: the controlled phase exposing only the bootstrap pair; the
 * promoted resident set adding the discovery tools and the names the model
 * unlocked through `dev_tool_search`; unreadable unlock arguments contributing
 * nothing; a missing bootstrap tool degrading to the full catalog while a
 * missing discovery tool filters anyway; the compaction phase adding the
 * configured work set; the opt-in first-request output cap and its release;
 * the subagent exemption and its opt-in; and load-time failure on invalid
 * configuration or a composition without the projection registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import * as toolBootstrap from '@deepseek-ai/dsh-tool-bootstrap'
import type { Config } from '@deepseek-ai/dsh-tool-bootstrap'
import type {} from '@deepseek-ai/dsh-compaction/types'

const SIGNAL = new AbortController().signal
const BOOTSTRAP = ['bash', 'str_replace_editor']
const CATALOG = ['bash', 'str_replace_editor', 'dev_tool_search', 'skill_search', 'skill_load', 'web_search', 'read']

async function mount(config: Config = { bootstrapTools: BOOTSTRAP }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(toolBootstrap, config)
  return ctx
}

function session(id: string, delegationDepth?: number): Session {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    isSeeded: false,
    ...(delegationDepth === undefined ? {} : { delegationDepth }),
  }
  return Session.create(SessionId(id), undefined, header)
}

function agentFor(session: Session): Agent {
  return {
    id: session.header.id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('the bootstrap never injects into the step') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** The whole catalog, as the assembly's downstream transform contributes it. */
function fullCatalog(): PromptAssembly {
  return {
    sections: [],
    contexts: [],
    tools: CATALOG.map(name => ({ name, description: name, parameters: { type: 'object' as const, properties: {} } })),
    variables: {},
  }
}

function toolNames(assembly: PromptAssembly): string[] {
  return assembly.tools.map(tool => tool.name)
}

async function assemble(ctx: Context, agent: Agent | undefined): Promise<string[]> {
  return toolNames(await ctx.waterfall(
    scopeTarget(ctx.systemPrompt, undefined),
    'system-prompt/assemble',
    fullCatalog(),
    agent === undefined ? {} : { agent },
    async () => fullCatalog(),
  ))
}

let nextCall = 0

/** Record one durable `tool/call` for `toolName` with raw model arguments. */
function call(session: Session, toolName: string, args: string): void {
  nextCall += 1
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId(`call-${nextCall}`),
    name: toolName,
    arguments: args,
  })
}

/** Record the `tool/call` that promotes the session. */
function promote(session: Session): void {
  call(session, 'bash', '{}')
}

function compact(session: Session): void {
  const compactionId = 'compact-1' as CompactionId
  session.append('compaction/start', { compactionId, turn: 1 })
  session.append('compaction/end', { compactionId, turn: 1 })
}

/** Run the request waterfall with `maxTokens` resolved from the adapter. */
async function request(ctx: Context, agent: Agent, maxTokens: number | undefined): Promise<LlmCallConfig> {
  const resolved: LlmCallConfig = {
    provider: 'stub-provider',
    model: 'stub-model',
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
  return agentEvents(ctx, agent).waterfall(
    'agent/request',
    { turn: 1, step: 1, signal: SIGNAL },
    async () => resolved,
  )
}

describe('tool bootstrap', () => {
  it('exposes only the bootstrap pair on an unpromoted session', async () => {
    const ctx = await mount()
    const agent = agentFor(session('controlled'))
    expect(await assemble(ctx, agent)).toEqual(BOOTSTRAP)
    await ctx.fiber.dispose()
  })

  it('treats an assembly outside any agent as promoted', async () => {
    const ctx = await mount()
    expect(await assemble(ctx, undefined)).toEqual([...BOOTSTRAP, 'dev_tool_search', 'skill_search', 'skill_load'])
    await ctx.fiber.dispose()
  })

  it('adds the discovery tools after promotion', async () => {
    const ctx = await mount()
    const agent = agentFor(session('promoted'))
    promote(agent.session)
    expect(await assemble(ctx, agent)).toEqual([...BOOTSTRAP, 'dev_tool_search', 'skill_search', 'skill_load'])
    await ctx.fiber.dispose()
  })

  it('adds the tools the model unlocked through dev_tool_search', async () => {
    const ctx = await mount()
    const agent = agentFor(session('unlocked'))
    call(agent.session, 'dev_tool_search', JSON.stringify({ toolNames: ['web_search', 'read'] }))
    expect(await assemble(ctx, agent)).toEqual([...BOOTSTRAP, 'dev_tool_search', 'skill_search', 'skill_load', 'web_search', 'read'])
    await ctx.fiber.dispose()
  })

  it('ignores unlock arguments that are not a readable object', async () => {
    const ctx = await mount()
    const agent = agentFor(session('bad-args'))
    promote(agent.session)
    call(agent.session, 'dev_tool_search', 'not json')
    call(agent.session, 'dev_tool_search', '["web_search"]')
    call(agent.session, 'dev_tool_search', JSON.stringify({ toolNames: 'web_search' }))
    call(agent.session, 'dev_tool_search', JSON.stringify({ toolNames: [7, 'read'] }))
    expect(await assemble(ctx, agent)).toEqual([...BOOTSTRAP, 'dev_tool_search', 'skill_search', 'skill_load', 'read'])
    await ctx.fiber.dispose()
  })

  it('counts an unlock only once', async () => {
    const ctx = await mount()
    const agent = agentFor(session('duplicate-unlock'))
    call(agent.session, 'dev_tool_search', JSON.stringify({ toolNames: ['web_search'] }))
    call(agent.session, 'dev_tool_search', JSON.stringify({ toolNames: ['web_search'] }))
    expect(await assemble(ctx, agent).then(names => names.filter(name => name === 'web_search'))).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('degrades to the full catalog when a bootstrap tool is missing', async () => {
    const ctx = await mount()
    const agent = agentFor(session('missing-bootstrap'))
    const assembly = await ctx.waterfall(
      scopeTarget(ctx.systemPrompt, undefined),
      'system-prompt/assemble',
      fullCatalog(),
      { agent },
      async () => ({ ...fullCatalog(), tools: [{ name: 'read', description: 'read', parameters: { type: 'object' as const, properties: {} } }] }),
    )
    expect(toolNames(assembly)).toEqual(['read'])
    await ctx.fiber.dispose()
  })

  it('filters anyway when a discovery tool is missing after promotion', async () => {
    const ctx = await mount()
    const agent = agentFor(session('missing-discovery'))
    promote(agent.session)
    const assembly = await ctx.waterfall(
      scopeTarget(ctx.systemPrompt, undefined),
      'system-prompt/assemble',
      fullCatalog(),
      { agent },
      async () => ({ ...fullCatalog(), tools: [{ name: 'bash', description: 'bash', parameters: { type: 'object' as const, properties: {} } }] }),
    )
    expect(toolNames(assembly)).toEqual(['bash'])
    await ctx.fiber.dispose()
  })

  it('adds the compaction work set after a boundary and before re-promotion', async () => {
    const ctx = await mount({ bootstrapTools: BOOTSTRAP, compactionTools: ['read'] })
    const agent = agentFor(session('compacted'))
    promote(agent.session)
    expect(await assemble(ctx, agent)).not.toContain('read')

    compact(agent.session)
    expect(await assemble(ctx, agent)).toEqual([...BOOTSTRAP, 'read'])
    await ctx.fiber.dispose()
  })

  it('keeps a subagent resident unless it opts in', async () => {
    const exempt = await mount()
    const exemptAgent = agentFor(session('subagent-exempt', 1))
    expect(await assemble(exempt, exemptAgent)).toContain('skill_load')
    await exempt.fiber.dispose()

    const gated = await mount({ bootstrapTools: BOOTSTRAP, includeSubagents: true })
    const gatedAgent = agentFor(session('subagent-gated', 1))
    expect(await assemble(gated, gatedAgent)).toEqual(BOOTSTRAP)
    await gated.fiber.dispose()
  })

  it('lets the adapter default flow when no cap is configured', async () => {
    const ctx = await mount()
    const agent = agentFor(session('no-cap'))
    expect(await request(ctx, agent, 256_000)).toEqual({ provider: 'stub-provider', model: 'stub-model', maxTokens: 256_000 })
    await ctx.fiber.dispose()
  })

  it('caps the first request and releases the cap after promotion', async () => {
    const ctx = await mount({ bootstrapTools: BOOTSTRAP, bootstrapMaxTokens: 1024 })
    const agent = agentFor(session('capped'))
    expect(await request(ctx, agent, 256_000)).toEqual({ provider: 'stub-provider', model: 'stub-model', maxTokens: 1024 })

    promote(agent.session)
    expect(await request(ctx, agent, 1024)).toEqual({ provider: 'stub-provider', model: 'stub-model' })
    await ctx.fiber.dispose()
  })

  it('leaves an unrelated budget alone when releasing the cap', async () => {
    const ctx = await mount({ bootstrapTools: BOOTSTRAP, bootstrapMaxTokens: 1024 })
    const agent = agentFor(session('capped-elsewhere'))
    promote(agent.session)
    expect(await request(ctx, agent, 4096)).toEqual({ provider: 'stub-provider', model: 'stub-model', maxTokens: 4096 })
    await ctx.fiber.dispose()
  })

  it('rejects invalid configuration at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    expect(() => {
      toolBootstrap.apply(ctx, { bootstrapTools: BOOTSTRAP, nope: true } as never)
    }).toThrow(/unknown config key/)
    expect(() => {
      toolBootstrap.apply(ctx, { bootstrapTools: [] })
    }).toThrow(/at least one tool/)
    expect(() => {
      toolBootstrap.apply(ctx, { bootstrapTools: BOOTSTRAP, bootstrapMaxTokens: 0 })
    }).toThrow(/positive safe integer/)
    await ctx.fiber.dispose()
  })

  it('rejects a missing projection registry at load', async () => {
    const ctx = new Context()
    expect(() => {
      toolBootstrap.apply(ctx, { bootstrapTools: BOOTSTRAP })
    }).toThrow(/projection registry/)
    await ctx.fiber.dispose()
  })
})
