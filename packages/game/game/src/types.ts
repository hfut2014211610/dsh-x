/** Public contracts for the Session-backed game host. @module @deepseek-ai/dsh-game/types */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

/** Opaque game instance identifier. */
export type GameId = Branded<'GameId'>
/** Opaque authenticated platform-principal identifier. */
export type PrincipalId = Branded<'PrincipalId'>
/** Opaque participant identifier inside one game. */
export type ParticipantId = Branded<'ParticipantId'>
/** Opaque caller-issued command identifier. */
export type GameRequestId = Branded<'GameRequestId'>

/**
 * Brand a game id without changing its serialized string value.
 * @param value - serialized game identity.
 * @returns branded game identity.
 */
export function GameId(value: string): GameId { return value as GameId }
/**
 * Brand a principal id without changing its serialized string value.
 * @param value - serialized principal identity.
 * @returns branded principal identity.
 */
export function PrincipalId(value: string): PrincipalId { return value as PrincipalId }
/**
 * Brand a participant id without changing its serialized string value.
 * @param value - serialized participant identity.
 * @returns branded participant identity.
 */
export function ParticipantId(value: string): ParticipantId { return value as ParticipantId }
/**
 * Brand a game request id without changing its serialized string value.
 * @param value - serialized caller-issued command identity.
 * @returns branded command identity.
 */
export function GameRequestId(value: string): GameRequestId { return value as GameRequestId }

/** Versioned game-module identity recorded in every command receipt. */
export interface GameModuleVersion {
  id: string
  version: number
}

/** Version-1 principal. Online identities are intentionally deferred. */
export interface LocalGamePrincipalV1 {
  version: 1
  kind: 'local'
  id: PrincipalId
}

/** Durable idempotency and participant-binding record. */
export interface GameCommandReceiptV1 {
  version: 1
  gameId: GameId
  module: GameModuleVersion
  method: GameMutationMethod
  requestId: GameRequestId
  payloadDigest: string
  gameRevision: number
  principalId: PrincipalId
  participantId: ParticipantId
}

/** Mutation methods whose receipts are durable. */
export type GameMutationMethod = 'start' | 'submitAction' | 'resume' | 'abortGame'

/** One module-authored log-only event candidate. */
export interface GameEventCandidate {
  type: string
  data: JsonValue
}

/** Authorized view returned to one principal. */
export interface GameProjection<TView = unknown> {
  gameId: GameId
  gameRevision: number
  module: GameModuleVersion
  view: TView
}

/** A prepared game whose validation completed before Host creation. */
export interface PreparedGameStart<TState> {
  gameId: GameId
  participantId: ParticipantId
  state: TState
  events: readonly GameEventCandidate[]
}

/** One deterministic module transition. */
export interface GameTransition<TState> {
  state: TState
  events: readonly GameEventCandidate[]
}

/** One automatic advancement step. */
export interface GameAdvance<TState> extends GameTransition<TState> {
  /** Stop after committing this step; an empty event list must also stop. */
  stop: boolean
}

/** Request fields shared by all mutating module methods. */
export interface GameMutationRequest<TPayload = JsonValue> {
  method: Exclude<GameMutationMethod, 'start'>
  participantId: ParticipantId
  payload: TPayload
  requestId: GameRequestId
  payloadDigest: string
}

/** Provider request with Host-owned parent and cancellation removed. */
export type GameChildStartRequest = Omit<SubagentStartRequest, 'parent' | 'signal'>

/** AI execution authority created for one serialized Host operation. */
export interface GameAiExecutor {
  /** The exact idle Host agent that parents every one-shot child. */
  readonly host: Agent
  /** Cancellation for the complete Host operation. */
  readonly signal: AbortSignal
  /** Start one child with the Host parent and operation cancellation. */
  start(provider: string, request: GameChildStartRequest): Promise<SubagentRun>
  /** Run independent items with a bounded worker pool while preserving result order. */
  map<T, R>(items: readonly T[], maxConcurrency: number, worker: (item: T) => Promise<R>): Promise<R[]>
}

/**
 * A domain adapter consumed by `ctx.games`. It owns rules, folding,
 * authorization-aware projection, mutation semantics, AI policy, and replay;
 * the common Host owns identity, Session lifetime, serialization, receipts,
 * cancellation, concurrency, and publication.
 */
export interface GameModule<
  TState = unknown,
  TStart = JsonValue,
  TMutation = JsonValue,
  TView = unknown,
  TReplay = unknown,
> {
  readonly id: string
  readonly version: number
  /** Validate all start dependencies without creating a Host or appending. */
  prepareStart(
    input: TStart,
    principal: LocalGamePrincipalV1,
    requestId: GameRequestId,
    payloadDigest: string,
  ): Promise<PreparedGameStart<TState>>
  /** Restore module state from one Host's complete event log. */
  restore(events: readonly SessionEvent[]): TState | undefined
  /** Read the state identity. */
  gameId(state: TState): GameId
  /** Read the monotonic domain revision. */
  revision(state: TState): number
  /** Read whether automatic scheduling may continue. */
  status(state: TState): 'running' | 'paused' | 'ended'
  /** Apply one human mutation without appending it. */
  mutate(state: TState, request: GameMutationRequest<TMutation>): Promise<GameTransition<TState>>
  /** Advance bots and phase resolution by one atomic publication unit. */
  advance(state: TState, history: readonly SessionEvent[], executor: GameAiExecutor): Promise<GameAdvance<TState>>
  /** Build the only view one bound participant may receive. */
  project(state: TState, participantId: ParticipantId): TView
  /** Build a replay only when the module's authorization rules permit it. */
  replay(state: TState, history: readonly SessionEvent[], participantId: ParticipantId): TReplay
  /** Optional Host route; omission uses deployment defaults and never drives it. */
  hostAgentOptions?: AgentOptions
}
