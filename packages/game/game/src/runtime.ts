/** Default Session-backed game Host provider. @module @deepseek-ai/dsh-game */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue, Session, SessionAppendEntry, TurnEndReason } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import { isGameCommandReceipt } from './events.ts'
import { GameService } from './service.ts'
import type { GameAiExecutor, GameModule } from './executor.ts'
import {
  GameId,
  PrincipalId,
  type GameCommandReceiptV1,
  type GameEventCandidate,
  type GameMutationMethod,
  type GameProjection,
  type GameRequestId,
  type LocalGamePrincipalV1,
  type ParticipantId,
} from './types.ts'

interface HostRecord {
  gameId: GameId
  moduleId: string
  moduleVersion: number
  principalId: PrincipalId
  participantId: ParticipantId
  session: Session
  handle?: AgentHandle
  botHandles: Map<SessionId, AgentHandle>
}

function botStopReason(reason: TurnEndReason): SubagentStopReason {
  switch (reason.kind) {
    case 'completed': return 'completed'
    case 'aborted': return 'aborted'
    case 'max-tokens': return 'max-tokens'
    case 'blocked': return 'refusal'
    case 'error':
    case 'interrupted': return 'error'
    default: return 'error'
  }
}

async function awaitBotTurn(agent: Agent, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
  })
  const cancelled = new Promise<'cancelled'>((resolve) => {
    onAbort = () => { resolve('cancelled') }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const outcome = await Promise.race([
      agent.whenIdle().then(() => 'idle' as const),
      timeout,
      cancelled,
    ])
    if (outcome === 'idle') return false
    agent.cancel(outcome === 'timeout'
      ? { kind: 'hook', reason: 'game Bot decision timeout' }
      : { kind: 'parent' })
    await agent.whenIdle()
    if (outcome === 'cancelled') throw signal.reason ?? new Error('game AI operation cancelled')
    return true
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/** Stable game-host failure with a machine-readable code. */
export class GameHostError extends Error {
  constructor(readonly code: 'GAME_NOT_FOUND' | 'GAME_FORBIDDEN' | 'GAME_STALE_REVISION' | 'GAME_IDEMPOTENCY_CONFLICT' | 'GAME_MODULE_UNAVAILABLE' | 'GAME_INVALID_TRANSITION', message: string) {
    super(message)
    this.name = 'GameHostError'
  }
}

/**
 * Canonical JSON serialization used for command payload digests.
 * @param value - JSON value to serialize.
 * @returns stable JSON text with recursively sorted object keys.
 */
export function canonicalGameJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalGameJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalGameJson(value[key] as JsonValue)}`).join(',')}}`
}

/**
 * SHA-256 digest of one detached JSON command payload.
 * @param value - command payload to snapshot and hash.
 * @returns lowercase SHA-256 hexadecimal digest.
 */
export function digestGamePayload(value: JsonValue): string {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('game command payload is not losslessly JSON-serializable')
  return createHash('sha256').update(canonicalGameJson(snapshot)).digest('hex')
}

function receiptEvent(receipt: GameCommandReceiptV1): GameEventCandidate {
  return { type: 'game/command-receipt', data: receipt as unknown as JsonValue }
}

/** Complete game seam: registry Consumer plus Session Host provider. */
export class SessionGameService extends GameService {
  static inject = ['agents', 'sessions', 'subagents']

  private readonly modules = new Map<string, GameModule>()
  private readonly hosts = new Map<GameId, HostRecord>()
  private readonly startReceipts = new Map<string, GameId>()
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly recoveries = new Map<GameId, Promise<HostRecord>>()

  constructor(ctx: Context) {
    super(ctx)
    for (const session of ctx.sessions.list()) this.indexSession(session)
    ctx.on('session/created', (session) => { this.indexSession(session) })
    ctx.effect(() => async () => {
      const records = [...this.hosts.values()]
      const botHandles = records.flatMap(record => [...record.botHandles.values()])
      await Promise.allSettled(botHandles.map(handle => handle.dispose()))
      const hostHandles = records.flatMap(record => record.handle === undefined ? [] : [record.handle])
      await Promise.allSettled(hostHandles.map(handle => handle.dispose()))
    }, 'games.hostLifecycle()')
  }

  /** @inheritdoc */
  registerModule(module: GameModule): () => void {
    const existing = this.modules.get(module.id)
    if (existing !== undefined) throw new Error(`game module ${JSON.stringify(module.id)} is already registered at version ${existing.version}`)
    const dispose = this.ctx.effect(() => {
      this.modules.set(module.id, module)
      return () => {
        if (this.modules.get(module.id) === module) this.modules.delete(module.id)
      }
    }, 'games.registerModule()')
    return () => { void dispose() }
  }

  /** @inheritdoc */
  resolvePrincipal(): LocalGamePrincipalV1 {
    return { version: 1, kind: 'local', id: PrincipalId('local') }
  }

  /** @inheritdoc */
  async start<TView>(request: {
    moduleId: string
    requestId: GameRequestId
    expectedGameRevision: 0
    input: JsonValue
  }): Promise<GameProjection<TView>> {
    return await this.enqueue('\u0000start', async () => {
      const principal = this.resolvePrincipal()
      const payloadDigest = digestGamePayload({ moduleId: request.moduleId, input: request.input })
      const duplicateId = this.startReceipts.get(`${principal.id}\u0000${request.requestId}`)
      if (duplicateId !== undefined) {
        const duplicate = this.requireHost(duplicateId)
        const receipt = this.receipts(duplicate)
          .find(entry => entry.method === 'start' && entry.requestId === request.requestId)
        if (receipt?.payloadDigest !== payloadDigest) throw this.idempotencyConflict('start', request.requestId)
        return this.project<TView>(duplicate)
      }
      const module = this.requireModule(request.moduleId)
      const prepared = await module.prepareStart(request.input, principal, request.requestId, payloadDigest)
      if (this.hosts.has(prepared.gameId)) {
        throw new GameHostError('GAME_INVALID_TRANSITION', `game ${prepared.gameId} already exists`)
      }
      const handle = await this.ctx.agents.create({
        sessionId: SessionId(`game-${prepared.gameId}`),
        ...(module.hostAgentPreset === undefined ? {} : { meta: { agentPreset: module.hostAgentPreset } }),
        ...(module.hostAgentOptions === undefined ? {} : { agentOptions: module.hostAgentOptions }),
      })
      const record: HostRecord = {
        gameId: prepared.gameId,
        moduleId: module.id,
        moduleVersion: module.version,
        principalId: principal.id,
        participantId: prepared.participantId,
        session: handle.agent.session,
        handle,
        botHandles: new Map(),
      }
      try {
        const receipt: GameCommandReceiptV1 = {
          version: 1,
          gameId: prepared.gameId,
          module: { id: module.id, version: module.version },
          method: 'start',
          requestId: request.requestId,
          payloadDigest,
          gameRevision: module.revision(prepared.state),
          principalId: principal.id,
          participantId: prepared.participantId,
        }
        this.append(record.session, [receiptEvent(receipt), ...prepared.events])
        this.hosts.set(record.gameId, record)
        this.startReceipts.set(`${principal.id}\u0000${request.requestId}`, record.gameId)
        this.invalidate(record.gameId, module.revision(prepared.state))
        await handle.agent.runMaintenance(async (signal) => {
          await this.advance(record, module, prepared.state, handle.agent, signal)
        })
        return this.project<TView>(record)
      } catch (error) {
        if (!this.hosts.has(record.gameId)) await handle.dispose()
        throw error
      }
    })
  }

  /** @inheritdoc */
  async getView<TView>(gameId: GameId, principalId: PrincipalId): Promise<GameProjection<TView>> {
    const record = await this.authorize(gameId, principalId)
    return this.project<TView>(record)
  }

  /** @inheritdoc */
  async getReplay<TReplay>(gameId: GameId, principalId: PrincipalId): Promise<TReplay> {
    const record = await this.authorize(gameId, principalId)
    const module = this.moduleFor(record)
    const state = this.restore(module, record)
    return module.replay(state, record.session.events, record.participantId) as TReplay
  }

  /** @inheritdoc */
  async submitAction<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
    action: JsonValue
  }): Promise<GameProjection<TView>> {
    return await this.mutate<TView>('submitAction', request, request.action, true)
  }

  /** @inheritdoc */
  async resume<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
  }): Promise<GameProjection<TView>> {
    return await this.mutate<TView>('resume', request, null, true)
  }

  /** @inheritdoc */
  async abortGame<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
  }): Promise<GameProjection<TView>> {
    return await this.mutate<TView>('abortGame', request, null, false)
  }

  /** @inheritdoc */
  getHostSession(gameId: GameId): Session | undefined {
    return this.hosts.get(gameId)?.session
  }

  private async mutate<TView>(
    method: Exclude<GameMutationMethod, 'start'>,
    request: { gameId: GameId; principalId: PrincipalId; requestId: GameRequestId; expectedGameRevision: number },
    payload: JsonValue,
    autoAdvance: boolean,
  ): Promise<GameProjection<TView>> {
    return await this.enqueue(String(request.gameId), async () => {
      const record = await this.authorize(request.gameId, request.principalId)
      const module = this.moduleFor(record)
      const payloadDigest = digestGamePayload(payload)
      const existing = this.receipts(record).find(receipt => receipt.method === method && receipt.requestId === request.requestId)
      if (existing !== undefined) {
        if (existing.payloadDigest !== payloadDigest) throw this.idempotencyConflict(method, request.requestId)
        return this.project<TView>(record)
      }
      const state = this.restore(module, record)
      if (module.revision(state) !== request.expectedGameRevision) {
        throw new GameHostError('GAME_STALE_REVISION', `game ${request.gameId} revision is ${module.revision(state)}, expected ${request.expectedGameRevision}`)
      }
      const transition = await module.mutate(state, {
        method,
        participantId: record.participantId,
        payload,
        requestId: request.requestId,
        payloadDigest,
      })
      this.requireProgress(module, state, transition.state, transition.events)
      const receipt: GameCommandReceiptV1 = {
        version: 1,
        gameId: record.gameId,
        module: { id: module.id, version: module.version },
        method,
        requestId: request.requestId,
        payloadDigest,
        gameRevision: module.revision(transition.state),
        principalId: record.principalId,
        participantId: record.participantId,
      }
      const agent = this.requireAgent(record)
      await agent.runMaintenance(async (signal) => {
        this.append(record.session, [receiptEvent(receipt), ...transition.events])
        this.invalidate(record.gameId, module.revision(transition.state))
        if (autoAdvance) await this.advance(record, module, transition.state, agent, signal)
      })
      if (module.status(transition.state) === 'ended') await this.releaseBots(record)
      return this.project<TView>(record)
    })
  }

  private async advance(record: HostRecord, module: GameModule, initial: unknown, agent: Agent, signal: AbortSignal): Promise<void> {
    let state = initial
    while (module.status(state) === 'running') {
      const executor = this.executor(record, agent, signal)
      const step = await module.advance(state, record.session.events, executor)
      if (step.events.length === 0) {
        if (!step.stop) throw new GameHostError('GAME_INVALID_TRANSITION', `game module ${module.id} returned an empty non-stopping advance`)
        return
      }
      this.requireProgress(module, state, step.state, step.events)
      this.append(record.session, step.events)
      const previousRevision = module.revision(state)
      state = step.state
      /* v8 ignore else -- requireProgress immediately above proves the revision changed */
      if (module.revision(state) !== previousRevision) this.invalidate(record.gameId, module.revision(state))
      if (step.stop) return
    }
    await this.releaseBots(record)
  }

  private executor(record: HostRecord, host: Agent, signal: AbortSignal): GameAiExecutor {
    return {
      host,
      signal,
      start: async (provider, request) => await this.ctx.subagents.start(provider, { ...request, parent: host, signal }),
      provisionBot: async (request) => {
        if (record.botHandles.has(request.childId)) return
        if (this.ctx.agents.get(request.childId) !== undefined) {
          throw new Error(`game Bot agent ${request.childId} already exists outside game ${record.gameId}`)
        }
        const childDepth = resolveChildDepth(host, request.maxDepth)
        const policies = captureDelegatedPolicyOverrides(host)
        const handle = await this.ctx.agents.create({
          sessionId: request.childId,
          meta: {
            ...(host.session.header.cwd === undefined ? {} : { cwd: host.session.header.cwd }),
            parentSession: host.id,
            delegationDepth: childDepth,
          },
          agentOptions: resolveChildAgentOptions(host, request.agentOptions, childDepth),
          signal,
          setup: (childCtx) => {
            applyChildComposition(childCtx, host, {
              persona: request.persona,
              ...(request.toolFilter === undefined ? {} : { toolFilter: request.toolFilter }),
            })
          },
        })
        try {
          appendDelegatedPolicyOverrides(handle.agent.session, policies)
          record.botHandles.set(request.childId, handle)
        } catch (error) {
          await handle.dispose()
          throw new Error(`game Bot ${request.label} could not be provisioned`, { cause: error })
        }
      },
      turnBot: async (childId, prompt, timeoutMs) => {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
          throw new Error('game Bot timeoutMs must be a positive integer')
        }
        const handle = record.botHandles.get(childId)
        if (handle === undefined) throw new Error(`game Bot agent ${childId} is not provisioned`)
        if (signal.aborted) throw signal.reason ?? new Error('game AI operation cancelled')
        const startSeq = handle.agent.session.seq
        handle.agent.followup(createUserMessage({
          content: prompt,
          source: { kind: 'plugin', plugin: 'game' },
        }))
        const timedOut = await awaitBotTurn(handle.agent, timeoutMs, signal)
        const events = handle.agent.session.events.filter(event => event.seq >= startSeq)
        const end = events.findLast(event => event.type === 'turn/end')
        if (end?.type !== 'turn/end') throw new Error(`game Bot agent ${childId} ended without a turn boundary`)
        return {
          childId,
          output: finalAssistantOutput(events) ?? [],
          stopReason: botStopReason(end.data.reason),
          timedOut,
        }
      },
      map: async <T, R>(items: readonly T[], maxConcurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
        if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) throw new Error('game AI maxConcurrency must be a positive integer')
        const results = new Array<R>(items.length)
        let cursor = 0
        const run = async (): Promise<void> => {
          while (cursor < items.length) {
            if (signal.aborted) throw signal.reason ?? new Error('game AI operation cancelled')
            const index = cursor++
            results[index] = await worker(items[index] as T)
          }
        }
        await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, run))
        return results
      },
    }
  }

  private async releaseBots(record: HostRecord): Promise<void> {
    const handles = [...record.botHandles.values()]
    record.botHandles.clear()
    const settled = await Promise.allSettled(handles.map(async (handle) => {
      await this.ctx.sessions.flush(handle.agent.session)
      await handle.dispose()
    }))
    const failures = settled.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      this.ctx.logger.warn(`game ${record.gameId} failed to release ${failures.length} Bot agent(s)`)
    }
  }

  private append(session: Session, events: readonly GameEventCandidate[]): void {
    session.appendBatch(events.map(event => ({ type: event.type, data: event.data })) as SessionAppendEntry[])
  }

  private project<TView>(record: HostRecord): GameProjection<TView> {
    const module = this.moduleFor(record)
    const state = this.restore(module, record)
    return {
      gameId: record.gameId,
      gameRevision: module.revision(state),
      module: { id: module.id, version: module.version },
      view: module.project(state, record.participantId) as TView,
    }
  }

  private restore(module: GameModule, record: HostRecord): unknown {
    const state = module.restore(record.session.events)
    if (state === undefined) throw new GameHostError('GAME_INVALID_TRANSITION', `Host ${record.session.id} has no ${module.id} state`)
    if (module.gameId(state) !== record.gameId) throw new GameHostError('GAME_INVALID_TRANSITION', `Host ${record.session.id} restored another game id`)
    return state
  }

  private requireProgress(module: GameModule, before: unknown, after: unknown, events: readonly GameEventCandidate[]): void {
    if (events.length === 0 || module.revision(after) <= module.revision(before)) {
      throw new GameHostError('GAME_INVALID_TRANSITION', `game module ${module.id} did not advance its revision with a non-empty transition`)
    }
  }

  private receipts(record: HostRecord): GameCommandReceiptV1[] {
    return record.session.events.filter(isGameCommandReceipt).map(event => event.data)
  }

  private requireModule(id: string): GameModule {
    const module = this.modules.get(id)
    if (module === undefined) throw new GameHostError('GAME_MODULE_UNAVAILABLE', `game module ${JSON.stringify(id)} is not registered`)
    return module
  }

  private moduleFor(record: HostRecord): GameModule {
    const module = this.requireModule(record.moduleId)
    if (module.version !== record.moduleVersion) {
      throw new GameHostError('GAME_MODULE_UNAVAILABLE', `game ${record.gameId} requires ${record.moduleId}@${record.moduleVersion}, registered ${module.version}`)
    }
    return module
  }

  private requireHost(gameId: GameId): HostRecord {
    const record = this.hosts.get(gameId)
    if (record === undefined) throw new GameHostError('GAME_NOT_FOUND', `game ${gameId} does not exist`)
    return record
  }

  private async authorize(gameId: GameId, principalId: PrincipalId): Promise<HostRecord> {
    const record = await this.recoverHost(gameId)
    if (record.principalId !== principalId) throw new GameHostError('GAME_FORBIDDEN', `principal ${principalId} is not bound to game ${gameId}`)
    return record
  }

  private async recoverHost(gameId: GameId): Promise<HostRecord> {
    const indexed = this.hosts.get(gameId)
    if (indexed !== undefined && (indexed.handle !== undefined || this.ctx.agents.get(indexed.session.id) !== undefined)) return indexed
    const pending = this.recoveries.get(gameId)
    if (pending !== undefined) return await pending
    const recovery = (async () => {
      let handle: AgentHandle
      try {
        handle = await this.ctx.agents.resume({ resumeSessionId: SessionId(`game-${gameId}`) })
      } catch (error) {
        throw new GameHostError('GAME_NOT_FOUND', `game ${gameId} could not be resumed: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.indexSession(handle.agent.session)
      const record = this.hosts.get(gameId)
      if (record === undefined) {
        await handle.dispose()
        throw new GameHostError('GAME_INVALID_TRANSITION', `resumed Host ${handle.agent.session.id} has no start receipt for game ${gameId}`)
      }
      record.handle = handle
      return record
    })()
    this.recoveries.set(gameId, recovery)
    try {
      return await recovery
    } finally {
      if (this.recoveries.get(gameId) === recovery) this.recoveries.delete(gameId)
    }
  }

  private requireAgent(record: HostRecord): Agent {
    const agent = this.ctx.agents.get(record.session.id)
    if (agent === undefined) throw new GameHostError('GAME_INVALID_TRANSITION', `game Host agent ${record.session.id} is not live`)
    return agent
  }

  private invalidate(gameId: GameId, revision: number): void {
    this.ctx.emit('game/projection-invalidated', gameId, revision)
  }

  private idempotencyConflict(method: GameMutationMethod, requestId: GameRequestId): GameHostError {
    return new GameHostError('GAME_IDEMPOTENCY_CONFLICT', `${method} request ${requestId} was already committed with another payload`)
  }

  private indexSession(session: Session): void {
    const receipt = session.events.find(isGameCommandReceipt)?.data
    if (receipt === undefined || receipt.method !== 'start' || this.hosts.has(receipt.gameId)) return
    const record: HostRecord = {
      gameId: receipt.gameId,
      moduleId: receipt.module.id,
      moduleVersion: receipt.module.version,
      principalId: receipt.principalId,
      participantId: receipt.participantId,
      session,
      botHandles: new Map(),
    }
    this.hosts.set(record.gameId, record)
    this.startReceipts.set(`${record.principalId}\u0000${receipt.requestId}`, record.gameId)
  }

  private async enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const current = previous.then(operation)
    const settled = current.then(() => undefined, () => undefined)
    this.tails.set(key, settled)
    try {
      return await current
    } finally {
      if (this.tails.get(key) === settled) this.tails.delete(key)
    }
  }
}

export default SessionGameService
