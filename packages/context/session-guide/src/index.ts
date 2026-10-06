/**
 * session-guide — one short near-field guidance line after each real user
 * message, once the session is promoted.
 *
 * DISABLED BY DEFAULT. The composition mounts this row with `disabled: true`;
 * read the whole header before turning it on, because the evidence behind the
 * default text is weaker than the evidence behind the rest of this preset.
 *
 * WHY IT EXISTS. Everything else in this preset controls the FIRST request and
 * then stops. Over a long session the anchored conditions stay in the prefix but
 * their share of the context shrinks, and nothing re-states the working posture.
 * The community preset `yjh051108/dsh-router-standard` (MIT) calls the
 * countermeasure "近距离引导" — a fixed line appended right after each user
 * message — and reports a large single-task completion effect from three anchors
 * in it: recall what is already done, converge when the information is complete,
 * and do not spend reasoning on environment checks.
 *
 * WHY IT IS OFF. Three reasons, in order of weight:
 *
 *  1. The mechanism is unverified HERE. Nothing in this fork has measured
 *     dilution, let alone this remedy for it. `personal/probe/` exists to
 *     establish that baseline first; turning this on before it is measured
 *     replaces one unproven assumption with two.
 *  2. Upstream's own data says the effect INVERTS by model: the recall and
 *     convergence anchors lift Flash, and their P24 run has the same anchors
 *     scoring the Pro suite BELOW the naked configuration. A default-on row
 *     would silently apply the harmful arm to half the routes.
 *  3. The published implementation of the idea does not run. In
 *     `dsh-router-standard` v0.3.0, `preset/router-standard/router-bootstrap.mjs`
 *     calls `bandOf` and `extractText` in its `session/event` handler while
 *     importing neither, so the handler throws before injecting anything. The
 *     mechanism below is written from the description, not ported from that
 *     code, and its numbers were never observed by anyone.
 *
 * SO: measure with `personal/probe/compare-presets.ts`, turn this on, measure
 * again. The text is a starting point, not a result.
 *
 * HOW IT WORKS. The guidance enters through the `agent/pre-step` waterfall and
 * is spliced immediately after the step's CLAIMED message batch — the same
 * position and the same reasoning as `dsh-agent-instructions`: the user's own
 * prompt precedes it, driver-appended runtime context follows it. That position
 * also keeps the prefix cache intact, which is the whole reason this is a
 * suffix and not a system-prompt edit: a pre-step message is durable, so turn N's
 * guidance is still in history at turn N+1 and the shared prefix only grows.
 *
 * IDEMPOTENCE is derived from durable events, like every other phase decision in
 * this preset: the guidance records which user message it follows, so a resume,
 * a reload, or a re-claimed batch finds the same guidance already present.
 *
 * PHASE. Nothing is injected before promotion — the anchored first request must
 * stay byte-close to a Minimal session — and a `compaction/end` boundary demotes
 * the session, so the first post-compaction request is clean too. This is belt
 * and braces: the context gate would strip the guidance while unpromoted anyway.
 *
 * @module @deepseek-ai/dsh-session-guide
 */

import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Context, LoggerService } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import { promotionStatus, registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'
import type { PromoteOn } from '@deepseek-ai/dsh-compaction-epoch'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import type {} from '@deepseek-ai/dsh-agent'

/** Cordis plugin name used by loader diagnostics and as the guidance's source kind. */
export const name = 'session-guide'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * The near-field guidance line. Its `forMessage` field names the user
     * message it follows, which is how the plugin recognizes a turn that is
     * already guided.
     * @persistenceAttribution
     */
    'session-guide': { kind: 'session-guide'; readonly forMessage: MessageId }
  }
}

/**
 * The three anchors, in the order upstream states them: recall, then
 * anti-runaway, then convergence. Deliberately short — this text repeats once
 * per user turn, so its cost is paid every turn for the whole session.
 */
const DEFAULT_TEXT = 'Before acting, review what you have already done in this session and continue from there; do not repeat completed steps. Do not spend reasoning on environment or tooling checks. Produce when your information is complete.'

/** Default character count above which a user message counts as complex. */
const DEFAULT_COMPLEX_LENGTH = 120

const guidedStateSchema = zod.object({ guided: zod.array(zod.string()) })

/** Which user-message ids this session has already been guided after. */
export interface GuidedState {
  /** Durable ids of the user messages whose turn carried guidance. */
  guided: string[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** User-message ids this session already received guidance after. */
    sessionGuided: GuidedState
  }
}

/**
 * Read the guided user-message id from one logged guidance source.
 *
 * @param source - the logged `user/message` source.
 * @returns the guided id, or `undefined` when this is not guidance.
 */
function guidedFor(source: UserMessage['source']): string | undefined {
  if (source.kind !== name) return undefined
  const { forMessage } = source
  return typeof forMessage === 'string' ? forMessage : undefined
}

/**
 * Fold one durable event into the guided set.
 *
 * @param state - the set as of the previous event.
 * @param event - the committed durable event.
 * @returns the set as of `event`.
 */
function foldGuided(state: GuidedState, event: SessionEvent): GuidedState {
  if (event.type !== 'user/message') return state
  const guided = guidedFor(event.data.source)
  if (guided === undefined || state.guided.includes(guided)) return state
  return { guided: [...state.guided, guided] }
}

/**
 * Register the guided-message projection on `registry`.
 *
 * @param registry - the session projection registry the unit folds into.
 * @returns the exact disposer that unregisters the unit.
 */
export function registerGuided(registry: SessionProjectionRegistry): () => void {
  return registry.register({
    key: 'sessionGuided',
    stateVersion: 1,
    stateSchema: guidedStateSchema,
    init: () => ({ guided: [] }),
    apply: foldGuided,
  })
}

/** The plain text of a message's content blocks. */
function messageText(message: UserMessage): string {
  return message.content
    .map(block => ('text' in block ? block.text : ''))
    .join('\n')
}

/**
 * Depth dispatch, consulted only when `complexText` is configured.
 *
 * The heuristic is crude on purpose — length plus an optional caller-supplied
 * keyword pattern. Upstream ships a bilingual keyword list tuned on its own
 * routes; baking that list in here would import their tuning as if it were a
 * finding, so the pattern is left to the operator.
 *
 * @param body - the user message's plain text.
 * @param threshold - character count above which the message is complex.
 * @param pattern - optional keyword pattern marking a message complex.
 * @returns whether this message should receive the complex text.
 */
function isComplex(body: string, threshold: number, pattern: RegExp | undefined): boolean {
  if (body.length > threshold) return true
  return pattern !== undefined && pattern.test(body)
}

/** Near-field guidance configuration. Invalid values fail plugin load. */
export interface Config {
  /** The guidance line. Defaults to the three-anchor text. */
  text?: string
  /** Second line used when the user message looks complex. One line when absent. */
  complexText?: string
  /** Regex source marking a message complex. Compiled at mount. */
  complexPattern?: string
  /** Character count above which a message is complex. Consulted only with `complexText`. */
  complexLengthThreshold?: number
  /** Which durable signal promotes this session before its guidance is injected. */
  promoteOn?: PromoteOn
  /** Whether subagents follow the same phase. */
  includeSubagents?: boolean
  /** Whether the guidance is injected. `false` keeps the row mounted and inert. */
  enabled?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  text: z.string(),
  complexText: z.string(),
  complexPattern: z.string(),
  complexLengthThreshold: z.number(),
  promoteOn: z.union(['tool-call', 'assistant-message', 'either']).default('either'),
  includeSubagents: z.boolean().default(false),
  enabled: z.boolean().default(true),
})

/**
 * Reject a config this plugin cannot act on, and compile the complexity pattern.
 *
 * Schemastery passes unknown keys through and cannot express "non-empty string",
 * so a preset typo or an empty override would otherwise go unnoticed.
 *
 * @param config - the raw plugin config.
 * @returns the validated settings this plugin runs with.
 * @throws when a key is unknown, a string is empty, or the pattern does not compile.
 */
function resolveSettings(config: Config): {
  text: string
  complexText: string | undefined
  complexPattern: RegExp | undefined
  complexLengthThreshold: number
  promoteOn: PromoteOn
  includeSubagents: boolean
  enabled: boolean
} {
  const allowed = [
    'text',
    'complexText',
    'complexPattern',
    'complexLengthThreshold',
    'promoteOn',
    'includeSubagents',
    'enabled',
  ]
  const unknown = Object.keys(config).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...allowed].sort().join(', ')}`,
    )
  }
  for (const field of ['text', 'complexText'] as const) {
    const value = config[field]
    if (value !== undefined && value.trim().length === 0) {
      throw new TypeError(`${name}: ${field} must be a non-empty string`)
    }
  }
  const { complexPattern } = config
  let compiled: RegExp | undefined
  if (complexPattern !== undefined) {
    if (complexPattern.length === 0) {
      throw new TypeError(`${name}: complexPattern must be a non-empty regex source string`)
    }
    try {
      compiled = new RegExp(complexPattern, 'i')
    } catch (error: unknown) {
      throw new TypeError(`${name}: complexPattern is not a valid regex: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const { complexLengthThreshold } = config
  if (complexLengthThreshold !== undefined
    && (!Number.isInteger(complexLengthThreshold) || complexLengthThreshold <= 0)) {
    throw new TypeError(`${name}: complexLengthThreshold must be a positive integer`)
  }
  return {
    text: config.text ?? DEFAULT_TEXT,
    complexText: config.complexText,
    complexPattern: compiled,
    complexLengthThreshold: complexLengthThreshold ?? DEFAULT_COMPLEX_LENGTH,
    promoteOn: config.promoteOn ?? 'either',
    includeSubagents: config.includeSubagents ?? false,
    enabled: config.enabled ?? true,
  }
}

/**
 * Build a logger that reports `message` at most once, so a failing step cannot
 * spam a session's transcript.
 *
 * @param logger - the plugin's logger.
 * @returns a reporter that emits at most one warning.
 */
function createWarnOnce(logger: LoggerService): (message: string) => void {
  let warned = false
  return (message) => {
    if (warned) return
    warned = true
    try {
      logger.warn(message)
    } catch (error: unknown) {
      // The logger rejected the diagnostic. Nothing else can be done about it
      // without turning a warning into a failed request.
      void error
    }
  }
}

/**
 * Read the session projection registry, failing loudly when the composition
 * omits it: this plugin cannot decide a phase without it.
 *
 * @param ctx - the plugin context.
 * @returns the registry.
 * @throws when no registry is mounted.
 */
function requireProjections(ctx: Context): SessionProjectionRegistry {
  const registry = ctx.get('sessionProjections')
  if (registry === undefined) {
    throw new Error(`${name}: the session projection registry is required`)
  }
  return registry
}

/** Register the near-field guidance injector. */
export function apply(ctx: Context, config: Config = {}): void {
  const {
    text,
    complexText,
    complexPattern,
    complexLengthThreshold,
    promoteOn,
    includeSubagents,
    enabled,
  } = resolveSettings(config)
  const registry = requireProjections(ctx)
  ctx.effect(() => registerPromotionEpoch(registry))
  ctx.effect(() => registerGuided(registry))
  const warnOnce = createWarnOnce(ctx.logger)
  /**
   * Guidance emitted by this process but not yet folded into the projection.
   * The loop appends each guidance message during the step, so the delta stays
   * small; it covers the gap before the `session/event` fold reaches the unit.
   */
  const pending = new Map<string, Set<string>>()

  ctx.on('agent/pre-step', async (
    { agent, messages: claimed }: { agent: Agent; messages: UserMessage[] },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    // Downstream errors propagate untouched; only this plugin's logic is guarded.
    const decision = await next()
    if (decision.kind === 'reject' || !enabled) return decision
    try {
      const { session } = agent
      if (!promotionStatus(registry, agent, promoteOn, includeSubagents).promoted) return decision

      // One guidance per REAL user turn. A step that claims no user message is a
      // tool continuation: the guidance for that turn is already in history, and
      // repeating it per step would both cost tokens and read as nagging.
      const userMessage = claimed.find(message => message.source.kind === 'user')
      if (userMessage === undefined) return decision
      const userId = userMessage.id
      const already = new Set([
        ...registry.stateOf(session, 'sessionGuided')?.guided ?? [],
        ...pending.get(session.id) ?? [],
      ])
      if (already.has(userId)) return decision

      const body = complexText !== undefined
        && isComplex(messageText(userMessage), complexLengthThreshold, complexPattern)
        ? complexText
        : text
      const guide = createUserMessage({
        content: [{ type: 'text', text: body }],
        source: { kind: name, forMessage: userId },
      })

      // Fold in right after the claimed batch: the user's own prompt precedes
      // the guidance, driver-appended runtime context follows it. Same placement
      // rule as `dsh-agent-instructions`.
      const at = decision.messages.findLastIndex(message => claimed.includes(message)) + 1
      const messages = decision.messages.toSpliced(at, 0, guide)
      const delta = pending.get(session.id) ?? new Set<string>()
      delta.add(userId)
      pending.set(session.id, delta)
      return { ...decision, messages }
    } catch (error: unknown) {
      // A guidance bug must never break a step: emit nothing this turn.
      warnOnce(`${name}: guidance injection failed, skipping: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
  }, { prepend: true })
}
