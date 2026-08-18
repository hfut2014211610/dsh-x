/**
 * Model-facing document tools for writing mode.
 * @module @deepseek-ai/dsh-tool-documents
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolCallView } from '@deepseek-ai/dsh-tools'
import type { DocumentEdit, DocumentLocator } from '@deepseek-ai/dsh-documents'
import type {} from '@deepseek-ai/dsh-documents'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'tool-documents'
export const inject = ['tools', 'documents', 'systemPrompt']

/**
 * Render one read result as the model sees it: a small header, a blank line,
 * then the content.
 *
 * The header exists because `render` IS the model-facing tool result — the
 * validated `output.schema` value never reaches the model — so a body-only
 * projection drops the version that `document_edit`'s `base_version` has no
 * other source for, leaving the guarded edit path unusable. `truncated` is
 * carried for the same reason: line locators addressed against a clipped body
 * would target the wrong lines of the whole document.
 * @param value - the read result returned by `ctx.documents.read`.
 * @returns the model-facing text.
 */
function formatReadResult(value: { path: string; version: string; content: string; truncated: boolean }): string {
  const header = [`path: ${value.path}`, `version: ${value.version}`]
  if (value.truncated) header.push('truncated: true')
  return `${header.join('\n')}\n\n${value.content}`
}

function sessionIdOf(exec: { agent?: { session: { id: SessionId } } }): SessionId {
  if (exec.agent === undefined) throw new Error('document tools require an agent-scoped execution')
  return exec.agent.session.id
}

/** Register the five document_* tools. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:documents',
    order: 80,
    text: 'For document editing, always read first to obtain the version, then use document_edit with that version. All document changes must go through document_edit.',
  })

  ctx.tools.register(defineTool({
    name: 'document_search',
    description: 'Search workspace documents by content keywords and return ranked hits.',
    parameters: {
      query: { type: 'string', required: true, description: 'Keywords to search for.' },
      limit: { type: 'number', description: 'Maximum number of hits to return.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
                score: { type: 'number', required: true },
                truncated: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.hits.map(hit => `${hit.path} (${hit.score}): ${hit.snippet}`).join('\n') || 'No hits.',
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await ctx.documents.search({
        sessionId: sessionIdOf(exec),
        query: args.query,
        ...args.limit === undefined ? {} : { limit: args.limit },
      })
      return { hits: [...result.hits] }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'document_read',
    description: 'Read a whole document or a located slice and return its current version.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative document path.' },
      locator: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional 1-based located slice. Omit to read the whole document.',
        properties: {
          unit: { type: 'string', required: true, enum: ['line', 'paragraph', 'heading', 'block', 'cell'] },
          start: { type: 'number' },
          end: { type: 'number' },
          id: { type: 'string' },
          sheet: { type: 'string' },
          range: { type: 'string' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true },
          version: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatReadResult(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return ctx.documents.read({
        sessionId: sessionIdOf(exec),
        path: args.path,
        ...args.locator === undefined ? {} : { locator: args.locator as DocumentLocator },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'document_outline',
    description: 'Read the heading, block, or sheet structure of a document.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative document path.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true },
          version: { type: 'string', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                title: { type: 'string', required: true },
                locator: { type: 'object', additionalProperties: true, required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.map(entry => `${entry.kind} ${entry.title}`).join('\n') || 'No outline.',
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await ctx.documents.outline({ sessionId: sessionIdOf(exec), path: args.path })
      return { ...result, entries: [...result.entries] }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'document_create',
    description: 'Create a new supported text document (.txt, .md, or code files only).',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative document path.' },
      content: { type: 'string', required: true, description: 'Full document content.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          version: { type: 'string', required: true },
        },
      },
      // The resulting version is reported for the same reason `document_edit`
      // reports it: a mutation's own result is the cheapest source for the next
      // `base_version`, and without it the model must re-read what it just wrote.
      render: (_args, value) => [{ type: 'text', text: `Created ${value.path} (version ${value.version})` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return ctx.documents.create({ sessionId: sessionIdOf(exec), path: args.path, content: args.content })
    },
    // A create has its full content in the args, so the call presents as a diff
    // against nothing — the shape `str_replace_editor`'s create uses. The
    // `locations` are what makes the written file a deliverable: `ui-deliverables`
    // recognizes a mutation by render intent, never by tool name.
    presentCall(args): ToolCallView {
      return {
        card: 'diff',
        title: `document_create ${args.path}`,
        diffs: [{ path: args.path, oldText: null, newText: args.content }],
        locations: [{ path: args.path }],
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'document_edit',
    description: 'Apply a version-guarded replace, insert, or delete operation to a document.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative document path.' },
      base_version: { type: 'string', required: true, description: 'Version returned by a prior document_read.' },
      edit: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['replace', 'insert', 'delete'] },
          locator: { type: 'object', additionalProperties: true, required: true },
          at: { type: 'object', additionalProperties: false },
          where: { type: 'string', enum: ['before', 'after'] },
          text: { type: 'string' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Updated to version ${value.version}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return ctx.documents.apply({
        sessionId: sessionIdOf(exec),
        path: args.path,
        baseVersion: args.base_version,
        edit: args.edit as unknown as DocumentEdit,
      })
    },
    // A generic `edit` card rather than a diff: a located edit carries only its
    // replacement text in the args, and a `DiffCallView` with `oldText: null`
    // states "new file or overwrite", which this is not. `locations` still makes
    // the edited file a deliverable — that is what the render intent decides.
    presentCall(args): ToolCallView {
      return {
        card: 'generic',
        title: `document_edit ${args.path}`,
        kind: 'edit',
        locations: [{ path: args.path }],
      }
    },
  }))
}
