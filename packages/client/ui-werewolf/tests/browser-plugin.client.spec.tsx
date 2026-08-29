// @vitest-environment jsdom
/**
 * ui-werewolf browser half on a real cordis Context with fake conversation/
 * sessions faces and a Service-based Remote double whose `werewolfGame`
 * namespace answers per script: the plugin registers the `werewolf`
 * conversation view (id, order, locale namespace, localized label), declares
 * it preferred only for werewolf-preset sessions, and the inject face unwraps
 * each Remote verb's ok/error strip (a not-ok answer throws the error
 * message), forwards start/getView/submitAction/resume/abortGame/getReplay
 * requests verbatim, fans `game/projection-invalidated` into the
 * invalidation feed, and translates through the bound namespace. Fiber
 * disposal drops the view entry and the preferred-view resolver. The node
 * half apply() is an inert loader seat.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as clientApply, inject } from '../src/client/index.ts'
import type { WerewolfViewInjected } from '../src/client/WerewolfView.tsx'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from '../src/client/locales.ts'
import type {
  WerewolfHumanViewV1,
  WerewolfLobbyViewV1,
} from '@deepseek-ai/dsh-werewolf/types'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

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
async function bench(options: { failWith?: string; hostInitiallyVisible?: boolean } = {}) {
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
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const preferred: Array<(sessionId: SessionId) => string | null> = []
  const sessionListeners = new Set<() => void>()
  const open = vi.fn()
  const byId: Record<string, { agentPreset: string }> = {
    s1: { agentPreset: 'werewolf' },
    s2: { agentPreset: 'coding' },
    ...(options.hostInitiallyVisible === false ? {} : { 'game-g1': { agentPreset: 'werewolf' } }),
  }
  ctx.provide('conversation', {
    declarePreferredView: (resolver: (sessionId: SessionId) => string | null) => {
      preferred.push(resolver)
      return () => {
        const index = preferred.indexOf(resolver)
        if (index >= 0) preferred.splice(index, 1)
      }
    },
  })
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ byId }),
      subscribe: (listener: () => void) => {
        sessionListeners.add(listener)
        return () => { sessionListeners.delete(listener) }
      },
    },
    open,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply: clientApply })
  const entry = () => {
    const found = ctx.slots.entries('conversation.view')[0]
    if (found === undefined) return undefined
    return {
      options: found.options as { id: string; order: number; label?: () => string },
      locale: found.locale,
      inject: found.inject as unknown as ((sessionId: SessionId) => WerewolfViewInjected) | undefined,
    }
  }
  const composerEntry = () => ctx.slots.entries('conversation.composer')[0]
  return {
    ctx,
    fiber,
    remote,
    preferred,
    werewolfGame,
    open,
    entry,
    composerEntry,
    verbs: () => entry()?.inject?.(sid('s1')) as WerewolfViewInjected,
    hostVerbs: () => entry()?.inject?.(sid('game-g1')) as WerewolfViewInjected,
    publishHost: () => {
      byId['game-g1'] = { agentPreset: 'werewolf' }
      for (const listener of [...sessionListeners]) listener()
    },
  }
}

describe('ui-werewolf browser plugin', () => {
  it('registers the werewolf conversation view over the locale namespace', async () => {
    const b = await bench()
    await b.fiber.await()
    const entry = b.entry()
    expect(entry?.options).toMatchObject({ id: 'werewolf', order: 6 })
    expect(entry?.locale).toBe(NS)
    expect([zh['view.werewolf'], en['view.werewolf']]).toContain(entry?.options.label?.())
  })

  it('declares the view preferred only for werewolf-preset sessions', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.preferred).toHaveLength(1)
    expect(b.preferred[0]!(sid('s1'))).toBe('werewolf')
    expect(b.preferred[0]!(sid('s2'))).toBeNull()
    expect(b.preferred[0]!(sid('unknown'))).toBeNull()
  })

  it('suppresses the generic composer only for werewolf-preset sessions', async () => {
    const b = await bench()
    await b.fiber.await()
    const entry = b.composerEntry()
    const select = entry?.select as ((owner: ComposerChainProps) => unknown) | undefined
    expect(select?.({ interactions: [], session: undefined, agentPreset: 'werewolf' })).toEqual({ agentPreset: 'werewolf' })
    expect(select?.({ interactions: [], session: undefined, agentPreset: 'coding' })).toBeNull()
    expect(select?.({ interactions: [], session: undefined, agentPreset: undefined })).toBeNull()
    expect((entry?.component as (() => unknown) | undefined)?.()).toBeNull()
  })

  it('binds Host Sessions to their game and opens the dedicated Host after start', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.hostVerbs().initialGameId).toBe('g1')
    expect(b.verbs().initialGameId).toBeUndefined()
    b.verbs().openGame('g1')
    expect(b.open).toHaveBeenCalledWith(sid('game-g1'))
  })

  it('waits for a newly published Host before navigating to it', async () => {
    const b = await bench({ hostInitiallyVisible: false })
    await b.fiber.await()
    b.verbs().openGame('g1')
    expect(b.open).not.toHaveBeenCalled()
    b.publishHost()
    expect(b.open).toHaveBeenCalledWith(sid('game-g1'))
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

  it('drops the view entry and the preferred resolver when the fiber unloads', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    expect(b.composerEntry()).toBeDefined()
    expect(b.preferred).toHaveLength(1)
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.composerEntry()).toBeUndefined()
    expect(b.preferred).toHaveLength(0)
  })
})

describe('ui-werewolf node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // every Context this suite creates; its registration is covered there.
  it('the host apply is an inert loader seat', () => {
    expect(() => { hostApply() }).not.toThrow()
  })
})
