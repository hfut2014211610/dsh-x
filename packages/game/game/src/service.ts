/** Abstract game-host Service Definition. @module @deepseek-ai/dsh-game/service */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { GameId, GameProjection, GameRequestId, LocalGamePrincipalV1, PrincipalId } from './types.ts'

import type { GameModule } from './executor.ts'

export type {
  GameModule,
  GameAiExecutor,
  GameBotProvisionRequest,
  GameBotTurnResult,
  GameChildStartRequest,
} from './executor.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    games: GameService
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
   * Create a dedicated Host, commit start atomically, initialize fixed Agents, and schedule automatic advancement.
   * @param request - module, idempotency key, initial revision, and module input.
   * @returns projection after foreground advancement, or after initialization when the module schedules in the background.
   */
  abstract start<TView>(request: {
    moduleId: string
    requestId: GameRequestId
    expectedGameRevision: 0
    input: JsonValue
  }): Promise<GameProjection<TView>>
  /**
   * List every game of one module authorized for the principal, newest first.
   * @param moduleId - exact registered module id.
   * @param principalId - authenticated caller.
   * @returns authorized projections ordered by Host creation time.
   */
  abstract listViews<TView>(moduleId: string, principalId: PrincipalId): Promise<GameProjection<TView>[]>
  /**
   * Return the current authorized view. Reading is a side-effectful kick for a
   * background-scheduling module: uninitialized fixed Agents plus a running
   * game schedule one automatic advancement.
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
   * Commit one human action and schedule automatic advancement.
   * @param request - authorized compare-and-set action.
   * @returns projection after foreground advancement, or after the action when the module schedules in the background.
   */
  abstract submitAction<TView>(request: {
    gameId: GameId
    principalId: PrincipalId
    requestId: GameRequestId
    expectedGameRevision: number
    action: JsonValue
  }): Promise<GameProjection<TView>>
  /**
   * Resume one paused game and schedule automatic advancement.
   * @param request - authorized compare-and-set resume request.
   * @returns projection after foreground advancement, or after resume when the module schedules in the background.
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
