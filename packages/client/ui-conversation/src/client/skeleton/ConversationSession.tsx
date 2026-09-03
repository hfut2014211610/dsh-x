/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { ResizeHandle } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
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
function resolveActiveViewWithPreferred(
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
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
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
  sessionId, useSession, useSessions, useConversation, useConversationViews, useStore,
  renderSlot, open, selectView, views, t,
}: ConversationSessionHeaderProps) {
  const fallbackTabs: readonly ViewTab[] = []
  const viewsSubscribe = views?.subscribe ?? (() => () => {})
  const viewsVersion = views?.version ?? (() => 0)
  useSyncExternalStore(viewsSubscribe, viewsVersion)
  const hookTabs = useConversationViews?.(value => value) ?? views?.list() ?? fallbackTabs
  const tabs = hookTabs
  const switchableTabs = views === undefined ? [...tabs] : tabs.filter(tab => !views.isSessionOwned(tab.id))
  const selectedId = useStore(s => s.view)
  const preferredId = useSessions(() => views?.preferred(sessionId) ?? null)
  const activePreferredId = preferredId !== null && tabs.some(tab => tab.id === preferredId) ? preferredId : null
  const active = activePreferredId === null
    ? resolveActiveView([...switchableTabs], selectedId)
    : resolveActiveViewWithPreferred([...tabs], selectedId, activePreferredId)
  const companion = active === undefined || views === undefined ? null : views.companion(sessionId, active.id)
  const hasCompanion = companion !== null
    && companion.id !== active?.id
    && tabs.some(tab => tab.id === companion.id)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const blank = session.blank
  const phase = conversationPhase(session, conversation)
  const hideChrome = blank && phase === 'blank' && activePreferredId === null

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
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
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
          {switchableTabs.length > 1 && activePreferredId === null && !hasCompanion && (
            <div className={css.tabs} role="tablist">
              {switchableTabs.map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onClick={() => { selectView(viewTab.id) }}
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
  sessionId, useSession, useSessions, useConversation, useConversationViews,
  useInput, inputActions, useStore, actions,
  renderSlot, views, bindDraftMirror, releaseSessionImages, openView, t,
}: ConversationSessionProps) {
  const viewsSubscribe = views?.subscribe ?? (() => () => {})
  const viewsVersion = views?.version ?? (() => 0)
  useSyncExternalStore(viewsSubscribe, viewsVersion)
  const hookTabs = useConversationViews?.(value => value)
  const listedTabs = views?.list() ?? hookTabs ?? []
  const tabs = listedTabs
  const switchableTabs = views === undefined ? [...tabs] : tabs.filter(tab => !views.isSessionOwned(tab.id))
  const selectedId = useStore(s => s.view)
  const preferredId = useSessions?.(() => views?.preferred(sessionId) ?? null) ?? null
  const activePreferredId = preferredId !== null && tabs.some(tab => tab.id === preferredId) ? preferredId : null
  const active = activePreferredId === null
    ? resolveActiveView([...switchableTabs], selectedId)
    : resolveActiveViewWithPreferred([...tabs], selectedId, activePreferredId)
  const declaredCompanion = active === undefined || views === undefined ? null : views.companion(sessionId, active.id)
  const companion = declaredCompanion !== null
    && declaredCompanion.id !== active?.id
    && tabs.some(tab => tab.id === declaredCompanion.id)
    ? declaredCompanion
    : null
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const blank = session.blank
  const phase = conversationPhase(session, conversation)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  // `?? null`: persisted snapshots from before the inspect/viewRequest fields rehydrate without it.
  const inspect = useStore(s => (s as { inspect?: { callId: string } | null }).inspect ?? null)
  const viewRequest = useStore(s => (s as { viewRequest?: { view: string; focus: string } | null }).viewRequest ?? null)
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
  const showsCompanion = companion !== null && !(blank && phase === 'blank' && activePreferredId === null)

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
    releaseSessionImages?.(sessionId)
  }, [releaseSessionImages, sessionId])

  if (blank && phase === 'blank' && activePreferredId === null) return null
  const owner = {
    inspect,
    onInspectDone: () => { (actions as unknown as { setInspect?: (value: null) => void }).setInspect?.(null) },
    viewRequest,
    openView: openView ?? ((view: string, focus: string) => {
      const extended = actions as unknown as {
        openView?: (view: string, focus: string) => void
        setView?: (view: string) => void
      }
      if (extended.openView !== undefined) extended.openView(view, focus)
      else extended.setView?.(view)
    }),
    completeViewRequest: () => {
      (actions as unknown as { completeViewRequest?: () => void }).completeViewRequest?.()
    },
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
