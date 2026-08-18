/** Prototype preview used by design sessions. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconChevronRightOutline14,
  IconCodeOutline16,
  IconFolderClose16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DocumentChange,
  DocumentDirectoryEntry,
  DocumentDirectoryListing,
  DocumentReadResult,
} from '@deepseek-ai/dsh-documents/types'
import type { UedKey } from './locales.ts'
import { isPreviewable, previewSrcdoc, PREVIEW_SANDBOX } from './sandbox.ts'
import css from './UedView.module.css'

/** Trailing window for `documents/changed`, so a burst of thread writes repaints once. */
const REFRESH_DEBOUNCE_MS = 400

type Listing = {
  readonly status: 'loading' | 'ready' | 'error'
  readonly entries: readonly DocumentDirectoryEntry[]
  readonly error?: string
}

type Preview = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly srcdoc?: string
  readonly error?: string
}

/** Host callbacks and copy the view owner supplies per session. */
export interface UedViewInjected {
  list: (path?: string) => Promise<DocumentDirectoryListing | { error: string }>
  load: (path: string) => Promise<DocumentReadResult | { error: string }>
  subscribeChanged: (fn: (change: DocumentChange) => void) => () => void
  translate: (key: UedKey) => string
}

/** Parent of a workspace-relative directory path; empty string is the root. */
function parentOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/**
 * The preview panel for one design session: prototypes on the left, the
 * selected one rendered in a sandboxed frame on the right.
 * @param props - the framework session kit plus {@link UedViewInjected}.
 * @returns the view element.
 */
export function UedView({
  list,
  load,
  subscribeChanged,
  translate: t,
}: ConvViewProps & Partial<UedViewInjected>): React.ReactElement {
  const [directory, setDirectory] = useState('')
  const [listing, setListing] = useState<Listing>({ status: 'loading', entries: [] })
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [preview, setPreview] = useState<Preview>({ status: 'idle' })
  const selectedRef = useRef<string | undefined>(undefined)
  selectedRef.current = selected

  const refreshListing = useCallback(async (path: string) => {
    if (list === undefined) return
    setListing({ status: 'loading', entries: [] })
    const result = await list(path === '' ? undefined : path)
    if ('error' in result) {
      setListing({ status: 'error', entries: [], error: result.error })
      return
    }
    setListing({ status: 'ready', entries: result.entries })
  }, [list])

  const loadPreview = useCallback(async (path: string) => {
    if (load === undefined) return
    const result = await load(path)
    // A late reply for a prototype the person has already navigated away from
    // must not repaint the frame under the current one.
    if (selectedRef.current !== path) return
    if ('error' in result) {
      setPreview({ status: 'error', error: result.error })
      return
    }
    setPreview({ status: 'ready', srcdoc: previewSrcdoc(result.content) })
  }, [load])

  useEffect(() => { void refreshListing(directory) }, [directory, refreshListing])

  // A design thread keeps writing after the turn that started it ends, and
  // several threads can write in the same second. Repaint on the trailing edge
  // so the frame never shows a document caught mid-write.
  useEffect(() => {
    if (subscribeChanged === undefined) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const dispose = subscribeChanged((change) => {
      if (change.path !== selectedRef.current) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => { void loadPreview(change.path) }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      dispose()
    }
  }, [subscribeChanged, loadPreview])

  const open = useCallback((path: string) => {
    setSelected(path)
    selectedRef.current = path
    setPreview({ status: 'loading' })
    void loadPreview(path)
  }, [loadPreview])

  const label = (key: UedKey): string => t === undefined ? key : t(key)
  const directories = listing.entries.filter(entry => entry.kind === 'directory')
  const prototypes = listing.entries.filter(entry => entry.kind === 'file' && isPreviewable(entry.name))

  return (
    <div className={css.root}>
      <aside className={css.files} aria-label={label('files.label')}>
        <header className={css.filesHeader}>
          <span className={css.filesTitle}>{label('files.label')}</span>
          <button
            type="button"
            className={css.iconButton}
            aria-label={label('files.refresh')}
            onClick={() => { void refreshListing(directory) }}
          >
            <IconRefreshOutline16 />
          </button>
        </header>
        <div className={css.crumb}>{directory === '' ? '/' : `/${directory}`}</div>
        {directory !== '' && (
          <button
            type="button"
            className={css.row}
            onClick={() => { setDirectory(parentOf(directory)) }}
          >
            <IconChevronRightOutline14 className={css.up} />
            <span>{label('files.up')}</span>
          </button>
        )}
        {listing.status === 'loading' && <p className={css.hint}>{label('files.loading')}</p>}
        {listing.status === 'error' && (
          <p className={css.error}><IconWarningOutline16 /> {listing.error ?? label('files.error')}</p>
        )}
        {listing.status === 'ready' && directories.map(entry => (
          <button
            key={entry.path}
            type="button"
            className={css.row}
            onClick={() => { setDirectory(entry.path) }}
          >
            <IconFolderClose16 />
            <span>{entry.name}</span>
          </button>
        ))}
        {listing.status === 'ready' && prototypes.map(entry => (
          <button
            key={entry.path}
            type="button"
            className={entry.path === selected ? `${css.row} ${css.rowActive}` : css.row}
            aria-pressed={entry.path === selected}
            onClick={() => { open(entry.path) }}
          >
            <IconCodeOutline16 />
            <span>{entry.name}</span>
          </button>
        ))}
        {listing.status === 'ready' && directories.length === 0 && prototypes.length === 0 && (
          <p className={css.hint}>{label('files.empty')}</p>
        )}
      </aside>

      <section className={css.stage} aria-label={label('preview.label')}>
        <header className={css.stageHeader}>
          <span className={css.badge}>{label('preview.badge')}</span>
          <span className={css.stagePath}>{selected ?? ''}</span>
          {selected !== undefined && (
            <button
              type="button"
              className={css.iconButton}
              aria-label={label('preview.reload')}
              onClick={() => { void loadPreview(selected) }}
            >
              <IconRefreshOutline16 />
            </button>
          )}
        </header>
        <div className={css.frameWrap}>
          {preview.status === 'idle' && <p className={css.hint}>{label('preview.none')}</p>}
          {preview.status === 'loading' && <p className={css.hint}><IconLoadingOutline16 /> {label('preview.loading')}</p>}
          {preview.status === 'error' && (
            <p className={css.error}><IconWarningOutline16 /> {preview.error ?? label('preview.error')}</p>
          )}
          {preview.status === 'ready' && (
            // `sandbox` is a constant, never composed at the call site: an
            // `allow-same-origin` reaching this attribute is a full escape and
            // changes nothing visible. `srcdoc` keeps the prototype off the
            // host origin; a same-origin route would hand it a valid Origin
            // for /api and defeat the sandbox entirely.
            <iframe
              className={css.frame}
              title={label('preview.label')}
              sandbox={PREVIEW_SANDBOX}
              srcDoc={preview.srcdoc}
            />
          )}
        </div>
      </section>
    </div>
  )
}
