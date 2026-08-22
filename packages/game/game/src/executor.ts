/** Host-side execution contracts that name Agent and subagent types. @module @deepseek-ai/dsh-game/executor */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { JsonValue, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
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

/** One game-owned Bot agent created once and retained for the whole game. */
export interface GameBotProvisionRequest {
  /** Stable per-game identity reused for every decision by this Bot. */
  readonly childId: SessionId
  /** Human-readable seat label used in diagnostics. */
  readonly label: string
  /** Per-Bot model route; omission inherits the Host route. */
  readonly agentOptions?: AgentOptions
  /** Absolute delegation-depth cap for the Bot agent. */
  readonly maxDepth?: number
  /** Fixed per-game persona containing this seat's immutable identity. */
  readonly persona: string
  /** Fixed tool restriction; Werewolf Bots use an empty allowlist. */
  readonly toolFilter?: SubagentStartRequest['toolFilter']
}

/** Result of one turn in an already-provisioned game Bot session. */
export interface GameBotTurnResult {
  /** Stable Bot session identity. */
  readonly childId: SessionId
  /** The last non-empty assistant output from this turn. */
  readonly output: SubagentResult['output']
  /** Terminal reason mapped from the Bot agent's durable turn end. */
  readonly stopReason: SubagentResult['stopReason']
  /** Whether the Host cancelled this turn after its wall-clock budget elapsed. */
  readonly timedOut: boolean
}

/** AI execution authority created for one serialized Host operation. */
export interface GameAiExecutor {
  /** The exact idle Host agent that parents every game-owned child. */
  readonly host: Agent
  /** Cancellation for the complete Host operation. */
  readonly signal: AbortSignal
  /** Start one child with the Host parent and operation cancellation. */
  start(provider: string, request: GameChildStartRequest): Promise<SubagentRun>
  /** Create one hidden game Bot once; repeated calls for the same id are no-ops. */
  provisionBot(request: GameBotProvisionRequest): Promise<void>
  /** Run one FIFO decision turn in an already-provisioned Bot session. */
  turnBot(childId: SessionId, prompt: SubagentStartRequest['prompt'], timeoutMs: number): Promise<GameBotTurnResult>
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
  /** Optional Agent preset recorded on the dedicated Host Session. */
  hostAgentPreset?: string
}
