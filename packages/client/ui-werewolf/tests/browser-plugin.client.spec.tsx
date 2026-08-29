// @vitest-environment jsdom
/**
 * ui-werewolf browser half on a real cordis Context with a fake sessions face
 * and a Service-based Remote double whose `werewolfGame` namespace answers per
 * script: the plugin claims the whole-frame shell only for its window URL, and
 * the inject face unwraps
 * each Remote verb's ok/error strip (a not-ok answer throws the error
 * message), forwards start/getView/submitAction/resume/abortGame/getReplay
 * requests verbatim, fans `game/projection-invalidated` into the
 * invalidation feed, and translates through the bound namespace. Fiber
 * disposal drops the shell entry. The node half apply() is an inert loader seat.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as clientApply, inject } from '../src/client/index.ts'
import type { ShellSurfaceOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { WerewolfSurfaceInjected } from '../src/client/WerewolfSurface.tsx'
import { en, zh } from '../src/client/locales.ts'
import type {
  WerewolfHumanViewV1,
  WerewolfLobbyViewV1,
} from '@deepseek-ai/dsh-werewolf/types'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

const sid = (k: string): SessionId => k as SessionId

/** Remote double: subscription plumbing for the forwarded-event feed only. */
class RemoteDouble extends Service {
  private readonly subscriptions = new Map<string, Set<(...args: never[]) => void>>()

  /** @param serviceCtx - spec root carrying the typed API service seat. */
  constructor(serviceCtx: Context) {
    super(serviceCtx, 'remote')
  }

  /**
   * Deliver one forwarded host event to its subscribers.
   * @param event - forwarded host event name.
   * @param args - the Host argument list, verbatim.
   */
  $dispatch(event: string, args: readonly unknown[]): void {
    for (const listener of [...this.subscriptions.get(event) ?? []]) listener(...args as never[])
  }

  /**
   * Subscribe to one forwarded host event.
   * @param event - forwarded host event name.
   * @param listener - receives the Host argument list verbatim.
   * @returns disposer removing this subscription.
   */
  $on(event: string, listener: (...args: never[]) => void): () => void {
    const listeners = this.subscriptions.get(event) ?? new Set()
    this.subscriptions.set(event, listeners)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
}

function lobbyFixture(): WerewolfLobbyViewV1 {
  return {
    version: 1,
    availableRuleSets: [
      { id: 'quick-7', revision: 1, displayName: 'Quick 7-player game', playerCount: 7 },
    ],
    activeGames: [],
  }
}

function viewFixture(): WerewolfHumanViewV1 {
  return {
    version: 1,
    gameId: 'g1',
    gameRevision: 4,
    status: 'running',
    day: 1,
    ruleSet: { id: 'quick-7', revision: 1, displayName: 'Quick 7-player game', playerCount: 7 },
    availableRuleSets: [],
    players: [
      { playerId: 'p1', seat: 1, displayName: 'Seat 1', alive: true, human: true },
    ],
    self: {
      playerId: 'p1',
      seat: 1,
      role: { id: 'seer', name: 'Seer', faction: 'village' },
      resources: {},
      teammates: [],
      notices: [],
    },
    phase: {
      phaseInstanceId: 'i1',
      phaseId: 'day.discussion',
      segment: 'day',
      day: 1,
      mode: 'seat-order-public',
      speech: { completed: 0, total: 1, current: { playerId: 'p1', seat: 1, displayName: 'Seat 1', human: true } },
    },
    actionForm: null,
    timeline: [],
    pauseReason: null,
    result: null,
  }
}

const REPLAY = { version: 1 as const, gameId: 'g1', finalRevision: 2, checkpoints: [] }

/** Boot the plugin over fake faces; the werewolfGame namespace answers per script. */
async function bench(options: { failWith?: string; dedicated?: boolean; gameId?: string; current?: string } = {}) {
  const dedicated = options.dedicated ?? true
  window.history.replaceState(null, '', dedicated
    ? `/?dshMode=werewolf${options.gameId === undefined ? '' : `&gameId=${options.gameId}`}`
    : '/')
  const ctx = new Context()
  const remote = new RemoteDouble(ctx)
  const answer = <T,>(value: T) => async () =>
    options.failWith === undefined
      ? { ok: true, value }
      : { ok: false, error: { message: options.failWith } }
  const werewolfGame = {
    getLobby: vi.fn(answer(lobbyFixture())),
    start: vi.fn(answer({ view: viewFixture() })),
    getView: vi.fn(answer({ view: viewFixture() })),
    submitAction: vi.fn(answer({ view: viewFixture() })),
    resume: vi.fn(answer({ view: viewFixture() })),
    abortGame: vi.fn(answer({ view: viewFixture() })),
    getReplay: vi.fn(answer(REPLAY)),
  }
  ctx.provide('remote.werewolfGame', werewolfGame)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'shell.surface': { kind: 'chain', scope: 'session-maybe' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const sessionListeners = new Set<() => void>()
  const open = vi.fn()
  const clear = vi.fn()
  const byId: Record<string, { agentPreset: string }> = {
    s1: { agentPreset: 'werewolf' },
    s2: { agentPreset: 'coding' },
    'game-g1': { agentPreset: 'werewolf' },
  }
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ byId, current: options.current === undefined ? undefined : sid(options.current) }),
      subscribe: (listener: () => void) => {
        sessionListeners.add(listener)
        return () => { sessionListeners.delete(listener) }
      },
    },
    open,
    clear,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply: clientApply })
  const surfaceEntry = () => ctx.slots.entries('shell.surface')[0]
  const launcherEntry = () => ctx.slots.entries('sidebar.footer.action')[0]
  const surfaceInjected = (sessionId: SessionId): WerewolfSurfaceInjected =>
    (surfaceEntry()?.inject as unknown as ((id: SessionId | undefined) => WerewolfSurfaceInjected))(sessionId)
  return {
    ctx,
    fiber,
    remote,
    werewolfGame,
    open,
    clear,
    surfaceEntry,
    launcherEntry,
    verbs: () => surfaceInjected(sid('s1')).view,
    hostVerbs: () => surfaceInjected(sid('game-g1')).view,
  }
}

describe('ui-werewolf browser plugin', () => {
  it('claims the whole frame only in the dedicated window and closes that window on exit', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const b = await bench()
    await b.fiber.await()
    const entry = b.surfaceEntry()
    const select = entry?.select as ((owner: ShellSurfaceOwnerProps) => unknown) | undefined
    expect(select?.({ agentPreset: 'werewolf' })).toEqual({ mode: 'werewolf-window' })
    expect(select?.({ agentPreset: 'coding' })).toEqual({ mode: 'werewolf-window' })
    window.history.replaceState(null, '', '/')
    expect(select?.({})).toBeNull()
    const injected = (entry?.inject as unknown as ((sessionId: SessionId | undefined) => WerewolfSurfaceInjected) | undefined)?.(sid('s1'))
    injected?.exitMode()
    expect(close).toHaveBeenCalledOnce()
  })

  it('restores the game id from the dedicated URL and updates that route after start', async () => {
    const b = await bench({ gameId: 'g1' })
    await b.fiber.await()
    expect(b.hostVerbs().initialGameId).toBe('g1')
    b.verbs().openGame('g2')
    expect(new URL(window.location.href).searchParams.get('gameId')).toBe('g2')
    expect(b.open).not.toHaveBeenCalled()
  })

  it('opens the game launcher in a named isolated window', async () => {
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null)
    const b = await bench({ dedicated: false, current: 's2' })
    await b.fiber.await()
    const injected = (b.launcherEntry()?.inject as unknown as () => { launch: () => void })()
    injected.launch()
    const [url, target] = openWindow.mock.calls[0] ?? []
    expect(new URL(String(url)).searchParams.get('dshMode')).toBe('werewolf')
    expect(target).toBe('dsh-werewolf')
  })

  it('clears a persisted legacy game session from the primary window', async () => {
    const b = await bench({ dedicated: false, current: 's1' })
    await b.fiber.await()
    expect(b.clear).toHaveBeenCalledOnce()
  })

  it('unwraps each Remote verb and forwards requests verbatim', async () => {
    const b = await bench()
    await b.fiber.await()
    const verbs = b.verbs()
    await expect(verbs.getLobby()).resolves.toMatchObject({ version: 1 })
    const startRequest = { requestId: 'r1', expectedGameRevision: 0 as const, ruleSetId: 'quick-7', ruleSetRevision: 1, seed: 7 }
    await expect(verbs.start(startRequest)).resolves.toMatchObject({ gameId: 'g1' })
    await expect(verbs.getView('g1')).resolves.toMatchObject({ gameId: 'g1' })
    await expect(verbs.submitAction({
      gameId: 'g1', requestId: 'r2', expectedGameRevision: 4, phaseInstanceId: 'i1', action: { value: 'hi' },
    })).resolves.toMatchObject({ gameId: 'g1' })
    await expect(verbs.resume({ gameId: 'g1', requestId: 'r3', expectedGameRevision: 4 }))
      .resolves.toMatchObject({ gameId: 'g1' })
    await expect(verbs.abortGame({ gameId: 'g1', requestId: 'r4', expectedGameRevision: 4 }))
      .resolves.toMatchObject({ gameId: 'g1' })
    await expect(verbs.getReplay('g1')).resolves.toMatchObject({ finalRevision: 2 })
    expect(b.werewolfGame.start).toHaveBeenCalledWith(startRequest)
    expect(b.werewolfGame.getView).toHaveBeenCalledWith({ gameId: 'g1' })
    expect(b.werewolfGame.submitAction).toHaveBeenCalledWith({
      gameId: 'g1', requestId: 'r2', expectedGameRevision: 4, phaseInstanceId: 'i1', action: { value: 'hi' },
    })
    expect(b.werewolfGame.resume).toHaveBeenCalledWith({ gameId: 'g1', requestId: 'r3', expectedGameRevision: 4 })
    expect(b.werewolfGame.abortGame).toHaveBeenCalledWith({ gameId: 'g1', requestId: 'r4', expectedGameRevision: 4 })
    expect(b.werewolfGame.getReplay).toHaveBeenCalledWith({ gameId: 'g1' })
  })

  it('throws the Remote error message when a verb answers not-ok', async () => {
    const b = await bench({ failWith: 'engine offline' })
    await b.fiber.await()
    const verbs = b.verbs()
    await expect(verbs.getLobby()).rejects.toThrow('engine offline')
    await expect(verbs.start({
      requestId: 'r1', expectedGameRevision: 0, ruleSetId: 'quick-7', ruleSetRevision: 1, seed: 1,
    })).rejects.toThrow('engine offline')
    await expect(verbs.getView('g1')).rejects.toThrow('engine offline')
    await expect(verbs.submitAction({
      gameId: 'g1', requestId: 'r2', expectedGameRevision: 4, phaseInstanceId: 'i1', action: null,
    })).rejects.toThrow('engine offline')
    await expect(verbs.resume({ gameId: 'g1', requestId: 'r3', expectedGameRevision: 4 }))
      .rejects.toThrow('engine offline')
    await expect(verbs.abortGame({ gameId: 'g1', requestId: 'r4', expectedGameRevision: 4 }))
      .rejects.toThrow('engine offline')
    await expect(verbs.getReplay('g1')).rejects.toThrow('engine offline')
  })

  it('fans projection invalidation into the subscription and stops on dispose', async () => {
    const b = await bench()
    await b.fiber.await()
    const verbs = b.verbs()
    const seen: string[] = []
    const stop = verbs.subscribeInvalidated((gameId) => { seen.push(gameId) })
    b.remote.$dispatch('game/projection-invalidated', ['g1', 9])
    b.remote.$dispatch('game/projection-invalidated', ['g2', 10])
    expect(seen).toEqual(['g1', 'g2'])
    stop()
    b.remote.$dispatch('game/projection-invalidated', ['g1', 11])
    expect(seen).toEqual(['g1', 'g2'])
  })

  it('translates through the bound namespace dictionaries', async () => {
    const b = await bench()
    await b.fiber.await()
    const verbs = b.verbs()
    expect([
      zh['lobby.players'].replace('{count}', '7'),
      en['lobby.players'].replace('{count}', '7'),
    ]).toContain(verbs.translate('lobby.players', { count: 7 }))
    expect([zh['lobby.title'], en['lobby.title']]).toContain(verbs.translate('lobby.title'))
  })

  it('drops the whole-frame entry when the fiber unloads', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.surfaceEntry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.surfaceEntry()).toBeUndefined()
  })
})

describe('ui-werewolf node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // every Context this suite creates; its registration is covered there.
  it('the host apply is an inert loader seat', () => {
    expect(() => { hostApply() }).not.toThrow()
  })
})
