/**
 * Tests for the local documents provider through a real ctx.fs local backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import JSZip from 'jszip'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { DocumentsLocal } from '../src/index.ts'
import type { DocumentEdit } from '@deepseek-ai/dsh-documents'

let dir: string
let ctx: Context
let fsFiber: Awaited<ReturnType<Context['plugin']>>
let sessionFiber: Awaited<ReturnType<Context['plugin']>>
let docsFiber: Awaited<ReturnType<Context['plugin']>>
let policyFiber: Awaited<ReturnType<Context['plugin']>>
let documents: DocumentsLocal
const SID = SessionId('session-1')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-documents-'))
  ctx = new Context()
  policyFiber = await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access', workspaceRoot: dir })
  fsFiber = await ctx.plugin(LocalFileSystem, { cwd: dir })
  sessionFiber = await ctx.plugin(SessionStore)
  ctx.sessions.create(SID, { meta: { cwd: dir } })
  docsFiber = await ctx.plugin(DocumentsLocal, {})
  documents = ctx.documents as DocumentsLocal
})

afterEach(async () => {
  await docsFiber.dispose()
  await sessionFiber.dispose()
  await fsFiber.dispose()
  await policyFiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('documents-local', () => {
  it('lists the workspace root and nested directories for lazy document browsing', async () => {
    await mkdir(join(dir, 'notes'))
    await writeFile(join(dir, 'notes', 'guide.md'), '# Guide')
    await writeFile(join(dir, 'README.md'), '# Readme')

    const root = await documents.list({ sessionId: SID })
    expect(root).toEqual({
      path: '',
      entries: [
        { name: 'notes', path: 'notes', kind: 'directory' },
        { name: 'README.md', path: 'README.md', kind: 'file', format: 'markdown' },
      ],
      truncated: false,
    })
    await expect(documents.list({ sessionId: SID, path: '.' })).resolves.toEqual(root)
    await expect(documents.list({ sessionId: SID, path: 'notes/.' })).resolves.toMatchObject({
      path: 'notes',
      entries: [{ name: 'guide.md', path: 'notes/guide.md', kind: 'file', format: 'markdown' }],
    })
  })

  it('rejects invalid directory browse targets', async () => {
    await writeFile(join(dir, 'file.md'), '# File')
    await expect(documents.list({ sessionId: SID, path: '../outside' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_INVALID_PATH' })
    await expect(documents.list({ sessionId: SID, path: '/outside' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_INVALID_PATH' })
    await expect(documents.list({ sessionId: SID, path: 'C:\\outside' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_INVALID_PATH' })
    await expect(documents.list({ sessionId: SID, path: 'missing' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' })
    await expect(documents.list({ sessionId: SID, path: 'file.md' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_INVALID_PATH' })
  })

  it('bounds directory listings and omits entries outside the workspace', async () => {
    await docsFiber.dispose()
    docsFiber = await ctx.plugin(DocumentsLocal, { maxBrowseEntries: 1 })
    documents = ctx.documents as DocumentsLocal
    await mkdir(join(dir, 'notes'))
    await writeFile(join(dir, 'hidden.md'), '# Hidden')
    const contains = ctx.fs.contains.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'contains').mockImplementation((root, target) => (
      !target.displayPath.endsWith('hidden.md') && contains(root, target)
    ))
    const listed = await documents.list({ sessionId: SID })
    expect(listed.entries).toEqual([{ name: 'notes', path: 'notes', kind: 'directory' }])
    expect(listed.truncated).toBe(false)

    await writeFile(join(dir, 'visible.md'), '# Visible')
    const bounded = await documents.list({ sessionId: SID })
    expect(bounded.entries).toHaveLength(1)
    expect(bounded.truncated).toBe(true)
  })

  it('resolves each request against its session workspace', async () => {
    await writeFile(join(dir, 'root.md'), '# Root')
    const second = join(dir, 'second')
    await mkdir(second)
    await writeFile(join(second, 'second.md'), '# Second')
    const secondSession = SessionId('session-2')
    ctx.sessions.create(secondSession, { meta: { cwd: second } })

    await expect(documents.list({ sessionId: secondSession })).resolves.toEqual({
      path: '',
      entries: [{ name: 'second.md', path: 'second.md', kind: 'file', format: 'markdown' }],
      truncated: false,
    })
    await expect(documents.read({ sessionId: secondSession, path: 'root.md' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' })
  })

  it('rejects sessions without an attached workspace', async () => {
    await expect(documents.list({ sessionId: SessionId('missing') }))
      .rejects.toMatchObject({ code: 'DOCUMENT_IO_ERROR', message: 'session "missing" is not attached' })
    const withoutCwd = SessionId('without-cwd')
    ctx.sessions.create(withoutCwd)
    await expect(documents.list({ sessionId: withoutCwd }))
      .rejects.toMatchObject({ code: 'DOCUMENT_IO_ERROR', message: 'session "without-cwd" has no project cwd' })
  })

  it('reads a text document with its version', async () => {
    await writeFile(join(dir, 'a.md'), '# Hello\n\nWorld')
    const result = await documents.read({ sessionId: SID, path: 'a.md' })
    expect(result.format).toBe('markdown')
    expect(result.content).toContain('# Hello')
    expect(result.version.length).toBeGreaterThan(0)
    expect(result.truncated).toBe(false)
  })

  it('rejects paths that escape the workspace', async () => {
    await expect(documents.read({ sessionId: SID, path: '../outside.md' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_INVALID_PATH' })
  })

  it('returns markdown headings from outline', async () => {
    await writeFile(join(dir, 'doc.md'), '# One\n\nText\n\n## Two')
    const result = await documents.outline({ sessionId: SID, path: 'doc.md' })
    expect(result.entries.map(entry => entry.title)).toEqual(['One', 'Two'])
  })

  it('searches text files by keyword', async () => {
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'x.txt'), 'alpha beta')
    await writeFile(join(dir, 'y.md'), 'nothing here')
    const result = await documents.search({ sessionId: SID, query: 'beta' })
    expect(result.hits.map(hit => hit.title)).toContain('x.txt')
  })

  it('creates a new document and emits documents/changed', async () => {
    const changed: unknown[] = []
    ctx.on('documents/changed', (change) => { changed.push(change) })
    const created = await documents.create({ sessionId: SID, path: 'new.txt', content: 'hello' })
    expect(created.version.length).toBeGreaterThan(0)
    expect(changed).toHaveLength(1)
  })

  // The packaged desktop app's situation. A document write that does not carry
  // its own session resolves against the deployment's FALLBACK root, which the
  // Web bundle derives from `process.cwd()` — the installation directory there,
  // and only by coincidence the workspace when a developer launches the server
  // from inside it. Every write was then denied in the very workspace the
  // session is bound to.
  //
  // Asserted at the seam rather than by a denial: `writableRoots` always adds
  // the OS temp directory, and a test workspace lives there, so a wrong root
  // would still be allowed here while failing on a real workspace.
  it('hands every write a policy anchored on the calling session workspace', async () => {
    await docsFiber.dispose()
    await fsFiber.dispose()
    await policyFiber.dispose()
    const elsewhere = await mkdtemp(join(tmpdir(), 'dsh-documents-fallback-'))
    try {
      policyFiber = await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: elsewhere })
      fsFiber = await ctx.plugin(SandboxedFileSystem, { cwd: dir })
      docsFiber = await ctx.plugin(DocumentsLocal, {})
      documents = ctx.documents as DocumentsLocal
      const writeText = vi.spyOn(ctx.fs, 'writeText')

      await documents.create({ sessionId: SID, path: 'probe.txt', content: 'hello' })
      expect(writeText.mock.calls.at(-1)?.[4]).toMatchObject({ mode: 'workspace-write', workspaceRoot: dir })

      const before = await documents.read({ sessionId: SID, path: 'probe.txt' })
      await documents.apply({
        sessionId: SID,
        path: 'probe.txt',
        baseVersion: before.version,
        edit: { kind: 'replace', locator: { unit: 'line', start: 1, end: 1 }, text: 'edited' },
      })
      expect(writeText.mock.calls.at(-1)?.[4]).toMatchObject({ mode: 'workspace-write', workspaceRoot: dir })
      await expect(documents.read({ sessionId: SID, path: 'probe.txt' }))
        .resolves.toMatchObject({ content: 'edited' })
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('applies a version-guarded line replace', async () => {
    await writeFile(join(dir, 'edit.txt'), 'one\ntwo\nthree')
    const before = await documents.read({ sessionId: SID, path: 'edit.txt' })
    const edit: DocumentEdit = {
      kind: 'replace',
      locator: { unit: 'line', start: 2, end: 2 },
      text: 'TWO',
    }
    const after = await documents.apply({
      sessionId: SID,
      path: 'edit.txt',
      baseVersion: before.version,
      edit,
    })
    expect(after.version).not.toBe(before.version)
    const reread = await documents.read({ sessionId: SID, path: 'edit.txt' })
    expect(reread.content).toBe('one\nTWO\nthree')
  })

  // A model reaching for a string-anchored replace (there is none) sends a
  // locator with no `start`/`end`. Every range comparison is false against
  // `undefined`, so without this rejection the offsets resolve to the whole
  // document and the replacement text silently becomes the entire file — a
  // successful call that destroys it, past a version guard that cannot see it.
  it('rejects a line locator with no numeric range instead of overwriting the document', async () => {
    await writeFile(join(dir, 'whole.txt'), 'one\ntwo\nthree')
    const before = await documents.read({ sessionId: SID, path: 'whole.txt' })
    const malformed: unknown[] = [
      { unit: 'line', find: 'two' },
      { unit: 'line', start: 1 },
      { unit: 'paragraph', start: 1.5, end: 2 },
    ]
    for (const locator of malformed) {
      await expect(documents.apply({
        sessionId: SID,
        path: 'whole.txt',
        baseVersion: before.version,
        edit: { kind: 'replace', locator, text: 'GONE' } as DocumentEdit,
      })).rejects.toMatchObject({ code: 'DOCUMENT_LOCATOR_UNSUPPORTED' })
    }
    const reread = await documents.read({ sessionId: SID, path: 'whole.txt' })
    expect(reread.content).toBe('one\ntwo\nthree')
  })

  it('rejects stale version edits', async () => {
    await writeFile(join(dir, 'stale.txt'), 'original')
    const before = await documents.read({ sessionId: SID, path: 'stale.txt' })
    await documents.apply({
      sessionId: SID,
      path: 'stale.txt',
      baseVersion: before.version,
      edit: { kind: 'replace', locator: { unit: 'line', start: 1, end: 1 }, text: 'changed' },
    })
    await expect(documents.apply({
      sessionId: SID,
      path: 'stale.txt',
      baseVersion: before.version,
      edit: { kind: 'replace', locator: { unit: 'line', start: 1, end: 1 }, text: 'again' },
    })).rejects.toMatchObject({ code: 'DOCUMENT_STALE_VERSION' })
  })
  it('reads a docx archive as extracted text and outline', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>Body text</w:t></w:r></w:p></w:body></w:document>')
    await writeFile(join(dir, 'a.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
    const read = await documents.read({ sessionId: SID, path: 'a.docx' })
    expect(read.format).toBe('docx')
    expect(read.content).toContain('Body text')
    const outline = await documents.outline({ sessionId: SID, path: 'a.docx' })
    expect(outline.entries.map(entry => entry.title)).toContain('Title')
  })

  it('reads an xlsx archive as extracted text and outline', async () => {
    const zip = new JSZip()
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook><sheets><sheet name="Data"/></sheets></workbook>')
    zip.file('xl/sharedStrings.xml', '<?xml version="1.0"?><sst><si><t>Hello</t></si></sst>')
    await writeFile(join(dir, 'b.xlsx'), await zip.generateAsync({ type: 'nodebuffer' }))
    const read = await documents.read({ sessionId: SID, path: 'b.xlsx' })
    expect(read.format).toBe('xlsx')
    expect(read.content).toContain('Hello')
    const outline = await documents.outline({ sessionId: SID, path: 'b.xlsx' })
    expect(outline.entries.map(entry => entry.title)).toContain('Data')
    const search = await documents.search({ sessionId: SID, query: 'Hello' })
    expect(search.hits.map(hit => hit.title)).toContain('b.xlsx')
  })

  it('writes to structured documents by replacing extracted text', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>old</w:t></w:r></w:p></w:body></w:document>')
    await writeFile(join(dir, 'c.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
    const before = await documents.read({ sessionId: SID, path: 'c.docx' })
    await documents.apply({
      sessionId: SID,
      path: 'c.docx',
      baseVersion: before.version,
      edit: { kind: 'replace', locator: { unit: 'line', start: 1, end: 1 }, text: 'new' },
    })
    const after = await documents.read({ sessionId: SID, path: 'c.docx' })
    expect(after.content).toContain('new')
  })

})
