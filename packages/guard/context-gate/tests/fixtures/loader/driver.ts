#!/usr/bin/env node
/**
 * Test driver: boot the context-gate Loader composition, then observe the
 * model-visible surface before and after the session's promotion signal — the
 * assembled runtime contexts and the messages one pre-step admits — and persist
 * the result to `./context-gate-loader-report.json` for the package spec's
 * inspect step.
 */

import { writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('context-gate driver requires a config path')

const ctx = await boot('context-gate-loader-smoke', resolveConfigPath(configPath, undefined))

/** One agent over a session with no durable history. */
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
    inject: () => { throw new Error('the driver never injects directly') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Count the runtime contexts the assembly carries. */
async function contextCount(agent: Agent): Promise<number> {
  const assembly = await ctx.systemPrompt.assemble({ agent })
  return assembly.contexts.length
}

/** Run one step and count the messages that reached the decision. */
async function admittedMessages(agent: Agent): Promise<number> {
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter' as const, messages: [] }),
  )
  return decision.kind === 'enter' ? decision.messages.length : 0
}

try {
  const session = Session.create(SessionId('loader-gate'))
  const agent = agentFor(session)

  // Before promotion the gate strips every injected runtime context.
  const contextsBefore = await contextCount(agent)
  const messagesBefore = await admittedMessages(agent)

  // A durable `tool/call` is the default promotion signal.
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId('loader-promote'),
    name: 'bash',
    arguments: '{}',
  })

  const contextsAfter = await contextCount(agent)
  const messagesAfter = await admittedMessages(agent)

  await writeFile('./context-gate-loader-report.json', JSON.stringify({
    contextsBefore,
    contextsAfter,
    messagesBefore,
    messagesAfter,
  }))
} finally {
  await ctx.fiber.dispose()
}
