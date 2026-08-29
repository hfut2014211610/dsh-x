import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { GameAiExecutor, GameModule } from '../src/executor.ts'
import type { GameRequestId } from '../src/types.ts'
import {
  canonicalGameJson,
  digestGamePayload,
  GameHostError,
  GameId,
  GameRequestId as gameRequestId,
  ParticipantId as participantId,
  PrincipalId as principalId,
  SessionGameService,
} from '../src/index.ts'
import { GameService } from '../src/service.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

interface EdgeState {
  gameId: string
  revision: number
  status: 'running' | 'paused' | 'ended'
  value: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'game-edge/state': EdgeState
  }
}

const stateEvent = (state: EdgeState) => ({ type: 'game-edge/state', data: state as unknown as JsonValue })

class EdgeModule implements GameModule<EdgeState> {
  readonly id: string
  readonly version: number
  automaticScheduling?: 'foreground' | 'background'
  hostAgentOptions?: AgentOptions
  hostAgentPreset?: string
  initializeHook?: (state: EdgeState, executor: GameAiExecutor) => Promise<void>
  gameIdValue = 'edge'
  preparedStatus: EdgeState['status'] = 'running'
  preparedEvents: ReadonlyArray<{ type: string; data: JsonValue }> | undefined
  restoreMode: 'normal' | 'missing' | 'wrong-id' = 'normal'
  mutationMode: 'normal' | 'empty' | 'same-revision' = 'normal'
  advanceHook: ((state: EdgeState, executor: GameAiExecutor) => Promise<{
    state: EdgeState
    events: ReadonlyArray<{ type: string; data: JsonValue }>
    stop: boolean
  }>) | undefined

  constructor(id = 'edge', version = 1) {
    this.id = id
    this.version = version
  }

  async prepareStart(_input: JsonValue, _principal: unknown, _requestId: GameRequestId, _payloadDigest: string) {
    const state: EdgeState = { gameId: this.gameIdValue, revision: 1, status: this.preparedStatus, value: 0 }
    return {
      gameId: GameId(state.gameId),
      participantId: participantId('human'),
      state,
      events: this.preparedEvents ?? [stateEvent(state)],
    }
  }

  restore(events: readonly SessionEvent[]): EdgeState | undefined {
    if (this.restoreMode === 'missing') return undefined
    const state = events.filter(event => event.type === 'game-edge/state').at(-1)?.data
    return this.restoreMode === 'wrong-id' && state !== undefined ? { ...state, gameId: 'wrong' } : state
  }

  gameId(state: EdgeState) { return GameId(state.gameId) }
  revision(state: EdgeState) { return state.revision }
  status(state: EdgeState) { return state.status }

  async initializeAgents(state: EdgeState, executor: GameAiExecutor): Promise<void> {
    await this.initializeHook?.(state, executor)
  }

  async mutate(state: EdgeState, request: { method: 'submitAction' | 'resume' | 'abortGame'; payload: JsonValue }) {
    if (this.mutationMode === 'empty') return { state, events: [] }
    const next: EdgeState = {
      ...state,
      revision: this.mutationMode === 'same-revision' ? state.revision : state.revision + 1,
      status: request.method === 'abortGame' ? 'ended' : 'running',
      value: request.method === 'submitAction' ? Number(request.payload) : state.value,
    }
    return { state: next, events: [stateEvent(next)] }
  }

  async advance(state: EdgeState, _history: readonly SessionEvent[], executor: GameAiExecutor) {
    return this.advanceHook === undefined
      ? { state, events: [], stop: true }
      : await this.advanceHook(state, executor)
  }

  project(state: EdgeState) { return { status: state.status, value: state.value } }
  replay(state: EdgeState) { return { revision: state.revision, value: state.value } }
}

interface IndexedHost {
  gameId: ReturnType<typeof GameId>
  session: Session
  handle?: AgentHandle
  botHandles: Map<SessionId, AgentHandle>
  agentsInitialized: boolean
}

interface GameInternals {
  modules: Map<string, GameModule>
  hosts: Map<ReturnType<typeof GameId>, IndexedHost>
  automaticAdvances: Map<ReturnType<typeof GameId>, Promise<void>>
  startReceipts: Map<string, ReturnType<typeof GameId>>
  recoveries: Map<ReturnType<typeof GameId>, Promise<IndexedHost>>
  executor(record: IndexedHost, host: Agent, signal: AbortSignal): GameAiExecutor
  indexSession(session: Session): void
}

const internals = (service: GameService): GameInternals => service as unknown as GameInternals

async function setup(module = new EdgeModule()) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  const fiber = await ctx.plugin(SessionGameService)
  const disposeModule = ctx.games.registerModule(module)
  return { ctx, module, fiber, disposeModule }
}

async function start(ctx: Context, requestId = 'start-edge') {
  return await ctx.games.start<{ status: EdgeState['status']; value: number }>({
    moduleId: 'edge', requestId: gameRequestId(requestId), expectedGameRevision: 0, input: { b: 2, a: 1 },
  })
}

describe('game Host utility and service edges', () => {
  it('canonicalizes every JSON category and rejects a non-JSON payload', () => {
    expect(canonicalGameJson('x')).toBe('"x"')
    expect(canonicalGameJson([true, null, 2])).toBe('[true,null,2]')
    expect(canonicalGameJson({ z: 1, a: ['x'] })).toBe('{"a":["x"],"z":1}')
    expect(digestGamePayload({ z: 1, a: 2 })).toBe(digestGamePayload({ a: 2, z: 1 }))
    expect(() => digestGamePayload(BigInt(1) as never)).toThrow(/not losslessly JSON-serializable/)
  })

  it('keeps the abstract service non-instantiable', () => {
    expect(() => { Reflect.construct(GameService, [new Context()]) }).toThrow(/is abstract/)
  })

  it('rejects duplicate modules and removes only the exact registration', async () => {
    const { ctx, module, disposeModule } = await setup()
    expect(() => ctx.games.registerModule(module)).toThrow(/already registered at version 1/)
    const replacement = new EdgeModule('edge', 2)
    internals(ctx.games).modules.set('edge', replacement)
    disposeModule()
    expect(internals(ctx.games).modules.get('edge')).toBe(replacement)
    internals(ctx.games).modules.delete('edge')
    expect(ctx.games.getHostSession(GameId('missing'))).toBeUndefined()
  })

  it('uses explicit Host options and rejects a second start for the same game id', async () => {
    const module = new EdgeModule()
    module.hostAgentOptions = {}
    module.hostAgentPreset = 'game-test'
    const { ctx } = await setup(module)
    await start(ctx)
    expect(ctx.games.getHostSession(GameId('edge'))?.header.agentPreset).toBe('game-test')
    await expect(start(ctx, 'start-edge-2')).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
  })

  it('indexes a pre-existing Host Session without taking ownership of an Agent handle', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    const session = ctx.sessions.create(SessionId('game-indexed'))
    const state: EdgeState = { gameId: 'indexed', revision: 1, status: 'paused', value: 0 }
    session.appendBatch([
      { type: 'game/command-receipt', data: {
        version: 1,
        gameId: GameId('indexed'),
        module: { id: 'edge', version: 1 },
        method: 'start',
        requestId: gameRequestId('indexed-start'),
        payloadDigest: 'a'.repeat(64),
        gameRevision: 1,
        principalId: principalId('local'),
        participantId: participantId('human'),
      } },
      { type: 'game-edge/state', data: state },
    ])
    const fiber = await ctx.plugin(SessionGameService)
    expect(ctx.games.getHostSession(GameId('indexed'))).toBe(session)
    await fiber.dispose()
  })

  it('disposes an uncommitted Host and retains a committed Host when module advancement fails', async () => {
    const invalid = new EdgeModule()
    invalid.preparedEvents = [{ type: 'game-edge/state', data: BigInt(1) as never }]
    const first = await setup(invalid)
    await expect(start(first.ctx)).rejects.toThrow(/non-JSON-serializable/)
    expect(first.ctx.agents.get(SessionId('game-edge'))).toBeUndefined()

    const throwing = new EdgeModule()
    throwing.advanceHook = async () => { throw new Error('advance failed') }
    const second = await setup(throwing)
    await expect(start(second.ctx)).rejects.toThrow('advance failed')
    expect(second.ctx.games.getHostSession(GameId('edge'))?.events.map(event => event.type)).toEqual([
      'game/command-receipt', 'game-edge/state',
    ])
  })

  it('supports replay, resume, abort, mutation dedupe, conflicts, and stale rejection', async () => {
    const { ctx } = await setup()
    const started = await start(ctx)
    const principal = ctx.games.resolvePrincipal().id
    expect(await ctx.games.getReplay(started.gameId, principal)).toEqual({ revision: 1, value: 0 })
    const resumed = await ctx.games.resume({
      gameId: started.gameId, principalId: principal, requestId: gameRequestId('resume-1'), expectedGameRevision: 1,
    })
    expect(resumed.gameRevision).toBe(2)
    const action = {
      gameId: started.gameId, principalId: principal, requestId: gameRequestId('action-1'), expectedGameRevision: 2, action: 4,
    }
    const submitted = await ctx.games.submitAction(action)
    expect((await ctx.games.submitAction({ ...action, expectedGameRevision: 999 })).gameRevision).toBe(submitted.gameRevision)
    await expect(ctx.games.submitAction({ ...action, action: 5 })).rejects.toMatchObject({ code: 'GAME_IDEMPOTENCY_CONFLICT' })
    await expect(ctx.games.submitAction({ ...action, requestId: gameRequestId('stale'), action: 6 }))
      .rejects.toMatchObject({ code: 'GAME_STALE_REVISION' })
    const aborted = await ctx.games.abortGame({
      gameId: started.gameId, principalId: principal, requestId: gameRequestId('abort-1'), expectedGameRevision: 3,
    })
    expect(aborted).toMatchObject({ gameRevision: 4, view: { status: 'ended', value: 4 } })
  })

  it('rejects empty, non-progressing, and empty non-stopping transitions', async () => {
    for (const mode of ['empty', 'same-revision'] as const) {
      const module = new EdgeModule()
      module.mutationMode = mode
      const { ctx } = await setup(module)
      const started = await start(ctx)
      await expect(ctx.games.submitAction({
        gameId: started.gameId,
        principalId: ctx.games.resolvePrincipal().id,
        requestId: gameRequestId(`bad-${mode}`),
        expectedGameRevision: 1,
        action: 1,
      })).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
    }

    const module = new EdgeModule()
    module.advanceHook = async state => ({ state, events: [], stop: false })
    const { ctx } = await setup(module)
    await expect(start(ctx)).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
  })

  it('publishes progressing automatic steps until stop or terminal status', async () => {
    const stopping = new EdgeModule()
    stopping.advanceHook = async (state) => {
      const next = { ...state, revision: state.revision + 1 }
      return { state: next, events: [stateEvent(next)], stop: true }
    }
    const first = await setup(stopping)
    expect((await start(first.ctx)).gameRevision).toBe(2)

    const terminal = new EdgeModule()
    terminal.advanceHook = async (state) => {
      const next: EdgeState = { ...state, revision: state.revision + 1, status: 'ended' }
      return { state: next, events: [stateEvent(next)], stop: false }
    }
    const second = await setup(terminal)
    expect((await start(second.ctx)).view.status).toBe('ended')

    const alreadyEnded = new EdgeModule()
    alreadyEnded.preparedStatus = 'ended'
    const third = await setup(alreadyEnded)
    expect((await start(third.ctx)).view.status).toBe('ended')
  })

  it('initializes fixed Agents before returning and publishes background steps incrementally', async () => {
    const module = new EdgeModule()
    module.automaticScheduling = 'background'
    let initialized = 0
    let entered = false
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    module.initializeHook = async () => { initialized += 1 }
    module.advanceHook = async (state) => {
      entered = true
      await gate
      const next = { ...state, revision: state.revision + 1 }
      return { state: next, events: [stateEvent(next)], stop: true }
    }
    const { ctx } = await setup(module)
    const started = await start(ctx)
    expect(started.gameRevision).toBe(1)
    expect(initialized).toBe(1)
    await vi.waitFor(() => { expect(entered).toBe(true) })
    release?.()
    await vi.waitFor(async () => {
      expect((await ctx.games.getView(started.gameId, ctx.games.resolvePrincipal().id)).gameRevision).toBe(2)
    })
    expect(initialized).toBe(1)
  })

  it('restarts background scheduling when a recovered active view is reopened', async () => {
    const module = new EdgeModule()
    module.automaticScheduling = 'background'
    let advances = 0
    module.advanceHook = async (state) => {
      advances += 1
      const next = { ...state, revision: state.revision + 1 }
      return { state: next, events: [stateEvent(next)], stop: true }
    }
    const { ctx } = await setup(module)
    const started = await start(ctx)
    await vi.waitFor(() => { expect(advances).toBe(1) })
    const service = internals(ctx.games)
    await vi.waitFor(() => { expect(service.automaticAdvances.has(started.gameId)).toBe(false) })
    const record = service.hosts.get(started.gameId)
    if (record === undefined) throw new Error('missing Host record fixture')
    record.agentsInitialized = false

    await ctx.games.getView(started.gameId, ctx.games.resolvePrincipal().id)

    await vi.waitFor(() => { expect(advances).toBe(2) })
  })

  it('owns child parenting and bounded ordered mapping', async () => {
    const { ctx } = await setup()
    const started = await start(ctx)
    const host = ctx.agents.get(SessionId(`game-${started.gameId}`))
    if (host === undefined) throw new Error('missing Host fixture')
    const record = internals(ctx.games).hosts.get(started.gameId)
    if (record === undefined) throw new Error('missing Host record fixture')
    const controller = new AbortController()
    const executor = internals(ctx.games).executor(record, host, controller.signal)
    const run = { id: 'child', localAgent: undefined, result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }
    const startSpy = vi.spyOn(ctx.subagents, 'start').mockResolvedValue(run as never)
    const prompt = [{ type: 'text' as const, text: 'decide' }]
    await expect(executor.start('fake', { prompt })).resolves.toBe(run)
    const [provider, childRequest] = startSpy.mock.calls[0] as never as [
      string,
      { parent: Agent; signal: AbortSignal; prompt: typeof prompt },
    ]
    expect(provider).toBe('fake')
    expect(childRequest.parent).toBe(host)
    expect(childRequest.signal).toBe(controller.signal)
    expect(childRequest.prompt).toBe(prompt)

    let active = 0
    let maximum = 0
    const result = await executor.map([3, 1, 2], 2, async (value) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, value))
      active -= 1
      return value * 2
    })
    expect(result).toEqual([6, 2, 4])
    expect(maximum).toBe(2)
    expect(await executor.map([], 2, async value => value)).toEqual([])
    await expect(executor.map([1], 0, async value => value)).rejects.toThrow(/positive integer/)
    await expect(executor.map([1], 1.5, async value => value)).rejects.toThrow(/positive integer/)
  })

  it('reuses one hidden Bot session for consecutive game decisions', async () => {
    const { ctx } = await setup()
    const adapter = new MockAdapter(
      [textResponse('{"turn":1}'), textResponse('{"turn":2}')],
      {
        efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
        defaultEffort: ReasoningEffortId('high'),
      },
    )
    ctx.llm.registerAdapter(['mock'], adapter)
    const started = await start(ctx)
    const host = ctx.agents.get(SessionId(`game-${started.gameId}`))
    const record = internals(ctx.games).hosts.get(started.gameId)
    if (host === undefined || record === undefined) throw new Error('missing Host fixture')
    const executor = internals(ctx.games).executor(record, host, new AbortController().signal)
    const childId = SessionId(`game-${started.gameId}-bot-seat-1`)
    const provision = {
      childId,
      label: 'Seat 1',
      agentOptions: { provider: 'mock', model: 'mock' },
      reasoningEffort: ReasoningEffortId('high'),
      persona: 'You are fixed Seat 1 for this game.',
      toolFilter: { allow: [] },
    }
    await executor.provisionBot(provision)
    const child = ctx.agents.get(childId)
    expect(child?.session.header).toMatchObject({ parentSession: host.id })
    expect(child?.session.header.origin).toBeUndefined()
    await executor.provisionBot(provision)
    expect(ctx.agents.get(childId)).toBe(child)

    const first = await executor.turnBot(childId, [{ type: 'text', text: 'decision 1' }], 1_000)
    const second = await executor.turnBot(childId, [{ type: 'text', text: 'decision 2' }], 1_000)
    expect(first).toMatchObject({ childId, output: [{ type: 'text', text: '{"turn":1}' }], stopReason: 'completed' })
    expect(second).toMatchObject({ childId, output: [{ type: 'text', text: '{"turn":2}' }], stopReason: 'completed' })
    expect(adapter.requests.map(request => request.reasoningEffort)).toEqual([
      ReasoningEffortId('high'),
      ReasoningEffortId('high'),
    ])
    expect(child?.session.events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(adapter.requests[1]?.messages.some(message => (
      message.role === 'assistant'
      && message.content.some(block => block.type === 'text' && block.text === '{"turn":1}')
    ))).toBe(true)
    expect(await ctx.subagents.listChildren(host.id)).toEqual([])
  })

  it('stops mapping on cancellation with and without a reason', async () => {
    const { ctx } = await setup()
    const started = await start(ctx)
    const host = ctx.agents.get(SessionId(`game-${started.gameId}`))
    if (host === undefined) throw new Error('missing Host fixture')
    const record = internals(ctx.games).hosts.get(started.gameId)
    if (record === undefined) throw new Error('missing Host record fixture')
    const reason = new Error('cancelled')
    const withReason = internals(ctx.games).executor(record, host, { aborted: true, reason } as AbortSignal)
    await expect(withReason.map([1], 1, async value => value)).rejects.toBe(reason)
    const withoutReason = internals(ctx.games).executor(record, host, { aborted: true, reason: undefined } as unknown as AbortSignal)
    await expect(withoutReason.map([1], 1, async value => value)).rejects.toThrow('game AI operation cancelled')
  })

  it('fails loud when restore state or module registration no longer matches the Host', async () => {
    const { ctx, module, disposeModule } = await setup()
    const started = await start(ctx)
    const principal = ctx.games.resolvePrincipal().id
    module.restoreMode = 'missing'
    await expect(ctx.games.getView(started.gameId, principal)).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
    module.restoreMode = 'wrong-id'
    await expect(ctx.games.getView(started.gameId, principal)).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
    module.restoreMode = 'normal'
    disposeModule()
    await expect(ctx.games.getView(started.gameId, principal)).rejects.toMatchObject({ code: 'GAME_MODULE_UNAVAILABLE' })
    ctx.games.registerModule(new EdgeModule('edge', 2))
    await expect(ctx.games.getView(started.gameId, principal)).rejects.toMatchObject({ code: 'GAME_MODULE_UNAVAILABLE' })
  })

  it('recovers a known Host once and shares the in-flight recovery', async () => {
    const { ctx } = await setup()
    const started = await start(ctx)
    const storage = internals(ctx.games)
    const record = storage.hosts.get(started.gameId)
    if (record?.handle === undefined) throw new Error('missing Host record fixture')
    storage.hosts.delete(started.gameId)
    let resolveResume: ((handle: AgentHandle) => void) | undefined
    const pending = new Promise<AgentHandle>((resolve) => { resolveResume = resolve })
    const resume = vi.spyOn(ctx.agents, 'resume').mockReturnValue(pending)
    const first = ctx.games.getView(started.gameId, ctx.games.resolvePrincipal().id)
    const second = ctx.games.getView(started.gameId, ctx.games.resolvePrincipal().id)
    await Promise.resolve()
    expect(resume).toHaveBeenCalledTimes(1)
    resolveResume?.(record.handle)
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('handles recovery failures, malformed resumed Hosts, and a replaced pending entry', async () => {
    const first = await setup()
    vi.spyOn(first.ctx.agents, 'resume').mockRejectedValueOnce('offline')
    const offline = first.ctx.games.getView(GameId('unknown'), principalId('local'))
    await expect(offline).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' })
    await expect(offline).rejects.toThrow(/offline/)

    const errorFailure = await setup()
    const unavailable = errorFailure.ctx.games.getView(GameId('unknown-error'), principalId('local'))
    await expect(unavailable).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' })
    await expect(unavailable).rejects.toThrow(/persistence/)

    const second = await setup()
    const empty = await second.ctx.agents.create({ sessionId: SessionId('game-empty') })
    vi.spyOn(second.ctx.agents, 'resume').mockResolvedValueOnce(empty)
    await expect(second.ctx.games.getView(GameId('empty'), principalId('local'))).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
    expect(second.ctx.agents.get(SessionId('game-empty'))).toBeUndefined()

    const third = await setup()
    const started = await start(third.ctx)
    const storage = internals(third.ctx.games)
    const record = storage.hosts.get(started.gameId)
    if (record?.handle === undefined) throw new Error('missing Host record fixture')
    storage.hosts.delete(started.gameId)
    let resolveResume: ((handle: AgentHandle) => void) | undefined
    vi.spyOn(third.ctx.agents, 'resume').mockReturnValue(new Promise((resolve) => { resolveResume = resolve }))
    const recovering = third.ctx.games.getView(started.gameId, third.ctx.games.resolvePrincipal().id)
    await Promise.resolve()
    storage.recoveries.set(started.gameId, Promise.resolve(record))
    resolveResume?.(record.handle)
    await expect(recovering).resolves.toBeDefined()
  })

  it('uses indexed live sessions and rejects a missing live Agent for mutation', async () => {
    const { ctx } = await setup()
    const started = await start(ctx)
    const storage = internals(ctx.games)
    const record = storage.hosts.get(started.gameId)
    if (record?.handle === undefined) throw new Error('missing Host record fixture')
    storage.hosts.delete(started.gameId)
    storage.indexSession(record.session)
    await expect(ctx.games.getView(started.gameId, ctx.games.resolvePrincipal().id)).resolves.toBeDefined()

    await record.handle.dispose()
    const indexed = storage.hosts.get(started.gameId)
    if (indexed === undefined) throw new Error('missing indexed Host fixture')
    indexed.handle = record.handle
    await expect(ctx.games.submitAction({
      gameId: started.gameId,
      principalId: ctx.games.resolvePrincipal().id,
      requestId: gameRequestId('after-dispose'),
      expectedGameRevision: 1,
      action: 1,
    })).rejects.toMatchObject({ code: 'GAME_INVALID_TRANSITION' })
  })

  it('indexes only start receipts and reports a corrupt duplicate lookup as not found', async () => {
    const { ctx } = await setup()
    const storage = internals(ctx.games)
    storage.indexSession({ id: SessionId('none'), events: [] } as unknown as Session)
    storage.indexSession({
      id: SessionId('resume'),
      events: [{
        type: 'game/command-receipt', seq: 0, time: 1, data: {
          version: 1, gameId: GameId('resume'), module: { id: 'edge', version: 1 }, method: 'resume',
          requestId: gameRequestId('resume'), payloadDigest: '0'.repeat(64), gameRevision: 1,
          principalId: principalId('local'), participantId: participantId('human'),
        },
      }],
    } as unknown as Session)
    storage.startReceipts.set('local\u0000ghost', GameId('ghost'))
    await expect(ctx.games.start({ moduleId: 'edge', requestId: gameRequestId('ghost'), expectedGameRevision: 0, input: null }))
      .rejects.toMatchObject({ code: 'GAME_NOT_FOUND' })
  })

  it('continues a queued operation after its predecessor rejects', async () => {
    const { ctx } = await setup()
    const started = await start(ctx)
    const principal = ctx.games.resolvePrincipal().id
    const stale = ctx.games.submitAction({
      gameId: started.gameId, principalId: principal, requestId: gameRequestId('stale-first'), expectedGameRevision: 0, action: 1,
    })
    const valid = ctx.games.submitAction({
      gameId: started.gameId, principalId: principal, requestId: gameRequestId('valid-second'), expectedGameRevision: 1, action: 2,
    })
    await expect(stale).rejects.toBeInstanceOf(GameHostError)
    await expect(valid).resolves.toMatchObject({ gameRevision: 2, view: { value: 2 } })
  })

  it('disposes all owned Host handles with the provider fiber', async () => {
    const { ctx, fiber } = await setup()
    const started = await start(ctx)
    expect(ctx.agents.get(SessionId(`game-${started.gameId}`))).toBeDefined()
    await fiber.dispose()
    expect(ctx.agents.get(SessionId(`game-${started.gameId}`))).toBeUndefined()
  })
})
