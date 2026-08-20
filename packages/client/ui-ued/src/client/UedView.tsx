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
  ResizeHandle,
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

/** Prototype-rail width bounds, in pixels: enough for a nested path, never half the stage. */
const RAIL_DEFAULT = 240
const RAIL_MIN = 160
const RAIL_MAX = 520

/**
 * Widths the stage can hold the frame at. A design prototype is written for a
 * viewport, and the stage's own width is whatever is left beside the rail and
 * the companion panel — so checking a layout at a stated width needs the stage
 * to constrain the frame rather than the person to resize the window. `auto`
 * keeps the previous behavior and stays the default.
 */
const VIEWPORTS: ReadonlyArray<{ key: UedKey; width?: number }> = [
  { key: 'preview.width.auto' },
  { key: 'preview.width.desktop', width: 1280 },
  { key: 'preview.width.tablet', width: 768 },
  { key: 'preview.width.mobile', width: 390 },
]

/** Name of a workspace-relative path, without its directory. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

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
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT)
  const [viewport, setViewport] = useState<number | undefined>(undefined)
  const [directory, setDirectory] = useState('')
  const [listing, setListing] = useState<Listing>({ status: 'loading', entries: [] })
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [preview, setPreview] = useState<Preview>({ status: 'idle' })
  const selectedRef = useRef<string | undefined>(undefined)
  selectedRef.current = selected
  const directoryRef = useRef('')
  directoryRef.current = directory
  /**
   * Whether the stage still follows what the thread writes.
   *
   * A design thread produces its artifact and then says so in the transcript,
   * and until now the stage did nothing with either: the rail only reloaded
   * when the person changed directory, so a prototype written this turn was
   * not even listed, let alone shown. Following it is the whole point of
   * having a stage.
   *
   * It stops the moment the person opens a prototype themselves. Yanking the
   * stage away from something someone is reading is worse than not following
   * at all, and a deliberate choice is the clearest signal that they are no
   * longer just watching.
   */
  const following = useRef(true)

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

  const show = useCallback((path: string) => {
    setSelected(path)
    selectedRef.current = path
    setPreview({ status: 'loading' })
    void loadPreview(path)
  }, [loadPreview])

  /** A prototype the person opened: the stage stays on it from here. */
  const open = useCallback((path: string) => {
    following.current = false
    show(path)
  }, [show])

  // A design thread keeps writing after the turn that started it ends, and
  // several threads can write in the same second. Act on the trailing edge so
  // the stage never shows a document caught mid-write, and so a burst resolves
  // to the last write rather than to each one in turn.
  useEffect(() => {
    if (subscribeChanged === undefined) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const dispose = subscribeChanged((change) => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        const path = change.path
        // The rail moves first either way: a prototype written this turn is
        // not in the listing yet, so nothing could select it.
        if (parentOf(path) === directoryRef.current) void refreshListing(directoryRef.current)
        if (path === selectedRef.current) {
          void loadPreview(path)
          return
        }
        if (!following.current || !isPreviewable(path)) return
        // Following across directories: the thread decides where its artifact
        // lands, and a stage that only follows within one folder would stop
        // following exactly when the thread organizes its output.
        if (parentOf(path) !== directoryRef.current) setDirectory(parentOf(path))
        show(path)
      }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      dispose()
    }
  }, [subscribeChanged, loadPreview, refreshListing, show])

  const label = (key: UedKey): string => t === undefined ? key : t(key)
  const directories = listing.entries.filter(entry => entry.kind === 'directory')
  const prototypes = listing.entries.filter(entry => entry.kind === 'file' && isPreviewable(entry.name))

  // A design session that has produced nothing yet had a rail holding a third
  // of the width to say so. It comes out with the first prototype, and while
  // the listing is still in flight it stays away rather than appearing and
  // withdrawing. Inside a subdirectory the rail stays whatever it holds — the
  // way back up is in it — and a listing that failed keeps it to say why.
  const railEmpty = directory === ''
    && listing.status !== 'error'
    && directories.length === 0
    && prototypes.length === 0

  return (
    <div
      className={css.root}
      style={{ gridTemplateColumns: railEmpty ? 'minmax(0, 1fr)' : `${String(railWidth)}px auto minmax(0, 1fr)` }}
    >
      {!railEmpty && (
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
              <IconFolderClose16 className={css.rowFolder} />
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
              <IconCodeOutline16 className={css.rowFile} />
              <span>{entry.name}</span>
            </button>
          ))}
          {listing.status === 'ready' && directories.length === 0 && prototypes.length === 0 && (
            <p className={css.hint}>{label('files.empty')}</p>
          )}
        </aside>
      )}

      {!railEmpty && (
        <ResizeHandle
          width={railWidth}
          min={RAIL_MIN}
          max={RAIL_MAX}
          onResize={setRailWidth}
          label={label('files.resize')}
        />
      )}

      <section className={css.stage} aria-label={label('preview.label')}>
        <header className={css.stageHeader}>
          <span className={css.badge}>{label('preview.badge')}</span>
          <span className={css.stagePath}>
            {selected !== undefined && parentOf(selected) !== '' && (
              <span className={css.stageDir}>{parentOf(selected)}/</span>
            )}
            {selected !== undefined && <strong className={css.stageName}>{baseName(selected)}</strong>}
          </span>
          <div className={css.widthSwitch} role="group" aria-label={label('preview.width.label')}>
            {VIEWPORTS.map(entry => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={entry.width === viewport}
                onClick={() => { setViewport(entry.width) }}
              >
                {label(entry.key)}
              </button>
            ))}
          </div>
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
          {preview.status === 'idle' && (
            <p className={css.hint}><IconCodeOutline16 /> {label('preview.none')}</p>
          )}
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
              style={viewport === undefined ? undefined : { maxWidth: `${String(viewport)}px` }}
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
