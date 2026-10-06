/**
 * Instruction hint: no hint before promotion; a hint naming the project-root
 * instruction files, the harness-home file, or both; no hint when neither
 * exists; exactly one hint per session across steps; a hint already durable in
 * the log — under the current kind or the legacy `plugin` spelling — suppressing
 * a second one; an unreadable probe degrading to no hint; a composition without
 * the filesystem seam yielding no hint; the subagent exemption and its opt-in;
 * and load-time failure on invalid configuration or a composition without the
 * projection registry.
 */

import { describe, expect, it } from 'vitest'
import { parse, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as instructionHint from '@deepseek-ai/dsh-agent-instruction-hint'
import type { Config, HintFileSystem } from '@deepseek-ai/dsh-agent-instruction-hint'

const SIGNAL = new AbortController().signal

/** One project root shared by the fixtures below. */
const PROJECT_ROOT = resolve('/workspace/project')
/** The platform's filesystem root, where the project-root walk terminates. */
const PLATFORM_ROOT = parse(PROJECT_ROOT).root

/**
 * A probe double over a fixed set of existing paths. It answers only the two
 * questions the hint asks, so a plugin change that probes anything else cannot
 * pass unnoticed.
 */
class ProbeFiles implements HintFileSystem {
  /** Resolved paths reported as existing directories, including root markers. */
  readonly directories = new Set<string>([PROJECT_ROOT, resolve(PROJECT_ROOT, '.git')])
  /** Resolved paths reported as existing regular files. */
  readonly files = new Set<string>()
  /** Resolved paths whose probe rejects, exercising the degrade path. */
  readonly unreadable = new Set<string>()

  async exists(resolvedPath: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    if (this.unreadable.has(resolvedPath)) throw new Error(`unreadable: ${resolvedPath}`)
    return this.directories.has(resolvedPath) || this.files.has(resolvedPath)
  }

  async isFile(resolvedPath: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    if (this.unreadable.has(resolvedPath)) throw new Error(`unreadable: ${resolvedPath}`)
    return this.files.has(resolvedPath)
  }
}

/** Mount the registry and the hint with a filesystem seam. */
async function mount(config: Config = {}): Promise<{ ctx: Context; fs: ProbeFiles }> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  const fs = new ProbeFiles()
  instructionHint.apply(ctx, config, { fileSystem: () => fs })
  return { ctx, fs }
}

/** Mount the hint with no filesystem seam at all. */
async function mountWithoutFs(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  instructionHint.apply(ctx, config, { fileSystem: () => undefined })
  return ctx
}

function session(id: string, delegationDepth?: number): Session {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    isSeeded: false,
    cwd: PROJECT_ROOT,
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
    inject: () => { throw new Error('the hint never injects into the step directly') },
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

/** Run one step, append its messages to the log as the loop does, and return them. */
async function step(ctx: Context, agent: Agent): Promise<UserMessage[]> {
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  if (decision.kind !== 'enter') return []
  for (const message of decision.messages) {
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }
  return decision.messages
}

/** The hint texts this step produced. */
function hintTexts(messages: readonly UserMessage[]): string[] {
  return messages
    .filter(message => message.source.kind === 'instruction-hint')
    .map(message => message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(''))
}

describe('instruction hint', () => {
  it('injects nothing before promotion', async () => {
    const { ctx, fs } = await mount()
    fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    expect(hintTexts(await step(ctx, agentFor(session('unpromoted'))))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('names the project instruction files after promotion', async () => {
    const { ctx, fs } = await mount()
    fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    fs.files.add(resolve(PROJECT_ROOT, 'CLAUDE.local.md'))
    const agent = agentFor(session('project-hint'))
    promote(agent.session)
    const [text] = hintTexts(await step(ctx, agent))
    expect(text).toContain('AGENTS.md, CLAUDE.local.md')
    expect(text).toContain(PROJECT_ROOT)
    expect(text).toContain('read the relevant instruction files first')
    await ctx.fiber.dispose()
  })

  it('injects nothing when no instruction file exists', async () => {
    const { ctx } = await mount()
    const agent = agentFor(session('no-files'))
    promote(agent.session)
    expect(hintTexts(await step(ctx, agent))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('injects nothing when the project root is never marked', async () => {
    const { ctx, fs } = await mount()
    fs.directories.delete(resolve(PROJECT_ROOT, '.git'))
    fs.files.add(resolve(PLATFORM_ROOT, 'AGENTS.md'))
    const agent = agentFor(session('no-marker'))
    promote(agent.session)
    const [text] = hintTexts(await step(ctx, agent))
    // With no marker anywhere the walk stops at the platform's filesystem root.
    expect(text).toContain('AGENTS.md')
    expect(text).toContain(`project root: ${PLATFORM_ROOT}`)
    await ctx.fiber.dispose()
  })

  it('injects nothing when every probe is unreadable', async () => {
    const { ctx, fs } = await mount()
    fs.unreadable.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    const agent = agentFor(session('unreadable'))
    promote(agent.session)
    expect(hintTexts(await step(ctx, agent))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('injects nothing without a filesystem seam', async () => {
    const ctx = await mountWithoutFs()
    const agent = agentFor(session('no-fs'))
    promote(agent.session)
    expect(hintTexts(await step(ctx, agent))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('injects at most one hint per session', async () => {
    const { ctx, fs } = await mount()
    fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    const agent = agentFor(session('once'))
    promote(agent.session)
    expect(hintTexts(await step(ctx, agent))).toHaveLength(1)
    expect(hintTexts(await step(ctx, agent))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('reads a resumed session as already hinted', async () => {
    const { ctx, fs } = await mount()
    fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    const resumed = agentFor(session('resumed'))
    promote(resumed.session)
    expect(hintTexts(await step(ctx, resumed))).toHaveLength(1)
    // A fresh plugin instance stands in for a process restart: its in-process
    // claim set is empty, so only the durable projection can suppress the hint.
    const restarted = new Context()
    await restarted.plugin(SessionProjectionRegistry)
    instructionHint.apply(restarted, {}, { fileSystem: () => fs })
    const restored = agentFor(session('resumed'))
    expect(hintTexts(await step(restarted, restored))).toEqual([])
    await restarted.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('skips a hint already recorded under the legacy plugin kind', async () => {
    const { ctx, fs } = await mount()
    fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    const agent = agentFor(session('legacy-hinted'))
    promote(agent.session)
    agent.session.append('user/message', {
      id: 'legacy-hint',
      role: 'user',
      content: [{ type: 'text', text: 'Workspace instruction files exist: AGENTS.md' }],
      source: { kind: 'plugin', plugin: 'instruction-hint', form: 'instructions' },
    } as never, { surfaceOp: 'append' })
    expect(hintTexts(await step(ctx, agent))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('hints a subagent immediately unless it opts in', async () => {
    const exempt = await mount()
    exempt.fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    expect(hintTexts(await step(exempt.ctx, agentFor(session('subagent-exempt', 1))))).toHaveLength(1)
    await exempt.ctx.fiber.dispose()

    const gated = await mount({ includeSubagents: true })
    gated.fs.files.add(resolve(PROJECT_ROOT, 'AGENTS.md'))
    expect(hintTexts(await step(gated.ctx, agentFor(session('subagent-gated', 1))))).toEqual([])
    await gated.ctx.fiber.dispose()
  })

  it('rejects invalid configuration at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    expect(() => {
      instructionHint.apply(ctx, { nope: true } as never)
    }).toThrow(/unknown config key/)
    await ctx.fiber.dispose()
  })

  it('rejects a missing projection registry at load', async () => {
    const ctx = new Context()
    expect(() => {
      instructionHint.apply(ctx, {})
    }).toThrow(/projection registry/)
    await ctx.fiber.dispose()
  })
})
