/**
 * Local workspace document provider for writing mode.
 * @module @deepseek-ai/dsh-documents-local
 */

import { Context } from '@deepseek-ai/cordis'
import { writeFile as fsWriteFile } from 'node:fs/promises'
import JSZip from 'jszip'
import z from '@deepseek-ai/schemastery'
import { Documents, DocumentError } from '@deepseek-ai/dsh-documents'
import type {
  DocumentEdit,
  DocumentDirectoryEntry,
  DocumentDirectoryListing,
  DocumentFormat,
  DocumentLocator,
  DocumentOutlineEntry,
  DocumentOutlineResult,
  DocumentReadResult,
  DocumentSearchHit,
  DocumentSearchResult,
} from '@deepseek-ai/dsh-documents'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Configuration for the local documents provider. */
export interface Config {
  /** Character cap for one read result; longer content comes back truncated. */
  maxReadChars?: number
  /** Entry cap for one document's outline. */
  maxOutlineItems?: number
  /** File cap for one search's directory scan. */
  maxSearchFiles?: number
  /** Entry cap for one directory level returned to document browsers. */
  maxBrowseEntries?: number
}

const DEFAULT_MAX_READ_CHARS = 200_000
const DEFAULT_MAX_OUTLINE_ITEMS = 1_000
const DEFAULT_MAX_SEARCH_FILES = 50_000
const DEFAULT_MAX_BROWSE_ENTRIES = 2_000
const MAX_STRUCTURED_BYTES = 50 * 1024 * 1024

/** Config after defaults are applied; every limit is a concrete number. */
export interface ResolvedConfig {
  maxReadChars: number
  maxOutlineItems: number
  maxSearchFiles: number
  maxBrowseEntries: number
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    maxReadChars: config.maxReadChars ?? DEFAULT_MAX_READ_CHARS,
    maxOutlineItems: config.maxOutlineItems ?? DEFAULT_MAX_OUTLINE_ITEMS,
    maxSearchFiles: config.maxSearchFiles ?? DEFAULT_MAX_SEARCH_FILES,
    maxBrowseEntries: config.maxBrowseEntries ?? DEFAULT_MAX_BROWSE_ENTRIES,
  }
}

function normalizeDirectoryPath(path: string | undefined): string {
  const value = path?.trim() ?? ''
  if (value === '' || value === '.') return ''
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(value)) {
    throw new DocumentError(`directory path must be workspace-relative: ${value}`, 'DOCUMENT_INVALID_PATH')
  }
  const segments = value.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.')
  if (segments.includes('..')) {
    throw new DocumentError(`directory path escapes workspace: ${value}`, 'DOCUMENT_INVALID_PATH')
  }
  return segments.join('/')
}

function childDocumentPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

function stripXml(value: string): string {
  return value
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function readStructuredText(ctx: Context, target: FsTarget, format: 'docx' | 'xlsx'): Promise<string> {
  const info = await ctx.fs.stat(target)
  if (info === undefined) return ''
  if (info.size !== undefined && info.size > MAX_STRUCTURED_BYTES) {
    throw new DocumentError('structured document exceeds the size cap', 'DOCUMENT_TOO_LARGE')
  }
  const bytes = await ctx.fs.readBytes(target, undefined, MAX_STRUCTURED_BYTES)
  const zip = await JSZip.loadAsync(bytes)
  if (format === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string') ?? ''
    return stripXml(xml).replace(/\n{3,}/g, '\n\n').trim()
  }
  const shared = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
  const sheets = await zip.file('xl/workbook.xml')?.async('string') ?? ''
  const sheetNames = [...sheets.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(match => match[1] ?? '')
  const text = stripXml(shared).replace(/\n{3,}/g, '\n\n').trim()
  return [...sheetNames, text].join('\n')
}

async function readStructuredOutline(ctx: Context, target: FsTarget, format: 'docx' | 'xlsx', max: number): Promise<DocumentOutlineEntry[]> {
  const bytes = await ctx.fs.readBytes(target, undefined, MAX_STRUCTURED_BYTES)
  const zip = await JSZip.loadAsync(bytes)
  const entries: DocumentOutlineEntry[] = []
  if (format === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string') ?? ''
    const paragraphs = xml.split(/<w:p[ >]/)
    for (const [index, paragraph] of paragraphs.entries()) {
      if (entries.length >= max) break
      const style = /w:pStyle w:val="(Heading[1-6])"/.exec(paragraph)
      if (!style) continue
      const text = stripXml(paragraph).replace(/\n/g, ' ').trim()
      if (text.length === 0) continue
      entries.push({ id: `h-${index}`, kind: 'heading', title: text, locator: { unit: 'heading', id: `h-${index}` } })
    }
  } else {
    const sheets = await zip.file('xl/workbook.xml')?.async('string') ?? ''
    for (const [index, match] of [...sheets.matchAll(/<sheet[^>]*name="([^"]+)"/g)].entries()) {
      if (entries.length >= max) break
      entries.push({
        id: `sheet-${index}`,
        kind: 'sheet',
        title: match[1] ?? `Sheet${index + 1}`,
        locator: { unit: 'cell', sheet: match[1] ?? `Sheet${index + 1}`, range: 'A1' },
      })
    }
  }
  return entries
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function applyStructuredEdit(ctx: Context, target: FsTarget, format: 'docx' | 'xlsx', content: string): Promise<void> {
  const bytes = await ctx.fs.readBytes(target, undefined, MAX_STRUCTURED_BYTES)
  const zip = await JSZip.loadAsync(bytes)
  const lines = content.split(/\r?\n/)
  if (format === 'docx') {
    const body = lines.map(line => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  } else {
    const items = lines.map(line => `<si><t xml:space="preserve">${escapeXml(line)}</t></si>`).join('')
    zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${lines.length}" uniqueCount="${lines.length}">${items}</sst>`)
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  await fsWriteFile(ctx.fs.processPath(target), buffer)
}

/** Local-filesystem provider for `ctx.documents`, bounded by each calling session's workspace. */
export class DocumentsLocal extends Documents {
  static inject = ['fs', 'sessions']

  static Config: z<Config> = z.object({
    maxReadChars: z.number().default(DEFAULT_MAX_READ_CHARS),
    maxOutlineItems: z.number().default(DEFAULT_MAX_OUTLINE_ITEMS),
    maxSearchFiles: z.number().default(DEFAULT_MAX_SEARCH_FILES),
    maxBrowseEntries: z.number().default(DEFAULT_MAX_BROWSE_ENTRIES),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.resolved = resolveConfig(config)
  }

  private formatOf(path: string): DocumentFormat {
    const lower = path.toLowerCase()
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
    if (lower.endsWith('.docx')) return 'docx'
    if (lower.endsWith('.xlsx')) return 'xlsx'
    return 'code'
  }

  private workspaceRoot(sessionId: SessionId): string {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      throw new DocumentError(`session "${sessionId}" is not attached`, 'DOCUMENT_IO_ERROR')
    }
    const cwd = session.header.cwd
    if (cwd === undefined) {
      throw new DocumentError(`session "${sessionId}" has no project cwd`, 'DOCUMENT_IO_ERROR')
    }
    return cwd
  }

  /**
   * The per-call sandbox policy for one document mutation, anchored on the
   * CALLING session's workspace.
   *
   * Every write must carry this. Without a session the policy service falls
   * back to the deployment's configured root, which the Web bundle derives from
   * the runtime's `process.cwd()` — the same directory as the workspace only
   * when a developer happens to launch the server from it. In the packaged
   * desktop app that directory is the installation, so `workspace-write` denied
   * every document write in a workspace the person had actually opened.
   * @param sessionId - the calling session.
   * @returns the resolved mode and workspace root for this call.
   */
  private policyFor(sessionId: SessionId): SandboxExecutionPolicy | undefined {
    // Optional rather than injected: the fence lives in `fs-sandbox`, which
    // hard-requires this service itself, so a composition without the policy
    // has no fence for the write to satisfy. Requiring it here would instead
    // strand every documents consumer that mounts a plain filesystem.
    const policy = this.ctx.get('sandboxPolicy')
    if (policy === undefined) return undefined
    const session = this.ctx.sessions.get(sessionId)
    return policy.resolve(session === undefined ? {} : { session })
  }

  private async resolveWorkspaceTarget(sessionId: SessionId): Promise<FsTarget> {
    return this.ctx.fs.resolve(this.workspaceRoot(sessionId))
  }

  private async resolveDocument(sessionId: SessionId, path: string): Promise<FsTarget> {
    const workspaceRoot = this.workspaceRoot(sessionId)
    const root = await this.ctx.fs.resolve(workspaceRoot)
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot })
    if (!this.ctx.fs.contains(root, target)) {
      throw new DocumentError(`path escapes workspace: ${path}`, 'DOCUMENT_INVALID_PATH')
    }
    return target
  }

  override async list(request: { sessionId: SessionId; path?: string }): Promise<DocumentDirectoryListing> {
    const path = normalizeDirectoryPath(request.path)
    const root = await this.resolveWorkspaceTarget(request.sessionId)
    const target = path === '' ? root : await this.resolveDocument(request.sessionId, path)
    const info = await this.ctx.fs.stat(target)
    if (info === undefined) throw new DocumentError(`directory not found: ${path}`, 'DOCUMENT_NOT_FOUND')
    if (info.type !== 'directory') throw new DocumentError(`not a directory: ${path}`, 'DOCUMENT_INVALID_PATH')
    const listed = await this.ctx.fs.listDir(target)
    const directories: DocumentDirectoryEntry[] = []
    const files: DocumentDirectoryEntry[] = []
    for (const entry of listed) {
      if (!this.ctx.fs.contains(root, entry.target)) continue
      if (entry.type === 'directory') {
        directories.push({ name: entry.name, path: childDocumentPath(path, entry.name), kind: 'directory' })
      } else if (entry.type === 'file') {
        files.push({
          name: entry.name,
          path: childDocumentPath(path, entry.name),
          kind: 'file',
          format: this.formatOf(entry.name),
        })
      }
    }
    const entries = [...directories, ...files]
    return {
      path,
      entries: entries.slice(0, this.resolved.maxBrowseEntries),
      truncated: entries.length > this.resolved.maxBrowseEntries,
    }
  }

  override async read(request: { sessionId: SessionId; path: string; locator?: DocumentLocator }): Promise<DocumentReadResult> {
    const target = await this.resolveDocument(request.sessionId, request.path)
    const info = await this.ctx.fs.stat(target)
    if (info === undefined) throw new DocumentError(`document not found: ${request.path}`, 'DOCUMENT_NOT_FOUND')
    const format = this.formatOf(request.path)
    const full = format === 'docx' || format === 'xlsx'
      ? await readStructuredText(this.ctx, target, format)
      : await this.ctx.fs.readText(target)
    const content = full.length > this.resolved.maxReadChars ? full.slice(0, this.resolved.maxReadChars) : full
    return { path: request.path, format, version: String(info.version), content, truncated: full.length > this.resolved.maxReadChars }
  }

  override async outline(request: { sessionId: SessionId; path: string }): Promise<DocumentOutlineResult> {
    const target = await this.resolveDocument(request.sessionId, request.path)
    const info = await this.ctx.fs.stat(target)
    if (info === undefined) throw new DocumentError(`document not found: ${request.path}`, 'DOCUMENT_NOT_FOUND')
    const format = this.formatOf(request.path)
    let entries: DocumentOutlineEntry[] = []
    if (format === 'docx' || format === 'xlsx') {
      entries = await readStructuredOutline(this.ctx, target, format, this.resolved.maxOutlineItems)
    } else if (format === 'markdown') {
      const content = await this.ctx.fs.readText(target)
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const match = /^(#{1,6})\s+(.+)$/.exec(line)
        if (match && entries.length < this.resolved.maxOutlineItems) {
          entries.push({ id: `h-${index + 1}`, kind: 'heading', title: (match[2] ?? '').trim(), locator: { unit: 'line', start: index + 1, end: index + 1 } })
        }
      }
    }
    return { path: request.path, format, version: String(info.version), entries }
  }

  override async search(request: { sessionId: SessionId; query: string; limit?: number }): Promise<DocumentSearchResult> {
    const root = await this.resolveWorkspaceTarget(request.sessionId)
    const hits: DocumentSearchHit[] = []
    const limit = request.limit ?? 20
    const seen = new Set<string>()
    const pending: FsTarget[] = [root]
    while (pending.length > 0 && seen.size < this.resolved.maxSearchFiles) {
      const dir = pending.shift()
      if (dir === undefined) break
      let entries
      try {
        entries = await this.ctx.fs.listDir(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (seen.size >= this.resolved.maxSearchFiles) break
        if (entry.type === 'directory') { pending.push(entry.target); continue }
        if (entry.type !== 'file') continue
        seen.add(entry.target.displayPath)
        const format = this.formatOf(entry.name)
        try {
          const content = format === 'docx' || format === 'xlsx'
            ? await readStructuredText(this.ctx, entry.target, format)
            : await this.ctx.fs.readText(entry.target)
          const lower = content.toLowerCase()
          const q = request.query.toLowerCase()
          if (!lower.includes(q)) continue
          const idx = lower.indexOf(q)
          const snippet = content.slice(Math.max(0, idx - 60), idx + q.length + 60)
          hits.push({ path: entry.target.displayPath, title: entry.name, snippet, score: 1, truncated: false })
        } catch {
          // Unreadable/binary files are skipped during search.
        }
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return { hits: hits.slice(0, limit) }
  }

  override async create(request: { sessionId: SessionId; path: string; content: string }): Promise<{ path: string; version: string }> {
    const target = await this.resolveDocument(request.sessionId, request.path)
    const outcome = await this.ctx.fs.writeText(target, request.content, { kind: 'createIfAbsent' }, undefined, this.policyFor(request.sessionId))
    this.ctx.emit('documents/changed', { sessionId: request.sessionId, path: request.path, baseVersion: '', version: String(outcome.version), patches: null })
    return { path: request.path, version: String(outcome.version) }
  }

  override async apply(request: { sessionId: SessionId; path: string; baseVersion: string; edit: DocumentEdit }):
  Promise<{ version: string }> {
    const target = await this.resolveDocument(request.sessionId, request.path)
    const info = await this.ctx.fs.stat(target)
    if (info === undefined) throw new DocumentError(`document not found: ${request.path}`, 'DOCUMENT_NOT_FOUND')
    if (String(info.version) !== request.baseVersion) {
      throw new DocumentError(`stale document version for ${request.path}`, 'DOCUMENT_STALE_VERSION')
    }
    const format = this.formatOf(request.path)
    if (format === 'docx' || format === 'xlsx') {
      const current = await readStructuredText(this.ctx, target, format)
      const edited = applyTextEdit(current, request.edit)
      await applyStructuredEdit(this.ctx, target, format, edited.content)
      const after = await this.ctx.fs.stat(target)
      const version = String(after?.version ?? info.version)
      this.ctx.emit('documents/changed', { sessionId: request.sessionId, path: request.path, baseVersion: request.baseVersion, version, patches: null })
      return { version }
    }
    const content = await this.ctx.fs.readText(target)
    const edited = applyTextEdit(content, request.edit)
    const outcome = await this.ctx.fs.writeText(target, edited.content, { kind: 'replaceIfVersion', version: info.version }, undefined, this.policyFor(request.sessionId))
    this.ctx.emit('documents/changed', { sessionId: request.sessionId, path: request.path, baseVersion: request.baseVersion, version: String(outcome.version), patches: edited.patches })
    return { version: String(outcome.version) }
  }
}

interface TextEditResult {
  readonly content: string
  readonly patches: import('@deepseek-ai/dsh-documents').DocumentPatch[] | null
}

function lineOffsets(content: string): number[] {
  const offsets = [0]
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function applyTextEdit(content: string, edit: DocumentEdit): TextEditResult {
  const lines = content.split(/\r?\n/)
  const locator = edit.kind === 'insert' ? edit.at : edit.locator
  if (locator.unit !== 'line' && locator.unit !== 'paragraph') {
    throw new DocumentError(`locator unit ${locator.unit} is not supported for text documents`, 'DOCUMENT_LOCATOR_UNSUPPORTED')
  }
  // The locator arrives from model-authored tool JSON, where the tool schema
  // accepts any locator object because the units differ in which fields they
  // carry. A missing `start`/`end` must be rejected HERE: every comparison
  // below is false against `undefined`, so the range check would pass
  // vacuously, `offsets[NaN] ?? 0` and `offsets[undefined] ?? content.length`
  // would resolve to the whole document, and a replace would silently
  // overwrite the entire file with its replacement text — a successful call
  // that destroys the document, which the version guard cannot detect.
  if (!Number.isInteger(locator.start) || !Number.isInteger(locator.end)) {
    throw new DocumentError(
      'line/paragraph locator needs integer start and end (1-based, inclusive); there is no string-anchored locator',
      'DOCUMENT_LOCATOR_UNSUPPORTED',
    )
  }
  if (locator.start < 1 || locator.end < locator.start || locator.end > lines.length) {
    throw new DocumentError('line/paragraph range out of bounds', 'DOCUMENT_LOCATOR_UNSUPPORTED')
  }
  const startIndex = locator.start - 1
  const endIndex = locator.end
  const offsets = lineOffsets(content)
  const startOffset = offsets[startIndex] ?? 0
  const endOffset = offsets[endIndex] ?? content.length
  if (edit.kind === 'replace') {
    const removed = content.slice(startOffset, endOffset)
    const trailing = removed.endsWith('\r\n') ? '\r\n' : removed.endsWith('\n') ? '\n' : ''
    const text = edit.text.endsWith('\n') || edit.text.endsWith('\r\n') ? edit.text : edit.text + trailing
    const next = content.slice(0, startOffset) + text + content.slice(endOffset)
    return { content: next, patches: [{ op: 'splice', start: startOffset, deleteCount: endOffset - startOffset, text }] }
  }
  if (edit.kind === 'delete') {
    const next = content.slice(0, startOffset) + content.slice(endOffset)
    return { content: next, patches: [{ op: 'splice', start: startOffset, deleteCount: endOffset - startOffset, text: '' }] }
  }
  const boundary = edit.where === 'before' ? startOffset : endOffset
  const next = content.slice(0, boundary) + edit.text + content.slice(boundary)
  return { content: next, patches: [{ op: 'splice', start: boundary, deleteCount: 0, text: edit.text }] }
}

export default DocumentsLocal
