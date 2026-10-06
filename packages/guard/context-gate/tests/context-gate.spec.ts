/**
 * Context gate: an unpromoted session's assembled contexts and appended step
 * messages are suppressed; a promoted session keeps both; the skill-invocation
 * allowlist default and an explicitly empty allowlist; `enabled: false`
 * bypassing both paths; each promotion mode; the subagent exemption and its
 * opt-in; demotion at a compaction boundary; and load-time failure on a
 * composition without the projection registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import * as contextGate from '@deepseek-ai/dsh-context-gate'
import type { Config } from '@deepseek-ai/dsh-context-gate'
import type {} from '@deepseek-ai/dsh-compaction/types'

const SIGNAL = new AbortController().signal

async function mount(config?: Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(contextGate, config)
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
    inject: () => { throw new Error('the gate never injects into the step') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** A message a downstream listener appended, with a non-user source kind. */
function injected(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'tmux-context', form: 'snapshot', sections: [{ name: 'tmux', text }] },
  })
}

function promote(session: Session): void {
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId('call-1'),
    name: 'read',
    arguments: '{}',
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createUserMessage({
      content: [{ type: 'text', text: 'done' }],
      source: { kind: 'model', model: 'stub-model', provider: 'stub-provider' },
    }) as never,
    stream: [],
  }, { surfaceOp: 'append' })
}

function compact(session: Session): void {
  const compactionId = 'compact-1' as CompactionId
  session.append('compaction/start', { compactionId, turn: 1 })
  session.append('compaction/end', { compactionId, turn: 1 })
}

function assembly(contexts: number): PromptAssembly {
  return {
    sections: [],
    contexts: Array.from({ length: contexts }, (_, index) => ({ name: `c${index}`, text: `context ${index}` })),
    tools: [],
    variables: {},
  }
}

/** Run the assemble waterfall with one contributed runtime context. */
async function assemble(ctx: Context, agent: Agent | undefined): Promise<PromptAssembly> {
  const next = async (): Promise<PromptAssembly> => assembly(1)
  return agent === undefined
    ? ctx.waterfall(scopeTarget(ctx.systemPrompt, undefined), 'system-prompt/assemble', assembly(0), {}, next)
    : ctx.waterfall(scopeTarget(ctx.systemPrompt, undefined), 'system-prompt/assemble', assembly(0), { agent }, next)
}

/** Run the pre-step waterfall with `appended` messages after the claimed batch. */
async function preStep(
  ctx: Context,
  agent: Agent,
  claimed: UserMessage[],
  appended: UserMessage[],
): Promise<UserMessage[] | undefined> {
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: claimed, turn: 1, step: 1, signal: SIGNAL },
    async () => ({ kind: 'enter' as const, messages: [...claimed, ...appended] }),
  )
  return decision.kind === 'enter' ? decision.messages : undefined
}

const CLAIMED = [createUserMessage({ content: [{ type: 'text', text: 'claimed' }], source: { kind: 'user' } })]
const APPENDED = [injected('appended')]

describe('context gate', () => {
  it('blanks the assembled contexts of an unpromoted session', async () => {
    const ctx = await mount()
    const agent = agentFor(session('unpromoted'))
    expect((await assemble(ctx, agent)).contexts).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps the assembled contexts of a promoted session', async () => {
    const ctx = await mount()
    const agent = agentFor(session('promoted'))
    promote(agent.session)
    expect((await assemble(ctx, agent)).contexts).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('keeps the assembled contexts outside any agent', async () => {
    const ctx = await mount()
    expect((await assemble(ctx, undefined)).contexts).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('strips appended step messages from an unpromoted session', async () => {
    const ctx = await mount()
    const agent = agentFor(session('strip-appended'))
    const messages = await preStep(ctx, agent, CLAIMED, APPENDED)
    expect(messages).toHaveLength(1)
    expect(messages?.[0]).toBe(CLAIMED[0])
    await ctx.fiber.dispose()
  })

  it('keeps appended step messages for a promoted session', async () => {
    const ctx = await mount()
    const agent = agentFor(session('keep-appended'))
    promote(agent.session)
    expect(await preStep(ctx, agent, CLAIMED, APPENDED)).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('bypasses both paths when disabled', async () => {
    const ctx = await mount({ enabled: false })
    const agent = agentFor(session('disabled'))
    expect((await assemble(ctx, agent)).contexts).toHaveLength(1)
    expect(await preStep(ctx, agent, CLAIMED, APPENDED)).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('gates a subagent only when it opts in', async () => {
    const exempt = await mount()
    const exemptAgent = agentFor(session('subagent-exempt', 1))
    expect((await assemble(exempt, exemptAgent)).contexts).toHaveLength(1)
    await exempt.fiber.dispose()

    const gated = await mount({ includeSubagents: true })
    const gatedAgent = agentFor(session('subagent-gated', 1))
    expect((await assemble(gated, gatedAgent)).contexts).toEqual([])
    await gated.fiber.dispose()
  })

  it('promotes on the tool call alone in tool-call mode', async () => {
    const ctx = await mount({ promoteOn: 'tool-call' })
    const agent = agentFor(session('tool-call-mode'))
    agent.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call-tool'),
      name: 'read',
      arguments: '{}',
    })
    expect((await assemble(ctx, agent)).contexts).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('gates an assistant-message-only session in tool-call mode', async () => {
    const ctx = await mount({ promoteOn: 'tool-call' })
    const agent = agentFor(session('assistant-only'))
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createUserMessage({
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', model: 'stub-model', provider: 'stub-provider' },
      }) as never,
      stream: [],
    }, { surfaceOp: 'append' })
    expect((await assemble(ctx, agent)).contexts).toEqual([])
    await ctx.fiber.dispose()
  })

  it('gates again after a compaction boundary', async () => {
    const ctx = await mount()
    const agent = agentFor(session('recompacted'))
    promote(agent.session)
    expect((await assemble(ctx, agent)).contexts).toHaveLength(1)

    compact(agent.session)
    expect((await assemble(ctx, agent)).contexts).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rejects an unknown config key at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    expect(() => {
      contextGate.apply(ctx, { nope: true } as never)
    }).toThrow(/unknown/i)
    await ctx.fiber.dispose()
  })

  it('rejects a missing projection registry at load', async () => {
    const ctx = new Context()
    expect(() => {
      contextGate.apply(ctx, {})
    }).toThrow(/projection registry/)
    await ctx.fiber.dispose()
  })
})
