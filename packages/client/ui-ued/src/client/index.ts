/**
 * Browser half of the UED preview view.
 * @module @deepseek-ai/dsh-client-ui-ued/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row and ctx.conversation face.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { DocumentChange } from '@deepseek-ai/dsh-documents/types'
import { UedView, type UedViewInjected } from './UedView.tsx'
import { en, NS, zh } from './locales.ts'

/** The preset whose sessions this view belongs to. */
const PRESET = 'ued'

/** Required services: the conversation slot, sessions, remote documents, and locale. */
export const inject = ['slots', 'conversation', 'sessions', 'remote', 'remote.documents', 'locale']

/**
 * Register the design view, make it the preferred view for `ued` sessions, and
 * supply the documents Remote callbacks it reads through.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-ued: dictionaries')
  const t = ctx.locale.bind(NS)

  const changedListeners = new Map<SessionId, Set<(change: DocumentChange) => void>>()
  ctx.remote.$on('documents/changed', (change) => {
    const listeners = changedListeners.get(change.sessionId)
    if (listeners === undefined) return
    for (const listener of [...listeners]) listener(change)
  })

  // The gate is the preset, not the file type. Without it every session would
  // acquire a render entry for any HTML in its workspace, widening this
  // boundary from design sessions to all of them.
  const isDesignSession = (sessionId: SessionId): boolean =>
    ctx.sessions.list.getSnapshot().byId[sessionId]?.agentPreset === PRESET

  ctx.effect(() => ctx.conversation.declarePreferredView(
    (sessionId: SessionId) => isDesignSession(sessionId) ? PRESET : null,
  ), 'ui-ued: preferred view')

  ctx.effect(() => ctx.conversation.declareCompanionView(
    (sessionId: SessionId, activeViewId: string) => isDesignSession(sessionId) && activeViewId === PRESET
      ? { id: 'chat', label: t('assistant.title') }
      : null,
  ), 'ui-ued: assistant companion')

  const documentsFor = (sessionId: SessionId): UedViewInjected => ({
    list: async (path) => {
      const result = await ctx.remote.documents.list({ sessionId, ...(path === undefined ? {} : { path }) })
      return result.ok ? result.value : { error: result.error.message }
    },
    load: async (path) => {
      const result = await ctx.remote.documents.read({ sessionId, path })
      return result.ok ? result.value : { error: result.error.message }
    },
    subscribeChanged: (fn) => {
      let listeners = changedListeners.get(sessionId)
      if (listeners === undefined) {
        listeners = new Set()
        changedListeners.set(sessionId, listeners)
      }
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
        if (listeners.size === 0) changedListeners.delete(sessionId)
      }
    },
    translate: t,
  })

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: PRESET,
    order: 6,
    locale: NS,
    label: () => t('view.ued'),
    inject: (sessionId: SessionId): UedViewInjected => documentsFor(sessionId),
  }, UedView))
}
