/**
 * Anchored tool bootstrap — keep the FIRST model request of each compaction
 * epoch on the Minimal preset's REAL tool schema (persistent `bash` +
 * `str_replace_editor`), then narrow the catalog to a minimal RESIDENT set once
 * the session has produced its first durable promotion signal. Injected-context
 * control lives in the companion `@deepseek-ai/dsh-context-gate` plugin, not
 * here.
 *
 * First-request conditions established by upstream reproduction runs
 * (DeepSeek V4 Pro, 2026-08-15):
 *
 *  1. Tool schema. The API-visible first-request catalog decides whether the
 *     session anchors on the Minimal trajectory. At the adapter-default
 *     maxTokens (256000 on the official endpoint) the Minimal tool pair
 *     anchored 5/5 runs with zero `let me` first-lines, while every
 *     standard-family schema (pwsh/read, pwsh only, sandboxed bash/read) fell
 *     into standard-like behavior (11/11). Bootstrap therefore exposes exactly
 *     the Minimal pair, not Standard's `pwsh`/`read`.
 *
 *  2. Output budget. On the official endpoint the first request's `max_tokens`
 *     also dominated the trajectory anchor at 1024 (`We need` style in 26/32
 *     runs against 0/5 at 256000, independent of tool descriptions). The
 *     Minimal tool schema, however, anchors at 256000 WITHOUT any cap, and the
 *     cap's delivery depends on the profile package's `prepareCall` behavior.
 *     `bootstrapMaxTokens` is therefore OPT-IN: leave it unset to run the
 *     Minimal schema at the adapter default, or set it to cap the first
 *     request. When set, the cap is stripped after promotion — the next
 *     request's seed proposal carries the previous header's maxTokens forward,
 *     so the release must be explicit.
 *
 *  3. Injected context is NOT this plugin's concern: the companion
 *     `@deepseek-ai/dsh-context-gate` plugin owns the unified injection
 *     control, keyed to the same promotion phase.
 *
 * POST-PROMOTION RESIDENT SET: the promoted phase does NOT dump the whole
 * Standard catalog at once — that dump pulls the trajectory back to
 * standard-like behavior. Instead the catalog narrows to the bootstrap tool
 * pair PLUS the three discovery tools (`dev_tool_search`, `skill_search`,
 * `skill_load`) plus whatever the model explicitly unlocked via
 * `dev_tool_search`. Heavier Standard tools (web_search, subagent, workflow,
 * …) are one dev_tool_search call away; unlocked names are derived from
 * durable `tool/call` events, so resume and reload keep them.
 * read/write/edit/glob/grep/todo/ask are deliberately NOT resident: bash +
 * str_replace_editor cover file work.
 *
 * COMPACTION: a compaction rewrites the whole surface, so the first
 * post-compaction request is a "second first request". The session falls back
 * to the controlled phase — the bootstrap pair plus `compactionTools` — until
 * a new durable promotion signal exists past that boundary. The model is
 * mid-task and needs to keep working, but still faces a small catalog instead
 * of the full Standard set.
 *
 * A missing bootstrap tool degrades to the full catalog with a one-time warning
 * instead of throwing, so a composition drift can never brick every request of
 * a session. Invalid configuration fails when the row mounts.
 *
 * @module @deepseek-ai/dsh-tool-bootstrap
 */

import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Context, LoggerService } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { promotionStatus, registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'
import type { PromoteOn } from '@deepseek-ai/dsh-compaction-epoch'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import type {} from '@deepseek-ai/dsh-agent'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-tool-bootstrap'

/**
 * Deliberately NO inject list: the listeners only touch services at event
 * time. Keep this row right AFTER the context-gate row in agent.cordis.yml:
 * waterfall after-next transforms apply in reverse registration order, so the
 * tool filter here must register before any plugin that touches the same
 * assembly. The optional budget listener registers with `prepend: true` so a
 * later listener can never override the first-round cap after we set it.
 */
export const inject: string[] = []

/**
 * The default first-request catalog: the OFFICIAL Minimal preset's exact tool
 * pair — the persistent `bash` shell and `str_replace_editor`.
 */
/** Discovery tools always resident after promotion (the tool-search pattern). */
const RESIDENT_DISCOVERY_TOOLS = ['dev_tool_search', 'skill_search', 'skill_load']

/** The only tool call whose arguments name further tools. */
const UNLOCK_TOOL = 'dev_tool_search'

/** Tool names this session explicitly unlocked, in first-unlock order. */
export interface UnlockedTools {
  /** Names the model unlocked through a `dev_tool_search` call. */
  readonly names: string[]
}

const unlockedToolsSchema = zod.object({
  names: zod.array(zod.string()),
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Tool names this session explicitly unlocked through `dev_tool_search`. */
    unlockedTools: UnlockedTools
  }
}

/**
 * Read the tool names out of one `dev_tool_search` call's arguments.
 *
 * `tool/call` records the raw JSON string the model produced, so this is a
 * model-produced JSON boundary: a malformed string, a non-object, or a
 * `toolNames` that is not an array of non-empty strings contributes nothing
 * rather than failing the request.
 *
 * @param arguments_ - the raw arguments string from the durable event.
 * @returns the unlocked names, or an empty list when none are readable.
 */
function readUnlockedNames(arguments_: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(arguments_)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const { toolNames } = parsed as { toolNames?: unknown }
  if (!Array.isArray(toolNames)) return []
  return toolNames.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/**
 * Fold one durable event into the unlocked-tool set.
 *
 * @param state - the set as of the previous event.
 * @param event - the committed durable event.
 * @returns the set as of `event`.
 */
function foldUnlocked(state: UnlockedTools, event: SessionEvent): UnlockedTools {
  if (event.type !== 'tool/call' || event.data.name !== UNLOCK_TOOL) return state
  const added = readUnlockedNames(event.data.arguments)
    .filter(name => !state.names.includes(name))
  return added.length === 0 ? state : { names: [...state.names, ...added] }
}

/**
 * Register the unlocked-tool projection on `registry`.
 *
 * @param registry - the session projection registry the unit folds into.
 * @returns the exact disposer that unregisters the unit.
 */
export function registerUnlockedTools(registry: SessionProjectionRegistry): () => void {
  return registry.register({
    key: 'unlockedTools',
    stateVersion: 1,
    stateSchema: unlockedToolsSchema,
    init: () => ({ names: [] }),
    apply: foldUnlocked,
  })
}

/** Per-phase catalog configuration. Invalid values fail plugin load. */
export interface Config {
  /** Tool names exposed on the controlled first request of each epoch. Required. */
  bootstrapTools: string[]
  /** Which durable signal promotes this session out of the controlled phase. */
  promoteOn?: PromoteOn
  /** First-request output cap. Omit to let the adapter default flow. */
  bootstrapMaxTokens?: number
  /**
   * Tools added to the controlled phase after a compaction, before
   * re-promotion. Omit or set to none for no compaction recovery catalog.
   */
  compactionTools?: string[]
  /** Whether subagents follow the controlled phase instead of starting resident. */
  includeSubagents?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  bootstrapTools: z.array(z.string().min(1)),
  promoteOn: z.union(['tool-call', 'assistant-message', 'either']).default('either'),
  bootstrapMaxTokens: z.number(),
  compactionTools: z.array(z.string().min(1)),
  includeSubagents: z.boolean().default(false),
})

/**
 * Reject a config this plugin cannot act on.
 *
 * Schemastery passes unknown keys through and cannot express a non-empty
 * requirement, so this check is what makes a preset typo visible at mount.
 *
 * @param config - the raw plugin config.
 * @returns the validated tool-name lists.
 * @throws when a key is unknown, a list is empty, or the cap is not a positive integer.
 */
function resolveToolLists(config: Config): { bootstrapTools: string[]; compactionTools: string[] } {
  const allowed = ['bootstrapTools', 'promoteOn', 'bootstrapMaxTokens', 'compactionTools', 'includeSubagents']
  const unknown = Object.keys(config).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...allowed].sort().join(', ')}`,
    )
  }
  if (config.bootstrapTools.length === 0) {
    throw new TypeError(`${name}: bootstrapTools must name at least one tool`)
  }
  const { bootstrapMaxTokens } = config
  if (bootstrapMaxTokens !== undefined
    && (!Number.isSafeInteger(bootstrapMaxTokens) || bootstrapMaxTokens <= 0)) {
    throw new TypeError(`${name}: bootstrapMaxTokens must be a positive safe integer`)
  }
  return { bootstrapTools: config.bootstrapTools, compactionTools: config.compactionTools ?? [] }
}

/**
 * Build a logger that reports `message` at most once, so a filter failure or a
 * missing tool cannot spam a session's transcript.
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

/** Register the per-session bootstrap filters. */
export function apply(ctx: Context, config: Config): void {
  const { bootstrapTools, compactionTools } = resolveToolLists(config)
  const promoteOn = config.promoteOn ?? 'either'
  const includeSubagents = config.includeSubagents ?? false
  const bootstrapMaxTokens = config.bootstrapMaxTokens
  const registry = requireProjections(ctx)
  ctx.effect(() => registerPromotionEpoch(registry))
  ctx.effect(() => registerUnlockedTools(registry))
  const warnOnce = createWarnOnce(ctx.logger)
  const controlTools = new Set(bootstrapTools)

  /**
   * Narrow the assembled catalog to `keep`.
   *
   * @param assembled - the assembled prompt.
   * @param keep - the tool names to retain.
   * @param fullCatalogOnMissing - whether a missing name yields the full catalog
   *   instead of a narrower one.
   * @returns the prompt with its catalog filtered.
   */
  const keepTools = (
    assembled: PromptAssembly,
    keep: ReadonlySet<string>,
    fullCatalogOnMissing: boolean,
  ): PromptAssembly => {
    const available = new Set(assembled.tools.map(tool => tool.name))
    const missing = [...keep].filter(toolName => !available.has(toolName))
    if (missing.length > 0) {
      warnOnce(`${name}: expected every phase tool; missing=${JSON.stringify(missing)} — ${fullCatalogOnMissing ? 'bootstrap disabled, full catalog exposed' : 'continuing with what is available'}`)
      if (fullCatalogOnMissing) return assembled
    }
    return { ...assembled, tools: assembled.tools.filter(tool => keep.has(tool.name)) }
  }

  ctx.on('system-prompt/assemble', async (
    _assembly: PromptAssembly,
    context: AssembleContext,
    next: () => Promise<PromptAssembly>,
  ): Promise<PromptAssembly> => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    try {
      const agent = context.agent
      const status = promotionStatus(registry, agent, promoteOn, includeSubagents)
      if (status.promoted) {
        // PROMOTED: keep the minimal resident set — the bootstrap pair + the
        // discovery tools + whatever the model explicitly unlocked through
        // dev_tool_search — instead of dumping the whole Standard catalog at
        // once.
        const unlocked = agent === undefined
          ? undefined
          : registry.stateOf(agent.session, 'unlockedTools')
        const unlockedNames = unlocked?.names ?? []
        const keep = new Set([...controlTools, ...RESIDENT_DISCOVERY_TOOLS, ...unlockedNames])
        return keepTools(assembled, keep, false)
      }
      // Controlled phase: the bootstrap pair; after a compaction, plus the
      // compaction work set so mid-task work can continue. Context control is
      // NOT here: the companion `context-gate` plugin owns it.
      const keep = new Set(controlTools)
      if (status.boundary !== null) for (const toolName of compactionTools) keep.add(toolName)
      return keepTools(assembled, keep, true)
    } catch (error: unknown) {
      // A filter bug must never brick a session: degrade to the full catalog.
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${error instanceof Error ? error.message : String(error)}`)
      return assembled
    }
  })

  // Optionally cap the first model request's output budget while bootstrapping.
  // Unset (`bootstrapMaxTokens` omitted) means the adapter default flows — the
  // Minimal tool schema anchors at 256000 without a cap.
  if (bootstrapMaxTokens !== undefined) {
    // `prepend` keeps this listener the OUTERMOST transform of the
    // agent/request waterfall, so a later listener can never override the
    // first-round budget after we set it.
    ctx.on('agent/request', async (
      payload: { agent: Agent },
      next: () => Promise<LlmCallConfig>,
    ): Promise<LlmCallConfig> => {
      const resolved = await next()
      const agent = payload.agent
      if (promotionStatus(registry, agent, promoteOn, includeSubagents).promoted) {
        // The next request's seed proposal carries the previous header's
        // maxTokens forward, so the injected cap must be stripped explicitly —
        // otherwise it would persist for the whole session.
        if (resolved.maxTokens !== bootstrapMaxTokens) return resolved
        const { maxTokens: _bootstrap, ...rest } = resolved
        return rest
      }
      return { ...resolved, maxTokens: bootstrapMaxTokens }
    }, { prepend: true })
  }
}
