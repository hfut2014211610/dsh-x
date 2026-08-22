/**
 * Browser Werewolf plugin: takes over the whole shell for `werewolf`-preset
 * sessions and supplies the typed Remote verbs plus invalidation feed as the
 * injected face. The ordinary conversation, navigation, and overlays remain
 * outside the selected game mode.
 * @module @deepseek-ai/dsh-client-ui-werewolf/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ShellSurfaceOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { WerewolfViewInjected } from './WerewolfView.tsx'
import {
  WerewolfSurface, type WerewolfSurfaceInjected, type WerewolfSurfaceMatch,
} from './WerewolfSurface.tsx'
import { en, NS, zh } from './locales.ts'

/** Required services: shell slots, sessions, remote namespace, and locale. */
export const inject = ['slots', 'sessions', 'remote', 'remote.werewolfGame', 'locale']

/** Elect the whole-frame game shell only for Host-confirmed Werewolf sessions. */
function selectWerewolfSurface(owner: ShellSurfaceOwnerProps): WerewolfSurfaceMatch | null {
  return owner.agentPreset === 'werewolf' ? { agentPreset: 'werewolf' } : null
}

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

  const viewInjected = (currentSessionId: SessionId | undefined): WerewolfViewInjected => {
    const initialGameId = currentSessionId === undefined ? undefined : gameIdOf(currentSessionId)
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
  }

  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface',
    priority: 10,
    select: selectWerewolfSurface,
    inject: (currentSessionId: SessionId | undefined): WerewolfSurfaceInjected => ({
      view: viewInjected(currentSessionId),
      exitMode: () => { ctx.sessions.clear() },
    }),
  }, WerewolfSurface))
}
