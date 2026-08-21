import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionGameService, {
  GameId,
  GameRequestId,
  ParticipantId,
  PrincipalId,
  type GameAdvance,
  type GameModule,
  type GameMutationRequest,
  type PreparedGameStart,
} from '../src/index.ts'

interface TestGameState {
  gameId: string
  revision: number
  status: 'running' | 'paused' | 'ended'
  value: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'game-test/state': TestGameState
  }
}

const event = (state: TestGameState) => ({ type: 'game-test/state', data: state as unknown as JsonValue })

class TestGameModule implements GameModule<TestGameState> {
  readonly id = 'test'
  readonly version = 1
  starts = 0

  async prepareStart(_input: JsonValue): Promise<PreparedGameStart<TestGameState>> {
    this.starts += 1
    const state: TestGameState = { gameId: 'g1', revision: 1, status: 'running', value: 0 }
    return { gameId: GameId(state.gameId), participantId: ParticipantId('human'), state, events: [event(state)] }
  }

  restore(events: readonly SessionEvent[]): TestGameState | undefined {
    return events.filter(candidate => candidate.type === 'game-test/state').at(-1)?.data
  }

  gameId(state: TestGameState) { return GameId(state.gameId) }
  revision(state: TestGameState) { return state.revision }
  status(state: TestGameState) { return state.status }

  async mutate(state: TestGameState, request: GameMutationRequest): Promise<{ state: TestGameState; events: ReturnType<typeof event>[] }> {
    const value = request.method === 'submitAction' ? Number(request.payload) : state.value
    const next: TestGameState = {
      ...state,
      revision: state.revision + 1,
      value,
      status: request.method === 'abortGame' ? 'ended' : 'running',
    }
    return { state: next, events: [event(next)] }
  }

  async advance(state: TestGameState): Promise<GameAdvance<TestGameState>> {
    return { state, events: [], stop: true }
  }

  project(state: TestGameState) { return { value: state.value, status: state.status } }
  replay(state: TestGameState) { return { value: state.value } }
}

async function setup() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SessionGameService)
  const module = new TestGameModule()
  ctx.games.registerModule(module)
  return { ctx, module }
}

describe('SessionGameService', () => {
  it('commits the receipt and domain start event before either observer runs', async () => {
    const { ctx } = await setup()
    const observedLengths: number[] = []
    ctx.on('session/event', (session, candidate) => {
      if (candidate.type === 'game/command-receipt' || candidate.type === 'game-test/state') observedLengths.push(session.events.length)
    })
    const started = await ctx.games.start<{ value: number }>({
      moduleId: 'test',
      requestId: GameRequestId('start-1'),
      expectedGameRevision: 0,
      input: { mode: 'test' },
    })
    expect(started.gameRevision).toBe(1)
    expect(observedLengths).toEqual([2, 2])
    expect(ctx.games.getHostSession(started.gameId)?.events.map(candidate => candidate.type)).toEqual([
      'game/command-receipt',
      'game-test/state',
    ])
  })

  it('deduplicates equal requests and rejects a reused key with another payload', async () => {
    const { ctx, module } = await setup()
    const request = { moduleId: 'test', requestId: GameRequestId('start-1'), expectedGameRevision: 0 as const }
    const first = await ctx.games.start({ ...request, input: { value: 1 } })
    const duplicate = await ctx.games.start({ ...request, input: { value: 1 } })
    expect(duplicate).toEqual(first)
    expect(module.starts).toBe(1)
    await expect(ctx.games.start({ ...request, input: { value: 2 } })).rejects.toMatchObject({ code: 'GAME_IDEMPOTENCY_CONFLICT' })
  })

  it('includes the module route in start idempotency', async () => {
    const { ctx } = await setup()
    const other = new TestGameModule()
    Object.defineProperty(other, 'id', { value: 'other' })
    ctx.games.registerModule(other)
    const requestId = GameRequestId('shared-start')
    await ctx.games.start({ moduleId: 'test', requestId, expectedGameRevision: 0, input: null })
    await expect(ctx.games.start({ moduleId: 'other', requestId, expectedGameRevision: 0, input: null }))
      .rejects.toMatchObject({ code: 'GAME_IDEMPOTENCY_CONFLICT' })
    expect(other.starts).toBe(0)
  })

  it('serializes competing mutations and authorizes the bound principal', async () => {
    const { ctx } = await setup()
    const started = await ctx.games.start({
      moduleId: 'test', requestId: GameRequestId('start-1'), expectedGameRevision: 0, input: null,
    })
    const principalId = ctx.games.resolvePrincipal().id
    const first = ctx.games.submitAction({
      gameId: started.gameId, principalId, requestId: GameRequestId('a1'), expectedGameRevision: 1, action: 10,
    })
    const second = ctx.games.submitAction({
      gameId: started.gameId, principalId, requestId: GameRequestId('a2'), expectedGameRevision: 1, action: 20,
    })
    const settled = await Promise.allSettled([first, second])
    expect(settled.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await ctx.games.getView(started.gameId, principalId)).toMatchObject({ gameRevision: 2, view: { value: 10 } })
    await expect(ctx.games.getView(started.gameId, PrincipalId('other'))).rejects.toMatchObject({ code: 'GAME_FORBIDDEN' })
  })
})
