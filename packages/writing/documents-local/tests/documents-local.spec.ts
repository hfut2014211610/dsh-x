/**
 * Tests for the local documents provider through a real ctx.fs local backend.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import JSZip from 'jszip'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DocumentsLocal } from '../src/index.ts'
import type { DocumentEdit } from '@deepseek-ai/dsh-documents'

let dir: string
let ctx: Context
let fsFiber: Awaited<ReturnType<Context['plugin']>>
let docsFiber: Awaited<ReturnType<Context['plugin']>>
let documents: DocumentsLocal
const SID = SessionId('session-1')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-documents-'))
  ctx = new Context()
  fsFiber = await ctx.plugin(LocalFileSystem, { cwd: dir })
  docsFiber = await ctx.plugin(DocumentsLocal, { root: dir })
  documents = ctx.documents as DocumentsLocal
})

afterEach(async () => {
  await docsFiber.dispose()
  await fsFiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('documents-local', () => {
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
