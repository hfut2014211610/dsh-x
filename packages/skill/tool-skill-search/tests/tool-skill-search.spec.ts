/**
 * Skill search: keyword matching across name, description, and when-to-use;
 * the model-invocation visibility rule; the bounded result list with its overflow
 * count; the no-match reply; an empty query matching every visible skill;
 * loading a skill's body into the agent's inbox; the missing-skill,
 * not-model-invocable, and empty-body replies; and both tools reporting an
 * unavailable skills registry instead of throwing.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SkillRegistry, { type SkillRegistration } from '@deepseek-ai/dsh-skill'
import * as skillSearch from '@deepseek-ai/dsh-tool-skill-search'

const SIGNAL = new AbortController().signal

/** The text blocks one injected message carries. */
function rendered(message: UserMessage | undefined): string {
  return (message?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Skills the registry offers, in registration order. */
const SKILLS: SkillRegistration[] = [
  {
    name: 'pdf-forms',
    description: 'Fill and read PDF forms\nsecond line',
    whenToUse: 'when a PDF arrives',
    content: 'Fill and read PDF forms\nsecond line',
    source: 'bundled',
  },
  { name: 'obsidian-vault', description: 'Work with an Obsidian vault', content: 'obsidian body', source: 'bundled' },
  { name: 'game-review', description: 'Summarize a game review', content: 'game body', source: 'bundled' },
  {
    name: 'secret-skill',
    description: 'Not for models',
    content: 'secret body',
    source: 'bundled',
    invocation: { modelInvocable: false, userInvocable: true },
  },
  { name: 'empty-skill', description: 'Has no body', content: '', source: 'bundled' },
]

function session(id: string): Session {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    isSeeded: false,
    cwd: '/work',
  }
  return Session.create(SessionId(id), undefined, header)
}

/** An agent recording what the tools injected into its inbox. */
function agentFor(session: Session, injected: UserMessage[]): Agent {
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
    inject: (message: UserMessage) => { injected.push(message) },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function mount(): Promise<{ ctx: Context; injected: UserMessage[]; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  for (const skill of SKILLS) ctx.skills.register(skill)
  const injected: UserMessage[] = []
  const agent = agentFor(session('skills'), injected)
  await ctx.plugin(skillSearch)
  return { ctx, injected, agent }
}

let nextCall = 0

/** Call one tool through the registry and return its rendered text. */
async function call(ctx: Context, name: string, args: unknown, agent?: Agent): Promise<string> {
  nextCall += 1
  const result = await ctx.tools.execute({
    callId: ToolCallId(`call-${nextCall}`),
    name,
    arguments: args,
    signal: SIGNAL,
    ...(agent === undefined ? {} : { agent }),
  })
  if (result.isError) throw new Error(`${name} reported a failure`)
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('skill search', () => {
  it('finds a skill by name, description, or when-to-use', async () => {
    const { ctx } = await mount()
    expect(await call(ctx, 'skill_search', { query: 'pdf' })).toContain('pdf-forms: Fill and read PDF forms')
    expect(await call(ctx, 'skill_search', { query: 'obsidian' })).toContain('obsidian-vault:')
    expect(await call(ctx, 'skill_search', { query: 'pdf arrives' })).toContain('pdf-forms:')
    await ctx.fiber.dispose()
  })

  it('requires every token to match', async () => {
    const { ctx } = await mount()
    expect(await call(ctx, 'skill_search', { query: 'game review' })).toContain('game-review:')
    expect(await call(ctx, 'skill_search', { query: 'game pdf' })).toContain('No skills match')
    await ctx.fiber.dispose()
  })

  it('hides skills the model may not invoke', async () => {
    const { ctx } = await mount()
    const text = await call(ctx, 'skill_search', { query: '' })
    expect(text).not.toContain('secret-skill')
    expect(text).toContain('pdf-forms:')
    await ctx.fiber.dispose()
  })

  it('quotes only the first description line', async () => {
    const { ctx } = await mount()
    expect(await call(ctx, 'skill_search', { query: 'pdf' })).not.toContain('second line')
    await ctx.fiber.dispose()
  })

  it('reports a query that matches nothing', async () => {
    const { ctx } = await mount()
    expect(await call(ctx, 'skill_search', { query: 'kubernetes' }))
      .toContain('No skills match "kubernetes". Use skill_search with other keywords.')
    await ctx.fiber.dispose()
  })

  it('treats a malformed query as matching everything visible', async () => {
    const { ctx } = await mount()
    expect(await call(ctx, 'skill_search', { query: 42 })).toContain('pdf-forms:')
    await ctx.fiber.dispose()
  })

  it('bounds the result list and counts the overflow', async () => {
    const { ctx } = await mount()
    for (let index = 0; index < 25; index += 1) {
      ctx.skills.register({
        name: `filler-${index}`,
        description: 'shared filler token',
        content: 'filler body',
        source: 'bundled',
      })
    }
    const text = await call(ctx, 'skill_search', { query: 'filler' })
    expect(text).toContain('Matching skills (25):')
    expect(text).toContain('…(5 more)')
    await ctx.fiber.dispose()
  })

  it('loads a skill body into the agent inbox', async () => {
    const { ctx, injected, agent } = await mount()
    const text = await call(ctx, 'skill_load', { name: 'pdf-forms' }, agent)
    expect(text).toContain('Skill "pdf-forms" loaded')
    expect(injected).toHaveLength(1)
    expect(injected[0]?.source.kind).toBe('skill-invocation')
    expect(rendered(injected[0])).toContain('Fill and read PDF forms')
    await ctx.fiber.dispose()
  })

  it('reports a skill that does not exist', async () => {
    const { ctx, agent } = await mount()
    expect(await call(ctx, 'skill_load', { name: 'no-such-skill' }, agent))
      .toContain('No skill named "no-such-skill". Run skill_search to list available skills.')
    await ctx.fiber.dispose()
  })

  it('refuses a skill the model may not invoke', async () => {
    const { ctx, injected, agent } = await mount()
    expect(await call(ctx, 'skill_load', { name: 'secret-skill' }, agent))
      .toContain('Skill "secret-skill" is not available for model invocation.')
    expect(injected).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('injects a skill whose body is empty', async () => {
    const { ctx, injected, agent } = await mount()
    expect(await call(ctx, 'skill_load', { name: 'empty-skill' }, agent)).toContain('Skill "empty-skill" loaded')
    expect(rendered(injected[0])).toContain('<skill_instructions>')
    await ctx.fiber.dispose()
  })

  it('requires an agent context to load', async () => {
    const { ctx } = await mount()
    expect(await call(ctx, 'skill_load', { name: 'pdf-forms' }))
      .toContain('skill_load requires an agent context.')
    await ctx.fiber.dispose()
  })

  it('stays unmounted without a skills registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(skillSearch)
    // The plugin declares skills as an injection, so it does not apply.
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('skill_search')
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('skill_load')
    await ctx.fiber.dispose()
  })

  it('removes both tools when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(skillSearch)
    expect(ctx.tools.schemas().map(s => s.name)).toEqual(expect.arrayContaining(['skill_search', 'skill_load']))
    await fiber.dispose()
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('skill_search')
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('skill_load')
    await ctx.fiber.dispose()
  })
})
