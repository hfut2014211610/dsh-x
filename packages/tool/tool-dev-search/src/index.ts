/**
 * dev-tool-search — on-demand tool discovery and unlock, the tool-search
 * pattern for the anchored preset.
 *
 * The promoted phase keeps only a minimal resident set (shell +
 * str_replace_editor + the discovery tools) instead of dumping the whole
 * Standard catalog at once. This plugin registers ONE small tool:
 *
 *  - `dev_tool_search` — search the FULL assembled catalog by keyword and
 *    return matching tool names with short descriptions; optionally unlock
 *    tools by exact name (array `toolNames`). The unlock is recorded as this
 *    call's durable `tool/call` arguments, and the companion tool-bootstrap
 *    filter exposes those names from the next request on (resume-safe).
 *
 * The tool description is deliberately an INDEX of what the minimal resident
 * set cannot do: the model should reach for `dev_tool_search` the moment a task
 * needs internet, delegation, workflows, goals, images, background jobs, or
 * multi-agent coordination — not try to work around them with bash.
 *
 * @module @deepseek-ai/dsh-tool-dev-search
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dev-tool-search'

/** The tools registry must exist before this tool can register. */
export const inject = ['tools']

/** Upper bound on returned matches, so a broad query cannot flood the turn. */
const MAX_RESULTS = 25

/** Characters of each matching tool's description included in the result. */
const DESCRIPTION_CHARS = 90

/**
 * The capability index: resident minimal tools (bash / str_replace_editor /
 * skill_search / skill_load) cannot cover these, so the model must search and
 * unlock them on demand. Kept in the description so the model KNOWS what exists
 * without a full catalog dump.
 */
const UNLOCKABLE_INDEX = [
  'web_search — internet search and web retrieval',
  'subagent / subagent_fork — delegate work to sub-agents',
  'workflow — run multi-agent workflow scripts',
  'ralph — fresh-agent iterative loop',
  'create_goal / get_goal / update_goal — long-running goals',
  'read_image — read image files',
  'job_list / job_output / job_kill — background jobs',
  'interrupt_agent / send_message / list_agents — multi-agent control',
  'todo_write — task tracking',
  'ask_user_question — ask the user',
]

/** The `dev_tool_search` tool description sent to the model. */
const DESCRIPTION = [
  'Discover and unlock tools that are NOT currently available.',
  '',
  'This session starts with a minimal resident set: bash, str_replace_editor, skill_search, skill_load. Everything else is unlocked on demand through this tool.',
  '',
  'If the current task needs any of the following, call dev_tool_search FIRST — do not try to work around them with bash:',
  ...UNLOCKABLE_INDEX.map(line => `- ${line}`),
  '',
  'Usage: pass `query` to search the catalog (returns matching tool names + descriptions), then pass `toolNames` with exact names to unlock them. Unlocked tools appear from the next request on and stay unlocked for the session.',
].join('\n')

/** Arguments this tool accepts, as the JSON Schema sent to the model. */
const PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'search keywords (e.g. "web", "subagent")' },
    toolNames: { type: 'array', description: 'exact tool names to unlock', items: { type: 'string' } },
  },
  required: [],
  additionalProperties: false,
}

/** The tool's one canonical output field: rendered text. */
const OUTPUT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
}

/**
 * Read the two accepted argument fields out of one parsed call.
 *
 * Arguments are model-produced JSON, a boundary this tool validates itself:
 * a non-string `query` and a non-array `toolNames` contribute nothing rather
 * than failing the call.
 *
 * @param args - the losslessly snapshotted call arguments.
 * @returns the trimmed query and the non-empty tool names.
 */
function readArguments(args: unknown): { query: string; unlock: string[] } {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { query: '', unlock: [] }
  }
  const { query, toolNames } = args as { query?: unknown; toolNames?: unknown }
  return {
    query: typeof query === 'string' ? query.trim() : '',
    unlock: Array.isArray(toolNames)
      ? toolNames.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
  }
}

/**
 * Format one search result over the schemas visible to the executing agent.
 *
 * The executing agent IS the viewing scope: preset tools register into the
 * agent-scope layer of the registry, and `schemas()` with no scope only sees
 * the global layer — every preset-provided tool would be invisible to keyword
 * search. Same pattern as the harness's own code mode.
 *
 * @param ctx - the plugin context, whose tools registry is the search surface.
 * @param exec - the running call, whose agent selects the scope.
 * @param query - the trimmed search query.
 * @returns the result lines, or one line describing why the search failed.
 */
function searchCatalog(ctx: Context, exec: ToolRunContext, query: string): string[] {
  try {
    const wanted = query.toLowerCase().split(/[^a-z0-9_]+/).filter(token => token.length > 0)
    const all = ctx.tools.schemas(exec.agent).filter((schema) => {
      const haystack = `${schema.name} ${schema.description}`.toLowerCase()
      return wanted.every(token => haystack.includes(token))
    })
    if (all.length === 0) return [`No tools match "${query}".`]
    const matches = all.slice(0, MAX_RESULTS)
    const lines = [
      `Matching tools (${matches.length}${all.length > MAX_RESULTS ? ` of ${all.length}` : ''}):`,
      ...matches.map((schema) => {
        const firstLine = schema.description.split('\n')[0] ?? ''
        return `- ${schema.name}: ${firstLine.slice(0, DESCRIPTION_CHARS)}`
      }),
    ]
    if (all.length > MAX_RESULTS) {
      lines.push(`(truncated at ${MAX_RESULTS} — add tokens to narrow the query, e.g. "mcp browser" or "mcp tavily")`)
    }
    lines.push('Unlock with dev_tool_search({"toolNames": ["<exact name>"]}).')
    return lines
  } catch (error: unknown) {
    return [`catalog search unavailable: ${error instanceof Error ? error.message : String(error)}`]
  }
}

/**
 * Read the rendered text out of this tool's canonical output value.
 *
 * The registry validates every successful value against {@link OUTPUT_SCHEMA}
 * before `render` runs, so `text` is a string here.
 *
 * @param value - the canonical output value.
 * @returns its `text` field.
 */
function renderText(value: JsonValue): string {
  const { text } = value as { readonly text: string }
  return text
}

/** Register the model-facing `dev_tool_search` tool. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register({
    name: 'dev_tool_search',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: JsonValue): ContentBlock[] => [
        { type: 'text', text: renderText(value) },
      ],
    },
    execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const { query, unlock } = readArguments(args)
      const lines: string[] = []
      if (unlock.length > 0) {
        lines.push(`Unlocked for the next request: ${unlock.join(', ')}`)
      }
      if (query.length === 0) {
        lines.push(unlock.length > 0
          ? ''
          : 'Provide `query` to search the catalog, or `toolNames` to unlock tools.')
        return Promise.resolve({ text: lines.filter(line => line.length > 0).join('\n') })
      }
      lines.push(...searchCatalog(ctx, exec, query))
      return Promise.resolve({ text: lines.join('\n') })
    },
  }))
}
