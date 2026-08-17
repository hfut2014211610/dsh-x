/**
 * Browser writing-mode plugin.
 * @module @deepseek-ai/dsh-client-ui-writing/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row and ctx.conversation face.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientSessionContext, InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { WritingView, type WritingViewInjected } from './WritingView.tsx'
import { en, NS, zh } from './locales.ts'

/** Required services: the conversation slot, conversation service, sessions, remote, and locale. */
export const inject = ['slots', 'conversation', 'sessions', 'remote', 'inputTriggers', 'locale']

/**
 * Client plugin body: register the writing view tab, declare it as the
 * preferred view for `writing` sessions, and supply the documents Remote
 * callbacks to the view.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-writing: dictionaries')
  const t = ctx.locale.bind(NS)
  const changedListeners = new Map<SessionId, Set<() => void>>()
  let lastPath = ''
  ctx.remote.$on('documents/changed', (change) => {
    const listeners = changedListeners.get(change.sessionId)
    if (listeners === undefined) return
    for (const listener of [...listeners]) listener()
  })
  ctx.conversation.declarePreferredView((sessionId: SessionId) => {
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    return summary?.agentPreset === 'writing' ? 'writing' : null
  })

  const docSource: InputTriggerSource = {
    trigger: '@',
    name: 'doc',
    candidates(_session: ClientSessionContext, { query }) {
      return Promise.resolve(lastPath === '' || !lastPath.includes(query) ? [] : [{ name: lastPath }])
    },
    lexicon() {
      return lastPath === '' ? [] : [lastPath]
    },
    subscribeLexicon(_session, _listener) {
      // The source is a single in-memory path; no external change feed exists yet.
      return () => {}
    },
    onPick({ candidate }) {
      return { text: `@doc ${candidate.name} ` }
    },
    codec: {
      clipboardText: ref => `@doc ${ref}`,
      serialize: ref => Promise.resolve(`@doc ${ref}`),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(docSource), 'ui-writing: @doc source')

  const documentsFor = (sessionId: SessionId): WritingViewInjected => ({
    load: async (path) => {
      const result = await ctx.remote.documents.read({ sessionId, path })
      if (result.ok) lastPath = path
      return result.ok ? result.value : { error: result.error.message }
    },
    save: async (path, baseVersion, content) => {
      const lineCount = Math.max(1, content.split(/\r?\n/).length)
      const result = await ctx.remote.documents.apply({
        sessionId,
        path,
        baseVersion,
        edit: {
          kind: 'replace',
          locator: { unit: 'line', start: 1, end: lineCount },
          text: content,
        },
      })
      return result.ok ? { version: result.value.version } : { error: result.error.message }
    },
    outline: async (path) => {
      const result = await ctx.remote.documents.outline({ sessionId, path })
      return result.ok ? result.value.entries : []
    },
    search: async (query) => {
      const result = await ctx.remote.documents.search({ sessionId, query })
      return result.ok ? result.value.hits : []
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
  })

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'writing',
    order: 5,
    locale: NS,
    label: () => t('view.writing'),
    inject: (sessionId: SessionId): WritingViewInjected => documentsFor(sessionId),
  }, WritingView))
}
