/**
 * `ctx.werewolf`: the concrete Cordis service owning the game's four trusted
 * registries. Registrations are effects on the calling fiber; disposing the
 * fiber (or the returned disposer) removes exactly that registration. This
 * stage owns no model or UI path — bots, projections, and the game view
 * arrive with later delivery stages.
 * @module @deepseek-ai/dsh-werewolf
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { resolveWerewolfRuleSet } from './rules.ts'
import { WerewolfRegistry } from './registry.ts'
import type {
  WerewolfCompiledRuleSetV1,
  WerewolfPhaseDefinition,
  WerewolfRoleDefinition,
  WerewolfRuleSetInputV1,
  WerewolfVictoryConditionDefinition,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    werewolf: WerewolfRuntime
  }
}

/**
 * The Werewolf extension surface: registration of rule sets, roles, phases,
 * and victory conditions, plus rule-set compilation against the current
 * registry state.
 */
export class WerewolfRuntime extends Service {
  private readonly registry = new WerewolfRegistry()

  constructor(ctx: Context) {
    super(ctx, 'werewolf')
  }

  /**
   * Register one role version on the calling fiber.
   *
   * @param definition - the role definition to register.
   * @returns a disposer removing exactly this registration.
   */
  registerRole(definition: WerewolfRoleDefinition): () => void {
    const dispose = this.ctx.effect(() => this.registry.registerRole(definition), 'werewolf.registerRole()')
    return () => void dispose()
  }

  /**
   * Register one phase version on the calling fiber.
   *
   * @param definition - the phase definition to register.
   * @returns a disposer removing exactly this registration.
   */
  registerPhase(definition: WerewolfPhaseDefinition): () => void {
    const dispose = this.ctx.effect(() => this.registry.registerPhase(definition), 'werewolf.registerPhase()')
    return () => void dispose()
  }

  /**
   * Register one victory-condition version on the calling fiber.
   *
   * @param definition - the victory-condition definition to register.
   * @returns a disposer removing exactly this registration.
   */
  registerVictoryCondition(definition: WerewolfVictoryConditionDefinition): () => void {
    const dispose = this.ctx.effect(
      () => this.registry.registerVictoryCondition(definition),
      'werewolf.registerVictoryCondition()',
    )
    return () => void dispose()
  }

  /**
   * Register one immutable `{ id, revision }` rule-set pair on the calling
   * fiber.
   *
   * @param input - the parsed rule-set input to register.
   * @returns a disposer removing exactly this registration.
   */
  registerRuleSet(input: WerewolfRuleSetInputV1): () => void {
    const dispose = this.ctx.effect(() => this.registry.registerRuleSet(input), 'werewolf.registerRuleSet()')
    return () => void dispose()
  }

  /**
   * Compile one rule set against the current registries.
   *
   * @param input - the raw or parsed rule-set input.
   * @returns the immutable compiled rule set with its digest.
   */
  resolveRuleSet(input: JsonValue): WerewolfCompiledRuleSetV1 {
    return resolveWerewolfRuleSet(input, this.registry)
  }

  /**
   * Every registered rule-set input, keyed `${id}@${revision}`.
   *
   * @returns the registered rule-set inputs.
   */
  listRuleSets(): ReadonlyMap<string, WerewolfRuleSetInputV1> {
    return this.registry.listRuleSets()
  }
}

export default WerewolfRuntime
