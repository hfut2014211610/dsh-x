/** Abstract game-host Service Definition. @module @deepseek-ai/dsh-game/service */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { GameId, GameModule, GameProjection, GameRequestId, LocalGamePrincipalV1, PrincipalId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    games: GameService
  }

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

/** Shared game Host contract implemented by the default Session provider. */
export abstract class GameService extends Service {
  constructor(ctx: Context) {
    if (new.target === GameService) {
      throw new Error('@deepseek-ai/dsh-game GameService is abstract; load its default SessionGameService export')
    }
    super(ctx, 'games')
  }

  /**
   * Register one exact module version as a caller-owned effect.
   * @param module - domain adapter to register.
   * @returns disposer that removes this exact registration.
   */
  abstract registerModule(module: GameModule): () => void
  /**
   * Resolve the version-1 loopback principal.
   * @returns authenticated local principal.
   */
  abstract resolvePrincipal(): LocalGamePrincipalV1
  /**
   * Create a dedicated Host, commit start atomically, and auto-advance.
   * @param request - module, idempotency key, initial revision, and module input.
   * @returns current authorized projection after automatic advancement.
   */
  abstract start<TView>(request: {
    moduleId: string
    requestId: GameRequestId
    expectedGameRevision: 0
    input: JsonValue
  }): Promise<GameProjection<TView>>
  /**
   * Return the current authorized view.
   * @param gameId - game to read.
   * @param principalId - authenticated caller.
   * @returns current authorized projection.
   */
  abstract getView<TView>(gameId: GameId, principalId: PrincipalId): Promise<GameProjection<TView>>
  /**
   * Return the authorized module replay.
   * @param gameId - game to replay.
   * @param principalId - authenticated caller.
   * @returns module-defined authorized replay.
   */
  abstract getReplay<TReplay>(gameId: GameId, principalId: PrincipalId): Promise<TReplay>
  /**
   * Commit one human action and auto-advance.
   * @param request - authorized compare-and-set action.
   * @returns current authorized projection after automatic advancement.
   */
  abstract submitAction<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
    action: JsonValue
  }): Promise<GameProjection<TView>>
  /**
   * Resume one paused game and auto-advance.
   * @param request - authorized compare-and-set resume request.
   * @returns current authorized projection after automatic advancement.
   */
  abstract resume<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
  }): Promise<GameProjection<TView>>
  /**
   * Record an aborted terminal result.
   * @param request - authorized compare-and-set abort request.
   * @returns terminal authorized projection.
   */
  abstract abortGame<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
  }): Promise<GameProjection<TView>>
  /**
   * Resolve one game to its dedicated live Host Session.
   * @param gameId - game to inspect.
   * @returns indexed Host Session, when known to this process.
   */
  abstract getHostSession(gameId: GameId): Session | undefined
}
