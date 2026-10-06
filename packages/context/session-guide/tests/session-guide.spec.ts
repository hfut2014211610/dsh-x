/**
 * Session guide: nothing before promotion; one guidance per real user turn,
 * spliced after the claimed batch and before appended context; nothing on a
 * tool-continuation step; a resumed session recognizing its own guidance; the
 * complex-text dispatch by pattern and by length; `enabled: false` inert; and
 * load-time failure on invalid configuration or a composition without the
 * projection registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import * as sessionGuide from '@deepseek-ai/dsh-session-guide'
import type { Config } from '@deepseek-ai/dsh-session-guide'
import type {} from '@deepseek-ai/dsh-compaction/types'

const SIGNAL = new AbortController().signal

async function mount(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(sessionGuide, config)
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
    inject: () => { throw new Error('the guide never injects into the step directly') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function promote(session: Session): void {
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId('call-1'),
    name: 'bash',
    arguments: '{}',
  })
}

function compact(session: Session): void {
  const compactionId = 'compact-1' as CompactionId
  session.append('compaction/start', { compactionId, turn: 1 })
  session.append('compaction/end', { compactionId, turn: 1 })
}

let nextUser = 0

/** A user message, as the loop would claim it from the inbox. */
function userTurn(text: string): UserMessage {
  nextUser += 1
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** Runtime context a downstream listener appended after the claimed batch. */
function appended(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'runtime context' }],
    source: { kind: 'tmux-context', form: 'snapshot', sections: [{ name: 'tmux', text: 'runtime context' }] },
  })
}

/** Run one step over `claimed`, appending `context` as a later listener would. */
async function step(
  ctx: Context,
  agent: Agent,
  claimed: UserMessage[],
  context: UserMessage[] = [],
): Promise<UserMessage[]> {
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: claimed, turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: [...claimed, ...context] }),
  )
  if (decision.kind !== 'enter') return []
  for (const message of decision.messages) {
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }
  return decision.messages
}

function guideTexts(messages: readonly UserMessage[]): string[] {
  return messages
    .filter(message => message.source.kind === 'session-guide')
    .map(message => message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(''))
}

describe('session guide', () => {
  it('injects nothing before promotion', async () => {
    const ctx = await mount()
    expect(guideTexts(await step(ctx, agentFor(session('unpromoted')), [userTurn('go')]))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('injects one guidance after the claimed batch once promoted', async () => {
    const ctx = await mount()
    const agent = agentFor(session('promoted'))
    promote(agent.session)
    const claimed = [userTurn('go')]
    const messages = await step(ctx, agent, claimed, [appended()])
    expect(guideTexts(messages)).toHaveLength(1)
    const guideAt = messages.findIndex(message => message.source.kind === 'session-guide')
    const contextAt = messages.findIndex(message => message.source.kind === 'tmux-context')
    expect(guideAt).toBe(1)
    expect(contextAt).toBeGreaterThan(guideAt)
    await ctx.fiber.dispose()
  })

  it('injects nothing on a step claiming no user message', async () => {
    const ctx = await mount()
    const agent = agentFor(session('continuation'))
    promote(agent.session)
    expect(guideTexts(await step(ctx, agent, []))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('injects nothing after a compaction boundary until re-promotion', async () => {
    const ctx = await mount()
    const agent = agentFor(session('recompacted'))
    promote(agent.session)
    compact(agent.session)
    expect(guideTexts(await step(ctx, agent, [userTurn('go')]))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('does not repeat guidance for a user message it already guided', async () => {
    const ctx = await mount()
    const agent = agentFor(session('once'))
    promote(agent.session)
    const claimed = [userTurn('go')]
    expect(guideTexts(await step(ctx, agent, claimed))).toHaveLength(1)
    expect(guideTexts(await step(ctx, agent, claimed))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('guides each of two user turns once', async () => {
    const ctx = await mount()
    const agent = agentFor(session('two-turns'))
    promote(agent.session)
    expect(guideTexts(await step(ctx, agent, [userTurn('first')]))).toHaveLength(1)
    expect(guideTexts(await step(ctx, agent, [userTurn('second')]))).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('recognizes guidance already durable when the plugin restarts', async () => {
    const ctx = await mount()
    const agent = agentFor(session('resumed'))
    promote(agent.session)
    await step(ctx, agent, [userTurn('go')])
    await ctx.fiber.dispose()

    const restarted = await mount()
    const restored = agentFor(session('resumed'))
    // The projection already holds the guided id, so no in-process state is needed.
    expect(guideTexts(await step(restarted, restored, [userTurn('go')]))).toEqual([])
    await restarted.fiber.dispose()
  })

  it('uses the complex text when the pattern matches', async () => {
    const ctx = await mount({
      text: 'plain guidance',
      complexText: 'complex guidance',
      complexPattern: 'refactor',
    })
    const agent = agentFor(session('complex-pattern'))
    promote(agent.session)
    expect(guideTexts(await step(ctx, agent, [userTurn('please refactor this')]))).toEqual(['complex guidance'])
    expect(guideTexts(await step(ctx, agent, [userTurn('just say hi')]))).toEqual(['plain guidance'])
    await ctx.fiber.dispose()
  })

  it('uses the complex text above the length threshold', async () => {
    const ctx = await mount({
      text: 'plain guidance',
      complexText: 'complex guidance',
      complexLengthThreshold: 10,
    })
    const agent = agentFor(session('complex-length'))
    promote(agent.session)
    expect(guideTexts(await step(ctx, agent, [userTurn('a much longer request than ten characters')])))
      .toEqual(['complex guidance'])
    expect(guideTexts(await step(ctx, agent, [userTurn('short')]))).toEqual(['plain guidance'])
    await ctx.fiber.dispose()
  })

  it('ignores the complex text when it is not configured', async () => {
    const ctx = await mount({ text: 'plain guidance', complexPattern: 'refactor' })
    const agent = agentFor(session('no-complex-text'))
    promote(agent.session)
    expect(guideTexts(await step(ctx, agent, [userTurn('please refactor this')]))).toEqual(['plain guidance'])
    await ctx.fiber.dispose()
  })

  it('stays inert when disabled', async () => {
    const ctx = await mount({ enabled: false })
    const agent = agentFor(session('disabled'))
    promote(agent.session)
    expect(guideTexts(await step(ctx, agent, [userTurn('go')]))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('waits for a subagent signal unless it opts in', async () => {
    const exempt = await mount()
    expect(guideTexts(await step(exempt, agentFor(session('subagent-exempt', 1)), [userTurn('go')]))).toHaveLength(1)
    await exempt.fiber.dispose()

    const gated = await mount({ includeSubagents: true })
    expect(guideTexts(await step(gated, agentFor(session('subagent-gated', 1)), [userTurn('go')]))).toEqual([])
    await gated.fiber.dispose()
  })

  it('names the user message its guidance follows', async () => {
    const ctx = await mount()
    const agent = agentFor(session('attribution'))
    promote(agent.session)
    const claimed = [userTurn('go')]
    const guide = (await step(ctx, agent, claimed))
      .find(message => message.source.kind === 'session-guide')
    expect(guide?.source.kind).toBe('session-guide')
    if (guide?.source.kind !== 'session-guide') throw new Error('the guide message is missing')
    expect(guide.source.forMessage).toBe(claimed[0]?.id)
    await ctx.fiber.dispose()
  })

  it('rejects invalid configuration at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    expect(() => {
      sessionGuide.apply(ctx, { nope: true } as never)
    }).toThrow(/unknown config key/)
    expect(() => {
      sessionGuide.apply(ctx, { text: '   ' })
    }).toThrow(/non-empty string/)
    expect(() => {
      sessionGuide.apply(ctx, { complexPattern: '(' })
    }).toThrow(/not a valid regex/)
    expect(() => {
      sessionGuide.apply(ctx, { complexLengthThreshold: 0 })
    }).toThrow(/positive integer/)
    await ctx.fiber.dispose()
  })

  it('rejects a missing projection registry at load', async () => {
    const ctx = new Context()
    expect(() => {
      sessionGuide.apply(ctx, {})
    }).toThrow(/projection registry/)
    await ctx.fiber.dispose()
  })
})
