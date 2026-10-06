/**
 * Compaction-epoch promotion state: the fresh-session phase, each signal mode,
 * demotion at a compaction boundary with the boundary sequence recorded, the
 * subagent exemption and its opt-in, the out-of-agent read, and the reads
 * taken before the unit is registered and after it is disposed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionRegistry as Registry } from '@deepseek-ai/dsh-session-projection'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import { promotionStatus, registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'
import type {} from '@deepseek-ai/dsh-compaction/types'

async function mount(register: boolean): Promise<{ ctx: Context; registry: Registry; dispose: () => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  const registry = ctx.get('sessionProjections') as Registry
  const dispose = register ? registerPromotionEpoch(registry) : () => {}
  return { ctx, registry, dispose }
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
    inject: () => { throw new Error('promotion never injects into the step') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function callTool(session: Session): void {
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId('call-1'),
    name: 'read',
    arguments: '{}',
  })
}

function reply(session: Session): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { model: 'stub-model', provider: 'stub-provider' } }),
    stream: [],
  }, { surfaceOp: 'append' })
}

/** Compact the session and return the `compaction/end` sequence. */
function compact(session: Session): number {
  const compactionId = 'compact-1' as CompactionId
  session.append('compaction/start', { compactionId, turn: 1 })
  return session.append('compaction/end', { compactionId, turn: 1 }).seq
}

describe('promotion epoch', () => {
  it('reads an unpromoted epoch with no boundary on a fresh session', async () => {
    const { ctx, registry } = await mount(true)
    const agent = agentFor(session('fresh'))
    expect(promotionStatus(registry, agent, 'either', false)).toEqual({ boundary: null, promoted: false })
    await ctx.fiber.dispose()
  })

  it('promotes on either signal for the default mode', async () => {
    const { ctx, registry } = await mount(true)
    const viaToolCall = agentFor(session('either-tool-call'))
    callTool(viaToolCall.session)
    expect(promotionStatus(registry, viaToolCall, 'either', false).promoted).toBe(true)

    const viaAssistant = agentFor(session('either-assistant'))
    reply(viaAssistant.session)
    expect(promotionStatus(registry, viaAssistant, 'either', false).promoted).toBe(true)
    await ctx.fiber.dispose()
  })

  it('promotes only on the named signal for a single-signal mode', async () => {
    const { ctx, registry } = await mount(true)
    const viaToolCall = agentFor(session('mode-tool-call'))
    callTool(viaToolCall.session)
    expect(promotionStatus(registry, viaToolCall, 'tool-call', false).promoted).toBe(true)
    expect(promotionStatus(registry, viaToolCall, 'assistant-message', false).promoted).toBe(false)

    const viaAssistant = agentFor(session('mode-assistant-message'))
    reply(viaAssistant.session)
    expect(promotionStatus(registry, viaAssistant, 'assistant-message', false).promoted).toBe(true)
    expect(promotionStatus(registry, viaAssistant, 'tool-call', false).promoted).toBe(false)
    await ctx.fiber.dispose()
  })

  it('demotes at a compaction boundary and records that sequence', async () => {
    const { ctx, registry } = await mount(true)
    const agent = agentFor(session('compacted'))
    callTool(agent.session)
    expect(promotionStatus(registry, agent, 'either', false).promoted).toBe(true)

    const boundary = compact(agent.session)
    expect(promotionStatus(registry, agent, 'either', false))
      .toEqual({ boundary, promoted: false })

    callTool(agent.session)
    expect(promotionStatus(registry, agent, 'either', false))
      .toEqual({ boundary, promoted: true })
    await ctx.fiber.dispose()
  })

  it('drops an earlier promotion when the boundary follows it', async () => {
    const { ctx, registry } = await mount(true)
    const agent = agentFor(session('promote-then-compact'))
    callTool(agent.session)
    reply(agent.session)
    expect(promotionStatus(registry, agent, 'either', false).promoted).toBe(true)

    compact(agent.session)
    expect(promotionStatus(registry, agent, 'either', false).promoted).toBe(false)
    await ctx.fiber.dispose()
  })

  it('exempts subagents unless they opt into the phase', async () => {
    const { ctx, registry } = await mount(true)
    const agent = agentFor(session('child', 1))
    expect(promotionStatus(registry, agent, 'either', false)).toEqual({ boundary: null, promoted: true })
    expect(promotionStatus(registry, agent, 'either', true)).toEqual({ boundary: null, promoted: false })
    await ctx.fiber.dispose()
  })

  it('reads a turn outside any agent as promoted', async () => {
    const { ctx, registry } = await mount(true)
    expect(promotionStatus(registry, undefined, 'either', false)).toEqual({ boundary: null, promoted: true })
    await ctx.fiber.dispose()
  })

  it('reads unpromoted before the unit is registered', async () => {
    const { ctx, registry } = await mount(false)
    const agent = agentFor(session('unregistered'))
    callTool(agent.session)
    expect(promotionStatus(registry, agent, 'either', false)).toEqual({ boundary: null, promoted: false })
    await ctx.fiber.dispose()
  })

  it('removes the unit when the last registration is disposed', async () => {
    const { ctx, registry, dispose } = await mount(true)
    const extra = registerPromotionEpoch(registry)
    const agent = agentFor(session('shared'))
    callTool(agent.session)
    expect(promotionStatus(registry, agent, 'either', false).promoted).toBe(true)

    extra()
    dispose()
    expect(registry.stateOf(agent.session, 'promotionEpoch')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps one epoch while several registrations share the key', async () => {
    const { ctx, registry, dispose } = await mount(true)
    const extra = registerPromotionEpoch(registry)
    const agent = agentFor(session('refcounted'))
    callTool(agent.session)
    extra()
    expect(promotionStatus(registry, agent, 'either', false).promoted).toBe(true)
    dispose()
    await ctx.fiber.dispose()
  })
})
