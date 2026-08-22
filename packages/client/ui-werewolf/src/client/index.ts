/**
 * Browser Werewolf plugin: registers the dedicated `werewolf`
 * conversation view, declares it preferred for `werewolf`-preset sessions,
 * and supplies the typed Remote verbs plus the invalidation feed as the
 * injected face. The plugin registers no command and mutates nothing
 * through the Chat composer.
 * @module @deepseek-ai/dsh-client-ui-werewolf/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the 'conversation.view' SlotMap row and ctx.conversation face.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WerewolfView, type WerewolfViewInjected } from './WerewolfView.tsx'
import { en, NS, zh } from './locales.ts'

/** Required services: conversation slot and service, sessions, remote namespace, locale. */
export const inject = ['slots', 'conversation', 'sessions', 'remote', 'remote.werewolfGame', 'locale']

/**
 * Client plugin body: the dedicated view tab for `werewolf` sessions.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-werewolf: dictionaries')
  const t = ctx.locale.bind(NS)

  const isWerewolfSession = (sessionId: SessionId): boolean =>
    ctx.sessions.list.getSnapshot().byId[sessionId]?.agentPreset === 'werewolf'

  const gameIdOf = (id: SessionId): string | undefined => {
    if (!isWerewolfSession(id) || !id.startsWith('game-')) return undefined
    const gameId = id.slice('game-'.length)
    return gameId === '' ? undefined : gameId
  }

  const openGame = (gameId: string): void => {
    const hostSessionId = `game-${gameId}` as SessionId
    const tryOpen = (): boolean => {
      if (ctx.sessions.list.getSnapshot().byId[hostSessionId] === undefined) return false
      ctx.sessions.open(hostSessionId)
      return true
    }
    if (tryOpen()) return
    let stop = (): void => {}
    stop = ctx.sessions.list.subscribe(() => {
      if (!tryOpen()) return
      stop()
    })
    ctx.effect(() => stop, `ui-werewolf: pending Host navigation ${hostSessionId}`)
  }

  ctx.effect(() => ctx.conversation.declarePreferredView(
    (sessionId: SessionId) => isWerewolfSession(sessionId) ? 'werewolf' : null,
  ), 'ui-werewolf: preferred view')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'werewolf',
    order: 6,
    locale: NS,
    label: () => t('view.werewolf'),
    inject: (currentSessionId: SessionId): WerewolfViewInjected => {
      const initialGameId = gameIdOf(currentSessionId)
      return {
        ...(initialGameId === undefined ? {} : { initialGameId }),
        openGame,
        getLobby: async () => {
          const result = await ctx.remote.werewolfGame.getLobby()
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        start: async (request) => {
          const result = await ctx.remote.werewolfGame.start(request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value.view
        },
        getView: async (gameId) => {
          const result = await ctx.remote.werewolfGame.getView({ gameId })
          if (!result.ok) throw new Error(result.error.message)
          return result.value.view
        },
        submitAction: async (request) => {
          const result = await ctx.remote.werewolfGame.submitAction(request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value.view
        },
        resume: async (request) => {
          const result = await ctx.remote.werewolfGame.resume(request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value.view
        },
        abortGame: async (request) => {
          const result = await ctx.remote.werewolfGame.abortGame(request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value.view
        },
        getReplay: async (gameId) => {
          const result = await ctx.remote.werewolfGame.getReplay({ gameId })
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        subscribeInvalidated: listener => ctx.remote.$on('game/projection-invalidated', (gameId, _revision) => {
          listener(gameId)
        }),
        translate: (key, params) => t(key, params),
      }
    },
  }, WerewolfView))
}
