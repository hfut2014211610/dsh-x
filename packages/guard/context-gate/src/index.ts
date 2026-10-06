/**
 * anchored-context-gate — unified injection control for the anchored-standard
 * preset.
 *
 * While a session is unpromoted, this plugin keeps its first model request of
 * each compaction epoch free of auto-injected context, whatever the source, by
 * intercepting the harness's two unified injection paths — not a per-source
 * denylist — so it covers sources that do not exist yet:
 *
 *  a. RUNTIME CONTEXT (system-prompt/assemble): while the session is
 *     unpromoted, the assembly's `contexts` are blanked. That covers the
 *     WHOLE `SystemPrompt.context()` family — the sandbox and approval policy
 *     snapshots and any third-party context provider — without enumerating
 *     them. The loop's own snapshot projection then emits no message during
 *     the gate (no snapshot ever existed), and at the first promoted request
 *     it emits exactly ONE fresh snapshot: "minimal first round, inject on the
 *     second round" falls out of the projection's diffing, with no
 *     reinjection logic here.
 *
 *  b. STEP MESSAGES (agent/pre-step): the waterfall payload carries the
 *     CLAIMED message batch (the inbox messages this step owns). While
 *     unpromoted, the gate keeps exactly the claimed messages plus a small
 *     kind allowlist, and strips everything any listener appended — skill
 *     catalog, AGENTS.md digest, time/tmux context, hooks, unknown
 *     third-party plugins — by DEFAULT, regardless of source identity. The
 *     default allowlist is `['skill-invocation']`: a user-initiated skill
 *     gesture is not an automatic injection, and stripping it would lose the
 *     skill content once the gesture scrolls out of the per-step claim.
 *     Durable history (compaction summaries included) never passes through
 *     this gate: it enters the request via the session surface, not the
 *     pre-step waterfall.
 *
 * The phase is the shared compaction-epoch promotion state: a durable
 * `tool/call` and/or `assistant/message` (per `promoteOn`, default `either`)
 * promotes, and a `compaction/end` boundary demotes again — the first
 * post-compaction request is a "second first request" and is gated the same
 * way. Keep `includeSubagents` in sync with the companion tool-bootstrap row.
 *
 * ROW ORDER: mount this row FIRST in the composition. Waterfall after-next
 * transforms apply in reverse registration order, so registering first (plus
 * the pre-step listener's `prepend: true`) makes the gate the outermost
 * transform — nothing registered later re-injects past it.
 *
 * Both filters degrade to "keep everything" on their own failures: a gate bug
 * must never eat the user's context. Invalid configuration fails when the row
 * mounts, where it is visible.
 *
 * @module @deepseek-ai/dsh-context-gate
 */

import z from '@deepseek-ai/schemastery'
import type { Context, LoggerService } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { promotionStatus, registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'
import type { PromoteOn } from '@deepseek-ai/dsh-compaction-epoch'
import type {} from '@deepseek-ai/dsh-agent'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-context-gate'

/**
 * Deliberately NO inject list: the listeners only touch services at event
 * time, and applying without an inject lets this row register before the
 * context-injecting plugins (`dsh-agent-instructions`, `dsh-tool-skill`, host
 * plane policy projections) when it sits first in the composition.
 */
export const inject: string[] = []

/**
 * Message kinds allowed through the pre-step gate beyond the claimed batch.
 * A user-initiated skill gesture is the only default entry: it is not an
 * automatic injection.
 */
const DEFAULT_ALLOW_KINDS = ['skill-invocation']

/** Every config key this plugin accepts — anything else is a typo. */
export interface Config {
  /** Which durable signal promotes this session out of its bootstrap phase. */
  promoteOn?: PromoteOn
  /** Whether subagents follow the same gate instead of starting fully injected. */
  includeSubagents?: boolean
  /** Whether both interception paths run. */
  enabled?: boolean
  /**
   * Message `source.kind` names allowed beyond the claimed batch. An
   * explicitly empty array keeps ONLY the claimed batch, stripping even user
   * skill gestures.
   */
  allowKinds?: string[]
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  promoteOn: z.union(['tool-call', 'assistant-message', 'either']).default('either'),
  includeSubagents: z.boolean().default(false),
  enabled: z.boolean().default(true),
  allowKinds: z.array(z.string().min(1)).default([...DEFAULT_ALLOW_KINDS]),
})

/**
 * Build a logger that reports `message` at most once.
 *
 * A warning is a diagnostic, not a gate decision, so the gate's own
 * "degrade to keep everything" behavior must survive a logger that rejects the
 * call.
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

/** The admitted branch of {@link PreStepDecision}, whose messages this gate filters. */
type EnteredStep = Extract<PreStepDecision, { kind: 'enter' }>

/**
 * Keep only the claimed batch and the allowed message kinds.
 *
 * Identity is by object or by id, because a listener may replace the claimed
 * message with a copy carrying the same id.
 *
 * @param decision - the entered step decision.
 * @param claimed - the message batch this step claimed from the inbox.
 * @param allowKinds - message `source.kind` names allowed beyond the batch.
 * @returns the decision with appended messages stripped, or unchanged input.
 */
function filterStepMessages(
  decision: EnteredStep,
  claimed: readonly UserMessage[],
  allowKinds: ReadonlySet<string>,
): EnteredStep {
  const baseline = new Set(claimed)
  const baselineIds = new Set(claimed.map(message => message.id))
  const { messages } = decision
  const kept = messages.filter(message =>
    baseline.has(message) || baselineIds.has(message.id) || allowKinds.has(message.source.kind))
  return kept.length === messages.length ? decision : { ...decision, messages: kept }
}

/**
 * Read the session projection registry, failing loudly when the composition
 * omits it: this plugin cannot gate anything without it.
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

/**
 * Reject a config key this plugin does not accept.
 *
 * Schemastery passes unknown keys through, so a typo in a preset's row would
 * otherwise silently disable the setting it meant to set.
 *
 * @param config - the raw plugin config.
 * @throws when the config carries a key outside {@link Config}.
 */
function rejectUnknownKeys(config: Config): void {
  const allowed = new Set(['promoteOn', 'includeSubagents', 'enabled', 'allowKinds'])
  const unknown = Object.keys(config).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...allowed].sort().join(', ')}`,
    )
  }
}

/** Register the unified context gate. */
export function apply(ctx: Context, config: Config = {}): void {
  rejectUnknownKeys(config)
  const { promoteOn, includeSubagents, enabled, allowKinds } = Config(config)
  const registry = requireProjections(ctx)
  ctx.effect(() => registerPromotionEpoch(registry))
  const allow = new Set(allowKinds ?? DEFAULT_ALLOW_KINDS)
  const mode = promoteOn ?? 'either'
  const gateSubagents = includeSubagents ?? false
  const warnOnce = createWarnOnce(ctx.logger)

  // Path (a): blank the dynamic runtime-context contributions while the
  // session is unpromoted. Covers the whole SystemPrompt.context() family
  // without enumerating it; the loop's snapshot projection then stays silent
  // and diffs exactly ONE fresh snapshot in at the first promoted request.
  ctx.on('system-prompt/assemble', async (
    _assembly: PromptAssembly,
    context: AssembleContext,
    next: () => Promise<PromptAssembly>,
  ): Promise<PromptAssembly> => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    if (!enabled) return assembled
    try {
      if (promotionStatus(registry, context.agent, mode, gateSubagents).promoted) return assembled
      if (assembled.contexts.length === 0) return assembled
      return { ...assembled, contexts: [] }
    } catch (error: unknown) {
      warnOnce(`${name}: runtime-context suppression failed, keeping contexts: ${error instanceof Error ? error.message : String(error)}`)
      return assembled
    }
  })

  // Path (b): claimed-baseline deny on the pre-step waterfall. The payload's
  // `messages` is the batch this step CLAIMED from the inbox — the baseline
  // every injection appends to. Keep that baseline plus the kind allowlist,
  // strip every appended message regardless of its source identity.
  ctx.on('agent/pre-step', async (
    { agent, messages: claimed },
    next,
  ): Promise<PreStepDecision> => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const decision = await next()
    if (decision.kind === 'reject' || !enabled) return decision
    try {
      if (promotionStatus(registry, agent, mode, gateSubagents).promoted) return decision
      return filterStepMessages(decision, claimed, allow)
    } catch (error: unknown) {
      warnOnce(`${name}: pre-step gate failed, keeping injected context: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
  }, { prepend: true })
}
