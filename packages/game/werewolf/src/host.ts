/** Typed Host API for the Session-backed Werewolf game. */

import type { Context } from '@deepseek-ai/cordis'
import { GameId, GameRequestId } from '@deepseek-ai/dsh-game'
import type { GameProjection } from '@deepseek-ai/dsh-game'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WerewolfHostMutationRequestV1,
  WerewolfHumanViewV1,
  WerewolfReplayV1,
  WerewolfStartRequestV1,
  WerewolfSubmitActionRequestV1,
} from './host-types.ts'
import { WerewolfGameModule } from './module-adapter.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    werewolfGame: WerewolfGameGateway
  }
}

/** Registers the Werewolf module and exposes the UI-facing typed methods. */
export class WerewolfGameGateway extends TypertRemoteService {
  static inject = ['games', 'werewolf', 'subagents']

  constructor(ctx: Context) {
    super(ctx, 'werewolfGame')
    ctx.games.registerModule(new WerewolfGameModule(ctx, ctx.werewolf))
  }

  /**
   * Start one local single-player game.
   * @param request - rule selection, seed, and caller idempotency key.
   * @returns current human-authorized projection.
   */
  @Remote('start')
  async start(request: WerewolfStartRequestV1): Promise<GameProjection<WerewolfHumanViewV1>> {
    const { requestId, expectedGameRevision, ...input } = request
    return await this.ctx.games.start({
      moduleId: 'werewolf',
      requestId: GameRequestId(requestId),
      expectedGameRevision,
      input,
    })
  }

  /**
   * Read the current view for the locally authenticated principal.
   * @param request - game identity.
   * @returns current human-authorized projection.
   */
  @Remote('getView')
  async getView(request: { gameId: string }): Promise<GameProjection<WerewolfHumanViewV1>> {
    return await this.ctx.games.getView(GameId(request.gameId), this.ctx.games.resolvePrincipal().id)
  }

  /**
   * Read the terminal authorized replay.
   * @param request - game identity.
   * @returns replay containing authorized checkpoints.
   */
  @Remote('getReplay')
  async getReplay(request: { gameId: string }): Promise<WerewolfReplayV1> {
    return await this.ctx.games.getReplay(GameId(request.gameId), this.ctx.games.resolvePrincipal().id)
  }

  /**
   * Submit one action for the current human form.
   * @param request - phase-bound compare-and-set action.
   * @returns current human-authorized projection after automatic advancement.
   */
  @Remote('submitAction')
  async submitAction(request: WerewolfSubmitActionRequestV1): Promise<GameProjection<WerewolfHumanViewV1>> {
    return await this.ctx.games.submitAction({
      gameId: GameId(request.gameId),
      principalId: this.ctx.games.resolvePrincipal().id,
      requestId: GameRequestId(request.requestId),
      expectedGameRevision: request.expectedGameRevision,
      action: { phaseInstanceId: request.phaseInstanceId, action: request.action },
    })
  }

  /**
   * Resume one paused game.
   * @param request - compare-and-set resume request.
   * @returns current human-authorized projection after automatic advancement.
   */
  @Remote('resume')
  async resume(request: WerewolfHostMutationRequestV1): Promise<GameProjection<WerewolfHumanViewV1>> {
    return await this.ctx.games.resume({
      gameId: GameId(request.gameId),
      principalId: this.ctx.games.resolvePrincipal().id,
      requestId: GameRequestId(request.requestId),
      expectedGameRevision: request.expectedGameRevision,
    })
  }

  /**
   * Abort one running or paused game.
   * @param request - compare-and-set abort request.
   * @returns terminal human-authorized projection.
   */
  @Remote('abortGame')
  async abortGame(request: WerewolfHostMutationRequestV1): Promise<GameProjection<WerewolfHumanViewV1>> {
    return await this.ctx.games.abortGame({
      gameId: GameId(request.gameId),
      principalId: this.ctx.games.resolvePrincipal().id,
      requestId: GameRequestId(request.requestId),
      expectedGameRevision: request.expectedGameRevision,
    })
  }
}

export default WerewolfGameGateway
