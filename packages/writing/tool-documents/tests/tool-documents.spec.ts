/**
 * Consumer API tests for the document tools over a fake documents service.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Documents } from '@deepseek-ai/dsh-documents'
import type {
  DocumentEdit,
  DocumentOutlineResult,
  DocumentReadResult,
  DocumentSearchResult,
} from '@deepseek-ai/dsh-documents'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolDocuments from '../src/index.ts'

const SID = 'session-1' as SessionId

class FakeDocuments extends Documents {
  override read = vi.fn(async (): Promise<DocumentReadResult> => ({
    path: 'a.md', format: 'markdown', version: 'v1', content: '# Hi', truncated: false,
  }))
  override outline = vi.fn(async (): Promise<DocumentOutlineResult> => ({
    path: 'a.md', format: 'markdown', version: 'v1',
    entries: [{ id: 'h1', kind: 'heading', title: 'Hi', locator: { unit: 'line', start: 1, end: 1 } }],
  }))
  override search = vi.fn(async (): Promise<DocumentSearchResult> => ({
    hits: [{ path: 'a.md', title: 'a.md', snippet: 'Hi', score: 1, truncated: false }],
  }))
  override create = vi.fn(async () => ({ path: 'new.md', version: 'v1' }))
  override apply = vi.fn(async () => ({ version: 'v2' }))
}

/** The model-facing text of one execution: every text block, joined. */
function textOf(result: { content: readonly ContentBlock[] }): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent: { session: { id: SID } } as never,
  })
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeDocuments)
  await ctx.plugin(ToolDocuments)
  const documents = ctx.documents as FakeDocuments
  return { ctx, documents }
}

describe('tool-documents', () => {
  it('document_read calls ctx.documents.read with the agent session id', async () => {
    const { ctx, documents } = await setup()
    const result = await call(ctx, 'document_read', { path: 'a.md' })
    expect(result.isError).toBe(false)
    expect(documents.read).toHaveBeenCalledWith({ sessionId: SID, path: 'a.md' })
  })

  it('document_edit passes the version and edit through', async () => {
    const { ctx, documents } = await setup()
    const edit: DocumentEdit = { kind: 'replace', locator: { unit: 'line', start: 1, end: 1 }, text: 'x' }
    await call(ctx, 'document_edit', { path: 'a.md', base_version: 'v1', edit })
    expect(documents.apply).toHaveBeenCalledWith({ sessionId: SID, path: 'a.md', baseVersion: 'v1', edit })
  })

  // `render` IS the model-facing result — the validated schema value never
  // reaches the model — so a body-only projection leaves `base_version` with no
  // source and every guarded edit fails as stale.
  it('document_read hands the model the version, not only the body', async () => {
    const { ctx } = await setup()
    expect(textOf(await call(ctx, 'document_read', { path: 'a.md' })))
      .toBe('path: a.md\nversion: v1\n\n# Hi')
  })

  it('document_read marks a clipped body, which line locators must not be aimed at', async () => {
    const { ctx, documents } = await setup()
    documents.read.mockResolvedValueOnce({
      path: 'big.html', format: 'code', version: 'v9', content: '<html>', truncated: true,
    })
    expect(textOf(await call(ctx, 'document_read', { path: 'big.html' })))
      .toBe('path: big.html\nversion: v9\ntruncated: true\n\n<html>')
  })

  it('document_create reports the version its own write produced', async () => {
    const { ctx } = await setup()
    expect(textOf(await call(ctx, 'document_create', { path: 'new.md', content: 'x' })))
      .toBe('Created new.md (version v1)')
  })

  // `ui-deliverables` recognizes a produced file by render intent and reads the
  // call view's `locations`; a mutation that declares neither is silently absent
  // from the produced-files row.
  it('presents both mutations with follow-along locations', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('document_create')?.presentCall?.({ path: 'p/login.html', content: '<a>' })).toEqual({
      card: 'diff',
      title: 'document_create p/login.html',
      diffs: [{ path: 'p/login.html', oldText: null, newText: '<a>' }],
      locations: [{ path: 'p/login.html' }],
    })
    expect(ctx.tools.get('document_edit')?.presentCall?.({
      path: 'p/login.html',
      base_version: 'v1',
      edit: { kind: 'replace', locator: { unit: 'line', start: 3, end: 5 }, text: 'x' },
    })).toEqual({
      card: 'generic',
      title: 'document_edit p/login.html',
      kind: 'edit',
      locations: [{ path: 'p/login.html' }],
    })
  })
})
