/**
 * Model-facing document tools for writing mode.
 * @module @deepseek-ai/dsh-tool-documents
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DocumentEdit, DocumentLocator } from '@deepseek-ai/dsh-documents'
import type {} from '@deepseek-ai/dsh-documents'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'tool-documents'
export const inject = ['tools', 'documents', 'systemPrompt']

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
      render: (_args, value) => [{ type: 'text', text: value.content }],
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
      render: (_args, value) => [{ type: 'text', text: `Created ${value.path}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return ctx.documents.create({ sessionId: sessionIdOf(exec), path: args.path, content: args.content })
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
  }))
}
