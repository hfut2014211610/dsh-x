/** Public contracts for the Session-backed game host. @module @deepseek-ai/dsh-game/types */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Announce that authorized readers must re-read one game projection.
     * The event deliberately carries no identity or hidden view data.
     * @param gameId - changed game.
     * @param gameRevision - committed domain revision.
     * @mode emit
     */
    'game/projection-invalidated'(gameId: GameId, gameRevision: number): void
  }
}

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
