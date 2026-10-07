/**
 * skill-search — on-demand skill discovery and loading, replacing
 * `dsh-tool-skill`'s full-catalog injection.
 *
 * WHY: the available-skills reminder (`<available_skills>`, ~9KB with many
 * skills) is injected into the first step by `dsh-tool-skill` and again after
 * every promotion and compaction. That large injected block perturbs the
 * trajectory — the upstream reproduction measured 0/9 sessions anchored with the
 * catalog present against roughly 81% without it. This package removes the
 * catalog injection entirely and exposes two small tools instead, which is the
 * Claude tool-search pattern:
 *
 *  - `skill_search` — list skills whose name, description, or when-to-use text
 *    matches a query (summaries only, bounded; no bodies). The model discovers
 *    what exists without a 9KB dump.
 *  - `skill_load` — load ONE skill's full instructions by exact name and inject
 *    them for the NEXT request through the agent's non-waking next-step inbox.
 *    The model (or the user) calls this only when the skill is needed.
 *
 * Discovery reads `ctx.skills` scoped to the calling agent, exactly like
 * `dsh-tool-skill`, and keeps its visibility rule: only skills whose invocation
 * is model-invocable reach the model. Unavailable skills make both tools answer
 * with a short message instead of throwing.
 *
 * This package REPLACES the `dsh-tool-skill` row in the composition: mounting
 * both brings the catalog injection back.
 *
 * @module @deepseek-ai/dsh-tool-skill-search
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { isModelInvocable, renderSkillContent, type SkillInvocationSource } from '@deepseek-ai/dsh-skill'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-skill-search'

/** The agent, tools, and skills services must exist before these tools register. */
export const inject = ['agents', 'tools', 'skills']

/** Upper bound on returned matches, so a broad query cannot flood the turn. */
const MAX_RESULTS = 20

/** The one canonical output field both tools produce: rendered text. */
const OUTPUT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
}

/** Arguments `skill_search` accepts. */
const SEARCH_PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'search keywords (e.g. "pdf", "obsidian", "game review")' },
  },
  required: ['query'],
  additionalProperties: false,
}

/** Arguments `skill_load` accepts. */
const LOAD_PARAMETERS = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'exact skill name (kebab-case, from skill_search)' },
  },
  required: ['name'],
  additionalProperties: false,
}

/**
 * Read a tool's rendered text out of its canonical output value.
 *
 * The registry validates every successful value against {@link OUTPUT_SCHEMA}
 * before `render` runs, so `text` is a string here.
 *
 * @param value - the canonical output value.
 * @returns its `text` field.
 */
function renderedText(value: JsonValue): string {
  const { text } = value as { readonly text: string }
  return text
}

/**
 * Render this tool's single text field as model-facing content.
 *
 * @param _args - the call arguments; unused, both tools render one text field.
 * @param value - the canonical output value.
 * @returns one text block.
 */
function render(_args: unknown, value: JsonValue): ContentBlock[] {
  return [{ type: 'text', text: renderedText(value) }]
}

/**
 * Normalize a query or skill text into lowercase tokens for substring matching.
 *
 * @param value - the string to tokenize.
 * @returns its alphanumeric and underscore tokens.
 */
function tokens(value: string | undefined): string[] {
  return (value ?? '').toLowerCase().split(/[^a-z0-9_-]+/).filter(token => token.length > 0)
}

/**
 * Read the one required string argument out of one parsed call.
 *
 * Arguments are model-produced JSON, a boundary this tool validates itself: a
 * non-string or absent value reads as the empty string, which search treats as
 * "match everything" and load treats as "no such skill".
 *
 * @param args - the losslessly snapshotted call arguments.
 * @param field - the argument name to read.
 * @returns the trimmed string, or the empty string.
 */
function readString(args: unknown, field: 'query' | 'name'): string {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ''
  const value = (args as Record<string, unknown>)[field]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Search the model-visible skills for one query.
 *
 * @param ctx - the plugin context, whose skills registry is the search surface.
 * @param exec - the running call, whose agent selects the viewing scope.
 * @param query - the trimmed query; empty matches every visible skill.
 * @returns the reply text.
 */
async function search(ctx: Context, exec: ToolRunContext, query: string): Promise<string> {
  const wanted = tokens(query)
  try {
    const all = await ctx.skills.list({
      scope: exec.agent,
      cwd: exec.agent?.session.header.cwd,
      signal: exec.signal,
    })
    const matches = all
      .filter(skill => isModelInvocable(skill))
      .filter((skill) => {
        if (wanted.length === 0) return true
        const haystack = tokens(`${skill.name} ${skill.description} ${skill.whenToUse ?? ''}`).join(' ')
        return wanted.every(token => haystack.includes(token))
      })
    if (matches.length === 0) {
      return `No skills match "${query}". Use skill_search with other keywords.`
    }
    const head = matches.slice(0, MAX_RESULTS)
    const lines = head.map(skill => `- ${skill.name}: ${skill.description.split('\n')[0] ?? ''}`)
    const extra = matches.length > MAX_RESULTS ? `\n…(${matches.length - MAX_RESULTS} more)` : ''
    return `Matching skills (${matches.length}):\n${lines.join('\n')}${extra}\n\nLoad one with skill_load (exact name).`
  } catch (error: unknown) {
    return `skill_search unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Load one skill's body into the agent's non-waking next-step inbox.
 *
 * @param ctx - the plugin context, whose skills registry resolves the skill.
 * @param exec - the running call, whose agent receives the body.
 * @param wanted - the trimmed exact skill name.
 * @returns the reply text.
 */
async function load(ctx: Context, exec: ToolRunContext, wanted: string): Promise<string> {
  try {
    const { agent } = exec
    if (agent === undefined) return 'skill_load requires an agent context.'
    const skill = await ctx.skills.get(wanted, {
      scope: agent,
      cwd: agent.session.header.cwd,
      signal: exec.signal,
    })
    if (skill === undefined) {
      return `No skill named "${wanted}". Run skill_search to list available skills.`
    }
    if (!isModelInvocable(skill)) {
      return `Skill "${wanted}" is not available for model invocation.`
    }
    const source: SkillInvocationSource = { kind: 'skill-invocation', name: wanted, form: 'instructions' }
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: renderSkillContent(skill) }],
      source,
    }))
    return `Skill "${wanted}" loaded; its instructions will be injected for the next request.`
  } catch (error: unknown) {
    return `skill_load failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Register the two on-demand skill tools. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register({
    name: 'skill_search',
    description: 'Search the available skills by keyword and return matching skill names with short descriptions. This session keeps NO skill catalog in the prompt — if a task looks like it matches a skill (document conversion, image processing, game reviews, markdown, PDF, spreadsheets, …), call skill_search FIRST to find it, then skill_load to activate it. Do NOT assume skill names from memory.',
    parameters: SEARCH_PARAMETERS,
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args: unknown, exec: ToolRunContext): Promise<unknown> =>
      search(ctx, exec, readString(args, 'query')).then(text => ({ text })),
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'skill_load',
    description: 'Load the full instructions of ONE skill by its exact name (from skill_search results) and inject them for the next request. Call this before acting on a task that matches the skill.',
    parameters: LOAD_PARAMETERS,
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args: unknown, exec: ToolRunContext): Promise<unknown> =>
      load(ctx, exec, readString(args, 'name')).then(text => ({ text })),
  }))
}
