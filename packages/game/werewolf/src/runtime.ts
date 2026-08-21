/**
 * `ctx.werewolf`: the concrete Cordis service owning the game's four trusted
 * registries plus the deployment-resolved bot runner settings. Registrations
 * are effects on the calling fiber; disposing the fiber (or the returned
 * disposer) removes exactly that registration. Session projections, the
 * Typert remote, and the game view arrive with later delivery stages.
 * @module @deepseek-ai/dsh-werewolf
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { resolveWerewolfRuleSet } from './rules.ts'
import { WerewolfRegistry } from './registry.ts'
import type { WerewolfBotRunnerConfigV1 } from './bot-runner.ts'
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

/** Deployment-varying bot runner input; `botRunnerConfig()` resolves defaults. */
export interface WerewolfRuntimeConfig {
  /** Registered subagent provider name the bot children start on. */
  subagentProvider: string
  /** Per-child model route; omission inherits the parent agent's route. */
  botAgent?: AgentOptions
  /** Failed attempts per decision before the fallback applies. */
  botRetryLimit?: number
  /** Wall-clock budget per child attempt. */
  botDecisionTimeoutMs?: number
  /** Fallback after retry exhaustion. */
  botFailurePolicy?: 'auto-action' | 'pause-game'
  /** Bots launched concurrently in one parallel phase. */
  maxConcurrentBots?: number
  /** Context bounds the envelope's delta must satisfy. */
  contextLimits?: {
    memorySummaryChars: number
    beliefBasisChars: number
    commitmentChars: number
    strategyChars: number
    maxCommitments: number
  }
  /** Trailing public timeline entries one bot prompt carries. */
  publicTimelineEntries?: number
}

/**
 * The Werewolf extension surface: registration of rule sets, roles, phases,
 * and victory conditions, plus rule-set compilation against the current
 * registry state.
 */
export class WerewolfRuntime extends Service {
  /** Validated deployment input; `botRunnerConfig()` applies the reviewed defaults. */
  static Config: z<WerewolfRuntimeConfig> = z.object({
    subagentProvider: z.string(),
    botAgent: z.object({
      provider: z.string(),
      model: z.string(),
      maxTokens: z.number().step(1).min(1),
    }),
    botRetryLimit: z.number().step(1).min(0),
    botDecisionTimeoutMs: z.number().step(1).min(1),
    botFailurePolicy: z.union([z.const('auto-action'), z.const('pause-game')]),
    maxConcurrentBots: z.number().step(1).min(1),
    contextLimits: z.object({
      memorySummaryChars: z.number().step(1).min(1),
      beliefBasisChars: z.number().step(1).min(1),
      commitmentChars: z.number().step(1).min(1),
      strategyChars: z.number().step(1).min(1),
      maxCommitments: z.number().step(1).min(1),
    }),
    publicTimelineEntries: z.number().step(1).min(1),
  })

  private readonly registry = new WerewolfRegistry()
  private readonly config: WerewolfRuntimeConfig

  constructor(ctx: Context, config: WerewolfRuntimeConfig) {
    super(ctx, 'werewolf')
    this.config = config
  }

  /**
   * The resolved bot runner settings the stage-2 runner consumes.
   *
   * @returns the deployment-resolved runner configuration.
   */
  botRunnerConfig(): WerewolfBotRunnerConfigV1 {
    const config = this.config
    const botAgent = config.botAgent !== undefined && Object.keys(config.botAgent).length > 0
      ? config.botAgent
      : undefined
    const provided = config.contextLimits
    const limits = provided !== undefined && Object.keys(provided).length > 0
      ? provided
      : {
        memorySummaryChars: 200,
        beliefBasisChars: 120,
        commitmentChars: 120,
        strategyChars: 160,
        maxCommitments: 8,
      }
    return {
      provider: config.subagentProvider,
      ...(botAgent === undefined ? {} : { botAgent }),
      retryLimit: config.botRetryLimit ?? 2,
      decisionTimeoutMs: config.botDecisionTimeoutMs ?? 60000,
      failurePolicy: config.botFailurePolicy ?? 'auto-action',
      limits,
      publicTimelineEntries: config.publicTimelineEntries ?? 24,
    }
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
