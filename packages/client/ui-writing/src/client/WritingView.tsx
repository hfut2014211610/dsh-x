/** Focused document editor used by writing sessions. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconBrowseOutline16,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconCodeOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconFolderOpenOutline16,
  IconListPenOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DocumentChange,
  DocumentDirectoryEntry,
  DocumentDirectoryListing,
  DocumentOutlineEntry,
  DocumentReadResult,
  DocumentSearchHit,
} from '@deepseek-ai/dsh-documents/types'
import type { WritingKey } from './locales.ts'
import css from './WritingView.module.css'

type Panel = 'document' | 'outline' | 'search'
type ViewMode = 'edit' | 'preview'
type SaveStatus = 'idle' | 'loading' | 'dirty' | 'saving' | 'saved' | 'external' | 'conflict' | 'error'
type DirectoryState = {
  readonly status: 'loading' | 'ready' | 'error'
  readonly entries: readonly DocumentDirectoryEntry[]
  readonly truncated: boolean
  readonly error?: string
}
type TextSelection = { readonly start: number; readonly end: number }

const TEXTAREA_MIRROR_PROPERTIES = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'tab-size',
] as const

/** Injected document actions supplied by the writing plugin. */
export interface WritingViewInjected {
  list: (path?: string) => Promise<DocumentDirectoryListing | { error: string }>
  load: (path: string) => Promise<DocumentReadResult | { error: string }>
  save: (path: string, baseVersion: string, content: string) => Promise<{ version: string } | { error: string }>
  outline: (path: string) => Promise<readonly DocumentOutlineEntry[]>
  search: (query: string) => Promise<readonly DocumentSearchHit[]>
  subscribeChanged: (fn: (change: DocumentChange) => void) => () => void
  translate: (key: WritingKey) => string
}

function DirectoryBranch({
  path,
  directories,
  expanded,
  currentPath,
  loadDirectory,
  toggleDirectory,
  openDocument,
  t,
}: {
  path: string
  directories: ReadonlyMap<string, DirectoryState>
  expanded: ReadonlySet<string>
  currentPath: string
  loadDirectory: (path: string) => void
  toggleDirectory: (entry: DocumentDirectoryEntry) => void
  openDocument: (path: string) => void
  t: (key: WritingKey) => string
}) {
  const state = directories.get(path)
  const root = path === ''
  return (
    <ul className={root ? css.treeRoot : css.treeGroup} role={root ? 'tree' : 'group'} aria-label={root ? t('tree.label') : undefined}>
      {state?.entries.map((entry) => {
        const directory = entry.kind === 'directory'
        const open = directory && expanded.has(entry.path)
        return (
          <li
            key={entry.path}
            className={css.treeItem}
            role="treeitem"
            aria-expanded={directory ? open : undefined}
            aria-current={!directory && entry.path === currentPath ? 'page' : undefined}
          >
            <button
              type="button"
              className={css.treeRow}
              data-current={!directory && entry.path === currentPath ? '' : undefined}
              title={entry.path}
              onClick={() => {
                if (directory) toggleDirectory(entry)
                else openDocument(entry.path)
              }}
            >
              {directory
                ? <IconChevronRightOutline14 className={`${css.treeChevron}${open ? ` ${css.treeChevronOpen}` : ''}`} />
                : <span className={css.treeChevronSeat} />}
              {directory
                ? open ? <IconFolderOpen16 className={css.treeFolder} /> : <IconFolderClose16 className={css.treeFolder} />
                : <IconCodeOutline16 className={css.treeFile} />}
              <span className={css.treeName}>{entry.name}</span>
            </button>
            {directory && open && (
              <DirectoryBranch
                path={entry.path}
                directories={directories}
                expanded={expanded}
                currentPath={currentPath}
                loadDirectory={loadDirectory}
                toggleDirectory={toggleDirectory}
                openDocument={openDocument}
                t={t}
              />
            )}
          </li>
        )
      })}
      {(state === undefined || state.status === 'loading') && (
        <li className={css.treeMessage} role="none">
          <IconLoadingOutline16 className={css.treeSpinner} />
          <span>{t('tree.loading')}</span>
        </li>
      )}
      {state?.status === 'error' && (
        <li className={css.treeMessage} role="none">
          <span title={state.error}>{t('tree.error')}</span>
          <button type="button" onClick={() => { loadDirectory(path) }}>{t('action.retry')}</button>
        </li>
      )}
      {state?.status === 'ready' && state.entries.length === 0 && (
        <li className={css.treeMessage} role="none">{t('tree.empty')}</li>
      )}
      {state?.truncated && <li className={css.treeMessage} role="none">{t('tree.truncated')}</li>}
    </ul>
  )
}

function documentName(path: string, untitled: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1)
  return name === undefined || name === '' ? untitled : name
}

function parentDirectory(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const separator = normalized.lastIndexOf('/')
  return separator === -1 ? '' : normalized.slice(0, separator)
}

function lineOffsets(content: string): number[] {
  const offsets = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') offsets.push(index + 1)
  }
  return offsets
}

function selectionForOutline(content: string, entry: DocumentOutlineEntry): TextSelection | null {
  if (entry.locator.unit === 'line') {
    const offsets = lineOffsets(content)
    const lineStart = offsets[entry.locator.start - 1]
    if (lineStart !== undefined) {
      const rangeEnd = offsets[entry.locator.end] ?? content.length
      const titleStart = content.indexOf(entry.title, lineStart)
      if (titleStart >= lineStart && titleStart < rangeEnd) {
        return { start: titleStart, end: titleStart + entry.title.length }
      }
    }
  }
  const titleStart = content.indexOf(entry.title)
  return titleStart < 0 ? null : { start: titleStart, end: titleStart + entry.title.length }
}

function markdownHeadingIndex(content: string, entry: DocumentOutlineEntry): number | null {
  const targetLine = entry.locator.unit === 'line' ? entry.locator.start : null
  let nearest: { index: number; distance: number } | null = null
  let headingIndex = 0
  for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match === null) continue
    const lineNumber = lineIndex + 1
    const title = (match[2] ?? '').trim()
    if (title === entry.title) {
      if (targetLine === lineNumber) return headingIndex
      const distance = targetLine === null ? headingIndex : Math.abs(targetLine - lineNumber)
      if (nearest === null || distance < nearest.distance) nearest = { index: headingIndex, distance }
    }
    headingIndex += 1
  }
  return nearest?.index ?? null
}

function revealPreviewHeading(preview: HTMLElement, heading: HTMLElement): void {
  const previewRect = preview.getBoundingClientRect()
  const headingRect = heading.getBoundingClientRect()
  const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight)
  preview.scrollTop = Math.min(maximum, Math.max(0, preview.scrollTop + headingRect.top - previewRect.top - 24))
}

function revealTextareaOffset(editor: HTMLTextAreaElement, offset: number): void {
  if (editor.scrollHeight <= editor.clientHeight) return
  const computed = getComputedStyle(editor)
  const mirror = document.createElement('div')
  for (const property of TEXTAREA_MIRROR_PROPERTIES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property))
  }
  mirror.style.position = 'fixed'
  mirror.style.inset = '0 auto auto -10000px'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.textContent = editor.value.slice(0, offset)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.append(marker)
  document.body.append(mirror)
  const maximum = editor.scrollHeight - editor.clientHeight
  editor.scrollTop = Math.min(maximum, Math.max(0, marker.offsetTop - editor.clientHeight / 4))
  mirror.remove()
}

function focusEditorSelection(editor: HTMLTextAreaElement, selection: TextSelection): void {
  editor.focus({ preventScroll: true })
  editor.setSelectionRange(selection.start, selection.end)
  revealTextareaOffset(editor, selection.start)
}

function RailButton({ active, label, onClick, children }: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip label={label} side="right" delayMs={350}>
      <button
        type="button"
        className={css.railButton}
        data-active={active || undefined}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Renders a focused editor with document tools. The conversation owner places
 * the existing chat and composer beside this view for writing sessions.
 * @param props - session runtime plus document callbacks.
 * @returns the writing workspace.
 */
export function WritingView({
  sessionId,
  list,
  load,
  save,
  outline,
  search,
  subscribeChanged,
  translate: t,
}: ConvViewProps & WritingViewInjected) {
  const initialPath = new URL(window.location.href).searchParams.get('path') ?? ''
  const [panel, setPanel] = useState<Panel | null>(initialPath === '' ? 'document' : null)
  const [pathInput, setPathInput] = useState(initialPath)
  const [currentPath, setCurrentPath] = useState('')
  const [draft, setDraft] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<readonly DocumentOutlineEntry[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly DocumentSearchHit[]>([])
  const [directories, setDirectories] = useState<ReadonlyMap<string, DirectoryState>>(() => new Map())
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(() => new Set(['']))
  const [markdown, setMarkdown] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const currentPathRef = useRef(currentPath)
  const draftRef = useRef(draft)
  const savedContentRef = useRef(savedContent)
  const initialLoadStarted = useRef(false)
  const directoryLoadsRef = useRef(new Set<string>())
  const directoryGenerationRef = useRef(0)

  currentPathRef.current = currentPath
  draftRef.current = draft
  savedContentRef.current = savedContent

  const loadDirectory = useCallback(async (path: string) => {
    if (directoryLoadsRef.current.has(path)) return
    const generation = directoryGenerationRef.current
    directoryLoadsRef.current.add(path)
    setDirectories((current) => {
      const next = new Map(current)
      const previous = current.get(path)
      next.set(path, { status: 'loading', entries: previous?.entries ?? [], truncated: previous?.truncated ?? false })
      return next
    })
    const result = await list(path === '' ? undefined : path)
    directoryLoadsRef.current.delete(path)
    if (generation !== directoryGenerationRef.current) return
    setDirectories((current) => {
      const next = new Map(current)
      next.set(path, 'error' in result
        ? { status: 'error', entries: [], truncated: false, error: result.error }
        : { status: 'ready', entries: result.entries, truncated: result.truncated })
      return next
    })
  }, [list])

  const loadDocument = useCallback(async (targetPath: string, source: 'manual' | 'tree' | 'reload' | 'external' = 'manual') => {
    const normalizedPath = targetPath.trim()
    if (normalizedPath === '') {
      setPanel('document')
      return
    }
    setError(null)
    setStatus('loading')
    const result = await load(normalizedPath)
    if ('error' in result) {
      void loadDirectory(parentDirectory(normalizedPath))
      setError(result.error)
      setStatus('error')
      return
    }
    void loadDirectory(parentDirectory(normalizedPath))
    setCurrentPath(normalizedPath)
    setPathInput(normalizedPath)
    setDraft(result.content)
    setSavedContent(result.content)
    setVersion(result.version)
    const nextMarkdown = result.format === 'markdown'
    setMarkdown(nextMarkdown)
    if (normalizedPath !== currentPathRef.current) setViewMode(nextMarkdown ? 'preview' : 'edit')
    setEntries(await outline(normalizedPath))
    setStatus(source === 'external' ? 'external' : 'saved')
    if (source === 'manual') setPanel(null)
  }, [load, loadDirectory, outline])

  useEffect(() => {
    if (panel !== 'document' || directories.has('')) return
    void loadDirectory('')
  }, [directories, loadDirectory, panel])

  useEffect(() => {
    if (initialLoadStarted.current || initialPath === '') return
    initialLoadStarted.current = true
    void loadDocument(initialPath)
  }, [initialPath, loadDocument])

  useEffect(() => subscribeChanged((change) => {
    if (change.path !== currentPathRef.current) return
    if (draftRef.current !== savedContentRef.current) {
      setStatus('conflict')
      return
    }
    void loadDocument(change.path, 'external')
  }), [loadDocument, subscribeChanged])

  useEffect(() => {
    if (viewMode !== 'edit' || pendingSelectionRef.current === null) return
    const selection = pendingSelectionRef.current
    pendingSelectionRef.current = null
    const editor = editorRef.current
    if (editor !== null) focusEditorSelection(editor, selection)
  }, [viewMode])

  const handleSave = async () => {
    if (currentPath === '' || status === 'saving') return
    setError(null)
    setStatus('saving')
    const result = await save(currentPath, version, draft)
    if ('error' in result) {
      void loadDirectory(parentDirectory(currentPath))
      setError(result.error)
      setStatus('error')
      return
    }
    setVersion(result.version)
    setSavedContent(draft)
    setStatus('saved')
  }

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedQuery = query.trim()
    if (normalizedQuery === '') {
      setHits([])
      return
    }
    setError(null)
    setHits(await search(normalizedQuery))
  }

  const openInNewWindow = () => {
    if (currentPath === '') return
    const url = new URL(window.location.href)
    url.searchParams.set('session', sessionId)
    url.searchParams.set('path', currentPath)
    window.open(url.toString(), '_blank')
  }

  const jumpToOutline = (entry: DocumentOutlineEntry) => {
    if (markdown && viewMode === 'preview' && entry.kind === 'heading') {
      const index = markdownHeadingIndex(draft, entry)
      const heading = index === null ? undefined : previewRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')[index]
      if (heading !== undefined && previewRef.current !== null) revealPreviewHeading(previewRef.current, heading)
      return
    }
    const selection = selectionForOutline(draft, entry)
    if (selection === null) return
    pendingSelectionRef.current = selection
    if (viewMode === 'edit') {
      pendingSelectionRef.current = null
      const editor = editorRef.current
      if (editor !== null) focusEditorSelection(editor, selection)
      return
    }
    setViewMode('edit')
  }

  const togglePanel = (next: Panel) => {
    setPanel(current => current === next ? null : next)
  }

  const toggleDirectory = (entry: DocumentDirectoryEntry) => {
    const open = expandedDirectories.has(entry.path)
    setExpandedDirectories((current) => {
      const next = new Set(current)
      if (open) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    if (!open && !directories.has(entry.path)) void loadDirectory(entry.path)
  }

  const refreshDirectories = () => {
    directoryGenerationRef.current += 1
    directoryLoadsRef.current.clear()
    setDirectories(new Map())
    setExpandedDirectories(new Set(['']))
  }

  const statusLabel = t(`status.${status}`)
  const characterCount = draft.replace(/\s/g, '').length
  const title = documentName(currentPath, t('document.untitled'))

  return (
    <div className={css.root} data-writing-view={sessionId}>
      <nav className={css.toolRail} aria-label={t('tools.label')}>
        <RailButton active={panel === 'document'} label={t('tools.document')} onClick={() => { togglePanel('document') }}>
          <IconFolderOpenOutline16 />
        </RailButton>
        <RailButton active={panel === 'outline'} label={t('tools.outline')} onClick={() => { togglePanel('outline') }}>
          <IconListPenOutline16 />
        </RailButton>
        <RailButton active={panel === 'search'} label={t('tools.search')} onClick={() => { togglePanel('search') }}>
          <IconSearchOutline16 />
        </RailButton>
      </nav>

      {panel !== null && (
        <aside className={css.toolPanel} aria-label={t(`panel.${panel}`)}>
          <header className={css.panelHeader}>
            <strong>{t(`panel.${panel}`)}</strong>
            <button type="button" className={css.iconButton} aria-label={t('action.close')} onClick={() => { setPanel(null) }}>
              <IconCloseOutline16 />
            </button>
          </header>

          {panel === 'document' && (
            <>
              <form className={css.documentForm} onSubmit={(event) => { event.preventDefault(); void loadDocument(pathInput) }}>
                <label htmlFor={`writing-path-${sessionId}`}>{t('document.path')}</label>
                <input
                  id={`writing-path-${sessionId}`}
                  value={pathInput}
                  onChange={(event) => { setPathInput(event.target.value) }}
                  placeholder={t('document.pathPlaceholder')}
                  autoComplete="off"
                />
                <button type="submit" className={css.primaryButton} disabled={pathInput.trim() === ''}>
                  <IconFolderOpenOutline16 />
                  {t('action.open')}
                </button>
              </form>
              <section className={css.treeSection} aria-labelledby={`writing-tree-${sessionId}`}>
                <div className={css.treeHeader}>
                  <strong id={`writing-tree-${sessionId}`}>{t('tree.heading')}</strong>
                  <Tooltip label={t('tree.refresh')} side="bottom">
                    <button type="button" className={css.iconButton} aria-label={t('tree.refresh')} onClick={refreshDirectories}>
                      <IconRefreshOutline16 />
                    </button>
                  </Tooltip>
                </div>
                <div className={css.treeScroll}>
                  <DirectoryBranch
                    path=""
                    directories={directories}
                    expanded={expandedDirectories}
                    currentPath={currentPath}
                    loadDirectory={(path) => { void loadDirectory(path) }}
                    toggleDirectory={toggleDirectory}
                    openDocument={(path) => { void loadDocument(path, 'tree') }}
                    t={t}
                  />
                </div>
              </section>
            </>
          )}

          {panel === 'outline' && (
            <div className={css.panelList}>
              {entries.length === 0 && <p className={css.empty}>{t('outline.empty')}</p>}
              {entries.map(entry => (
                <button key={entry.id} type="button" className={css.listItem} onClick={() => { jumpToOutline(entry) }}>
                  <span className={css.entryKind}>{entry.kind}</span>
                  <span>{entry.title}</span>
                </button>
              ))}
            </div>
          )}

          {panel === 'search' && (
            <>
              <form className={css.searchForm} onSubmit={(event) => { void handleSearch(event) }}>
                <div className={css.searchInput}>
                  <IconSearchOutline16 />
                  <input
                    aria-label={t('search.input')}
                    value={query}
                    onChange={(event) => { setQuery(event.target.value) }}
                    placeholder={t('search.placeholder')}
                  />
                </div>
              </form>
              <div className={css.panelList}>
                {hits.length === 0 && <p className={css.empty}>{t('search.empty')}</p>}
                {hits.map(hit => (
                  <button key={`${hit.path}:${hit.title}`} type="button" className={css.searchHit} onClick={() => { void loadDocument(hit.path) }}>
                    <strong>{hit.title}</strong>
                    <span>{hit.path}</span>
                    <p>{hit.snippet}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      )}

      <section className={css.editorShell}>
        <header className={css.editorHeader}>
          <div className={css.documentIdentity}>
            <span>{t('view.writing')}</span>
            <span className={css.pathSeparator}>/</span>
            <strong title={currentPath || undefined}>{title}</strong>
          </div>
          <div className={css.editorActions}>
            {markdown && (
              <div className={css.modeSwitch} role="group" aria-label={t('mode.label')}>
                <button
                  type="button"
                  aria-pressed={viewMode === 'edit'}
                  onClick={() => { setViewMode('edit') }}
                >
                  {t('mode.edit')}
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'preview'}
                  onClick={() => { setViewMode('preview') }}
                >
                  {t('mode.preview')}
                </button>
              </div>
            )}
            <span className={css.status} data-status={status} title={version || undefined}>
              {status === 'conflict' || status === 'error'
                ? <IconWarningOutline16 />
                : <IconCheckOutline16 />}
              {statusLabel}
            </span>
            <Tooltip label={t('action.reload')} side="bottom">
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('action.reload')}
                disabled={currentPath === '' || status === 'loading'}
                onClick={() => { void loadDocument(currentPath, 'reload') }}
              >
                <IconRefreshOutline16 />
              </button>
            </Tooltip>
            <Tooltip label={t('action.newWindow')} side="bottom">
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('action.newWindow')}
                disabled={currentPath === ''}
                onClick={openInNewWindow}
              >
                <IconBrowseOutline16 />
              </button>
            </Tooltip>
            <button
              type="button"
              className={css.saveButton}
              disabled={currentPath === '' || status === 'saving' || draft === savedContent}
              onClick={() => { void handleSave() }}
            >
              {status === 'saving' ? t('action.saving') : t('action.save')}
            </button>
          </div>
        </header>

        {error !== null && <div className={css.error} role="alert">{error}</div>}
        {status === 'conflict' && (
          <div className={css.conflict} role="status">
            <IconWarningOutline16 />
            <span>{t('conflict.message')}</span>
            <button type="button" onClick={() => { void loadDocument(currentPath, 'reload') }}>{t('action.reload')}</button>
          </div>
        )}

        <div className={css.paper}>
          {markdown && viewMode === 'preview'
            ? (
              <article ref={previewRef} className={css.preview} aria-label={t('preview.label')}>
                <MarkdownText text={draft} />
              </article>
            )
            : (
              <textarea
                ref={editorRef}
                aria-label={t('editor.label')}
                value={draft}
                onChange={(event) => {
                  const next = event.target.value
                  setDraft(next)
                  setStatus(next === savedContentRef.current ? 'saved' : 'dirty')
                }}
                placeholder={t('editor.placeholder')}
                spellCheck
              />
            )}
        </div>
        <footer className={css.editorFooter}>
          <span>{t('footer.characters').replace('{count}', String(characterCount))}</span>
          <span>{t('footer.autosave')}</span>
        </footer>
      </section>
    </div>
  )
}
