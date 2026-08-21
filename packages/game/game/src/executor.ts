/** Host-side execution contracts that name Agent and subagent types. @module @deepseek-ai/dsh-game/executor */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  GameAdvance,
  GameId,
  GameMutationRequest,
  GameRequestId,
  GameTransition,
  LocalGamePrincipalV1,
  ParticipantId,
  PreparedGameStart,
} from './types.ts'

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
