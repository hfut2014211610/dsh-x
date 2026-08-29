/**
 * Browser Werewolf plugin: opens an isolated window, takes over that whole
 * window, and supplies the typed Remote verbs plus invalidation feed as the
 * injected face. Ordinary conversations remain in the primary window.
 * @module @deepseek-ai/dsh-client-ui-werewolf/client
 */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ShellSurfaceOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { WerewolfViewInjected } from './WerewolfView.tsx'
import {
  WerewolfSurface, type WerewolfSurfaceInjected, type WerewolfSurfaceMatch,
} from './WerewolfSurface.tsx'
import { WerewolfLauncher } from './WerewolfLauncher.tsx'
import { en, NS, zh } from './locales.ts'

/** Required services: shell slots, sessions, remote namespace, and locale. */
export const inject = ['slots', 'sessions', 'remote', 'remote.werewolfGame', 'locale']

const MODE_PARAM = 'dshMode'
const GAME_PARAM = 'gameId'
const WEREWOLF_MODE = 'werewolf'

function routeUrl(gameId?: string): URL {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set(MODE_PARAM, WEREWOLF_MODE)
  if (gameId !== undefined) url.searchParams.set(GAME_PARAM, gameId)
  return url
}

function isWerewolfWindow(): boolean {
  return new URL(window.location.href).searchParams.get(MODE_PARAM) === WEREWOLF_MODE
}

function routeGameId(): string | undefined {
  if (!isWerewolfWindow()) return undefined
  const gameId = new URL(window.location.href).searchParams.get(GAME_PARAM)
  return gameId === null || gameId === '' ? undefined : gameId
}

/** Elect the whole-frame game shell only inside the dedicated window. */
function selectWerewolfSurface(_owner: ShellSurfaceOwnerProps): WerewolfSurfaceMatch | null {
  return isWerewolfWindow() ? { mode: 'werewolf-window' } : null
}

/**
 * Client plugin body: global launcher plus dedicated game-window surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-werewolf: dictionaries')
  const t = ctx.locale.bind(NS)

  const openGame = (gameId?: string): void => {
    window.history.replaceState(null, '', routeUrl(gameId))
  }

  const viewInjected = (): WerewolfViewInjected => {
    const initialGameId = routeGameId()
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

  if (!isWerewolfWindow()) {
    const sessions: ISessions = ctx.sessions
    const clearLegacyGameSelection = (): void => {
      const list = sessions.list.getSnapshot()
      const current = list.current
      if (current !== undefined && list.byId[current]?.agentPreset === 'werewolf') sessions.clear()
    }
    clearLegacyGameSelection()
    ctx.effect(() => sessions.list.subscribe(clearLegacyGameSelection), 'ui-werewolf: isolate legacy game sessions')
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'werewolf-window',
    priority: 20,
    inject: () => ({
      launch: () => { window.open(routeUrl().toString(), 'dsh-werewolf', 'popup,width=1440,height=900') },
      label: t('launcher.label'),
      hint: t('launcher.hint'),
    }),
  }, WerewolfLauncher))

  ctx.slots.inject('shell.surface', () => ctx.slots.register({
    name: 'shell.surface',
    priority: 10,
    select: selectWerewolfSurface,
    inject: (_currentSessionId: SessionId | undefined): WerewolfSurfaceInjected => ({
      view: viewInjected(),
      exitMode: () => { window.close() },
    }),
  }, WerewolfSurface))
}
