/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { ResizeHandle } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
}

const DEFAULT_VIEW_ID = 'chat'

/**
 * Companion column drag bounds, in pixels. The floor keeps the composer card
 * and its tool row on one line; the ceiling keeps the primary view — an editor
 * or a prototype stage — the wider half of the split. Between them the column
 * starts at whatever `--dsh-companion-width` resolves to for this viewport,
 * measured once the panel has been laid out.
 */
const COMPANION_MIN = 320
const COMPANION_MAX = 720

/**
 * The custom property the whole companion column is sized from.
 *
 * A drag has to write THIS rather than the panel's own width, because the
 * panel is not the only thing sized from it: the resident composer is one
 * shared instance positioned against the frame, and it is a SIBLING of this
 * slot rather than a descendant, so it can only be reached through the
 * declaring element. Sizing the panel directly moves the column and leaves the
 * composer at its old width.
 */
const COMPANION_WIDTH_PROPERTY = '--dsh-companion-width'

/** Clamp a measured or dragged companion width into its drag range. */
function clampCompanion(px: number): number {
  return Math.min(COMPANION_MAX, Math.max(COMPANION_MIN, Math.round(px)))
}

/** Resolve by id; a live preferred view temporarily overrides the persisted tab. */
function resolveActiveView(
  tabs: readonly ViewTab[],
  selectedId: string | null,
  preferredId: string | null,
): ViewTab | undefined {
  const requestedId = preferredId ?? selectedId ?? DEFAULT_VIEW_ID
  return tabs.find(view => view.id === requestedId)
    ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({ id: summary.id, displayTitle: summary.displayTitle })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useStore, actions,
  renderSlot, views, open, t,
}: ConversationSessionHeaderProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const selectedId = useStore(s => s.view)
  const preferredId = useSessions(() => views.preferred(sessionId))
  const activePreferredId = tabs.some(tab => tab.id === preferredId) ? preferredId : null
  const active = resolveActiveView(tabs, selectedId, activePreferredId)
  const companion = active === undefined ? null : views.companion(sessionId, active.id)
  const hasCompanion = companion !== null
    && companion.id !== active?.id
    && tabs.some(tab => tab.id === companion.id)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const hideChrome = blank && composerPhase === 'blank' && activePreferredId === null

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      <button
                        type="button"
                        className={clsx(css.crumb, last && css.crumbCurrent)}
                        disabled={last}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </div>
          {tabs.length > 1 && !hasCompanion && (
            <div className={css.tabs} role="tablist">
              {tabs.map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onClick={() => { actions.setView(viewTab.id) }}
                >
                  {viewTab.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  sessionId, useSession, useSessions, useInput, inputActions, useStore, actions,
  renderSlot, views, bindDraftMirror, releaseSessionImages, t,
}: ConversationSessionProps) {
  useSyncExternalStore(views.subscribe, views.version)
  const tabs = views.list()
  const selectedId = useStore(s => s.view)
  const preferredId = useSessions(() => views.preferred(sessionId))
  const activePreferredId = tabs.some(tab => tab.id === preferredId) ? preferredId : null
  const active = resolveActiveView(tabs, selectedId, activePreferredId)
  const declaredCompanion = active === undefined ? null : views.companion(sessionId, active.id)
  const companion = declaredCompanion !== null
    && declaredCompanion.id !== active?.id
    && tabs.some(tab => tab.id === declaredCompanion.id)
    ? declaredCompanion
    : null
  const composerPhase = useSession(s => s.composerPhase)
  const blank = useSession(s => s.blank)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  // `?? null`: persisted snapshots from before the inspect field rehydrate without it.
  const inspect = useStore(s => s.inspect ?? null)
  // null until the panel has been laid out once: the CSS default is a viewport
  // expression, so the first drag has to start from what it actually resolved
  // to rather than from a number this component picked.
  const [companionWidth, setCompanionWidth] = useState<number | null>(null)
  const declaringElement = useRef<HTMLElement | null>(null)
  const measureCompanion = useCallback((node: HTMLElement | null) => {
    if (node === null) return
    declaringElement.current = node.closest<HTMLElement>('[data-conversation-root]')
    const measured = clampCompanion(node.getBoundingClientRect().width)
    setCompanionWidth(current => current ?? measured)
  }, [])

  // Mirrors the two early returns below: the property must be released the
  // moment the companion layout stops rendering, not only when this slot
  // unmounts, or a session that once showed a dragged assistant column keeps
  // imposing that width on every later layout.
  const showsCompanion = companion !== null && !(blank && composerPhase === 'blank' && activePreferredId === null)

  // Written to the DOM rather than rendered as a style prop: the element that
  // declares this property is above this slot, so a style prop here could not
  // reach it.
  useEffect(() => {
    const element = declaringElement.current
    if (element === null || companionWidth === null || !showsCompanion) return undefined
    element.style.setProperty(COMPANION_WIDTH_PROPERTY, `${String(companionWidth)}px`)
    return () => { element.style.removeProperty(COMPANION_WIDTH_PROPERTY) }
  }, [companionWidth, showsCompanion])

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  useEffect(() => () => {
    releaseSessionImages(sessionId)
  }, [releaseSessionImages, sessionId])

  if (blank && composerPhase === 'blank' && activePreferredId === null) return null
  const owner = {
    inspect,
    onInspectDone: () => { actions.setInspect(null) },
  }
  if (companion === null) {
    return (
      <div className={css.viewArea}>
        {active !== undefined && renderSlot('conversation.view', owner, { only: active.id })}
      </div>
    )
  }
  return (
    <div className={clsx(css.viewArea, css.companionViewArea)} data-conversation-companion-layout="">
      <main className={css.primaryView}>
        {active !== undefined && renderSlot('conversation.view', owner, { only: active.id })}
      </main>
      <ResizeHandle
        width={companionWidth ?? COMPANION_MIN}
        min={COMPANION_MIN}
        max={COMPANION_MAX}
        side="right"
        onResize={setCompanionWidth}
        label={t('companion.resize')}
      />
      <aside
        ref={measureCompanion}
        className={css.companionPanel}
        data-conversation-companion=""
        aria-label={companion.label}
      >
        <header className={css.companionHeader}>{companion.label}</header>
        <div className={css.companionBody}>
          {renderSlot('conversation.view', owner, { only: companion.id })}
        </div>
      </aside>
    </div>
  )
}
