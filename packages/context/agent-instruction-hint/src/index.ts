/**
 * instruction-hint — replace `dsh-agent-instructions`' full AGENTS.md/CLAUDE.md
 * injection with a minimal "these files exist" hint.
 *
 * The full workspace-instruction digest is a large injected block. After the
 * anchored bootstrap promotes, the model should KNOW the instruction files
 * exist — so it reads them before acting — without their content being dumped
 * into every request. The model reads the files itself through the filesystem
 * tools when it needs them.
 *
 * Behavior:
 *  - After the session records its first durable promotion signal
 *    (`promoteOn`, default `either`), ONE hint message is injected, naming the
 *    instruction files that were found:
 *      - user-global: `$DSH_HOME/AGENTS.md`
 *      - project chain: AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md
 *        in the project root, the first ancestor holding a root marker.
 *  - The hint is ONCE PER SESSION. The projection records that the hint reached
 *    the durable log, so a process restart — whose in-memory state starts empty
 *    — cannot inject a second copy; an in-process claim set additionally keeps
 *    two concurrent steps of one turn from both probing. `createUserMessage`
 *    mints a fresh identity and forbids a caller-chosen one, so duplicate
 *    detection rests on the projection rather than on a deterministic id.
 *  - Files are probed through `ctx.get('fs')`, the host filesystem seam. A
 *    missing fs service, an unreadable probe, or an aborted step degrades to no
 *    hint; none of them throws.
 *  - Pre-promotion requests get NO hint, matching the anchored bootstrap.
 *  - A subagent skips the phase wait by default because its first request
 *    already reads as promoted. `includeSubagents: true` makes a subagent's own
 *    first reply or tool call open its hint, which also keeps the injection out
 *    of the context gate's stripped first request.
 *
 * ROW ORDER: this plugin registers its `agent/pre-step` handler with
 * `prepend: true` and after `context-gate`/`tool-bootstrap`, so it runs inside
 * the gate's outermost strip — but it emits AFTER promotion, when the strip is
 * inactive. The hint carries its own `instruction-hint` source kind, which
 * earlier fork releases recorded under the released `plugin` kind; that legacy
 * spelling is still recognized when folding, because released-format migration
 * refuses a kind it no longer knows and an unreadable log is worse than a
 * presentation label.
 *
 * @module @deepseek-ai/dsh-agent-instruction-hint
 */

import { dirname, join, resolve as resolvePath } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Context, LoggerService } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { promotionStatus, registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'
import type { PromoteOn } from '@deepseek-ai/dsh-compaction-epoch'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Cordis plugin name used by loader diagnostics and as the hint's source kind. */
export const name = 'instruction-hint'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * The hint that workspace instruction files exist. Its projection records
     * that the hint reached the log, so a resumed session does not receive a
     * second copy.
     * @persistenceAttribution
     */
    'instruction-hint': { kind: 'instruction-hint'; readonly form: 'instructions' }
  }
}

/** Directories that mark the project root, in probe order. */
const ROOT_MARKERS = ['.git', '.hg', '.svn'] as const

/** Candidate file names in the project root, in probe order. */
const PROJECT_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'] as const

/** Candidate file name in the harness home. */
const USER_GLOBAL_CANDIDATE = 'AGENTS.md'

/** The closing instruction that makes the hint actionable without its content. */
const HINT_CLOSING = 'Do NOT assume their content. When a task touches this workspace, read the relevant instruction files first and follow them.'

const hintInjectedSchema = zod.object({ injected: zod.boolean() })

/** Whether this session's hint has already reached the durable log. */
export interface HintInjected {
  /** True once a hint message is recorded in the session log. */
  readonly injected: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Whether this session's instruction hint is already durable. */
    instructionHintInjected: HintInjected
  }
}

/**
 * The two filesystem questions this plugin asks, narrowed from the host `fs`
 * seam: does this path exist, and is it a regular file. Keeping the seam this
 * small lets a test supply a probe double without standing up the whole service,
 * and keeps the probing code free of opaque target handles.
 */
export interface HintFileSystem {
  /** Whether a root marker or candidate file exists at the resolved path. */
  exists(resolvedPath: string, signal: AbortSignal): Promise<boolean>
  /** Whether a resolved path is a regular file. */
  isFile(resolvedPath: string, signal: AbortSignal): Promise<boolean>
}

/**
 * Non-serializable hooks used to make filesystem probing deterministic in
 * tests. The default reads the host `fs` seam.
 */
export interface HintInternals {
  /** The filesystem the hint probes, or `undefined` for no hint. */
  fileSystem?: () => HintFileSystem | undefined
}

/**
 * Adapt the host `fs` service to {@link HintFileSystem}.
 *
 * @param fs - the host filesystem seam.
 * @returns the narrowed probe surface.
 */
function hostFileSystem(fs: FileSystem): HintFileSystem {
  const kind = async (resolvedPath: string, signal: AbortSignal): Promise<'file' | 'directory' | 'other' | undefined> => {
    const target = await fs.resolve(resolvedPath, { signal })
    return (await fs.stat(target, signal))?.type
  }
  return {
    exists: async (resolvedPath, signal) => await kind(resolvedPath, signal) !== undefined,
    isFile: async (resolvedPath, signal) => await kind(resolvedPath, signal) === 'file',
  }
}

/** Narrow one value to a plain record for a defensive property read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether one logged message source is this plugin's hint.
 *
 * Earlier fork releases recorded the hint under the released `plugin` kind,
 * which 0.2.0 removed from the source vocabulary. The durable log is a file
 * boundary, so the legacy spelling is read defensively rather than trusted from
 * the static type, which no longer admits it.
 *
 * @param source - the logged `user/message` source.
 * @returns true for the current kind and for the legacy `plugin` spelling.
 */
function isHintSource(source: MessageSource): boolean {
  if (source.kind === name) return true
  const legacy: unknown = source
  return isRecord(legacy) && legacy['kind'] === 'plugin' && legacy['plugin'] === name
}

/**
 * Fold one durable event into the injected flag.
 *
 * @param state - the flag as of the previous event.
 * @param event - the committed durable event.
 * @returns the flag as of `event`.
 */
function foldInjected(state: HintInjected, event: SessionEvent): HintInjected {
  if (state.injected) return state
  if (event.type !== 'user/message' || !isHintSource(event.data.source)) return state
  return { injected: true }
}

/**
 * Register the hint-injected projection on `registry`.
 *
 * @param registry - the session projection registry the unit folds into.
 * @returns the exact disposer that unregisters the unit.
 */
export function registerHintInjected(registry: SessionProjectionRegistry): () => void {
  return registry.register({
    key: 'instructionHintInjected',
    stateVersion: 1,
    stateSchema: hintInjectedSchema,
    init: () => ({ injected: false }),
    apply: foldInjected,
  })
}

/**
 * Find the project root: the nearest ancestor of `cwd` holding a root marker,
 * or `cwd` itself when none does.
 *
 * @param fs - the filesystem probe surface.
 * @param cwd - the session's working directory.
 * @param signal - the current step's abort signal.
 * @returns the project root directory.
 */
async function findProjectRoot(fs: HintFileSystem, cwd: string, signal: AbortSignal): Promise<string> {
  let current = resolvePath(cwd)
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      try {
        if (await fs.exists(join(current, marker), signal)) return current
      } catch (error: unknown) {
        // A marker that cannot be probed is a marker that is absent.
        void error
      }
    }
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

/**
 * List the candidates present in one directory.
 *
 * @param fs - the filesystem probe surface.
 * @param dir - the directory to probe.
 * @param candidates - file names to look for, in probe order.
 * @param signal - the current step's abort signal.
 * @returns the names found, in probe order.
 */
async function presentInDir(
  fs: HintFileSystem,
  dir: string,
  candidates: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  const found: string[] = []
  for (const candidate of candidates) {
    try {
      if (await fs.isFile(join(dir, candidate), signal)) found.push(candidate)
    } catch (error: unknown) {
      // An absent or unreadable candidate is simply not reported.
      void error
    }
  }
  return found
}

/**
 * Compose the hint text for the discovered files.
 *
 * @param projectFiles - project-root candidates found.
 * @param projectRoot - the project root they were found in.
 * @param userGlobalFound - whether the harness home carries an AGENTS.md.
 * @returns the hint text, or `undefined` when no instruction file exists.
 */
function composeHint(
  projectFiles: readonly string[],
  projectRoot: string,
  userGlobalFound: boolean,
): string | undefined {
  const sections: string[] = []
  if (projectFiles.length > 0) {
    sections.push(`Workspace instruction files exist: ${projectFiles.join(', ')} (project root: ${projectRoot}).`)
  }
  if (userGlobalFound) {
    sections.push(`A user-global instruction file exists: ${USER_GLOBAL_CANDIDATE}.`)
  }
  if (sections.length === 0) return undefined
  return [...sections, HINT_CLOSING].join(' ')
}

/** Post-promotion hint injection. Invalid values fail plugin load. */
export interface Config {
  /** Which durable signal promotes this session before its hint is injected. */
  promoteOn?: PromoteOn
  /** Whether subagents wait for their own promotion signal before the hint. */
  includeSubagents?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  promoteOn: z.union(['tool-call', 'assistant-message', 'either']).default('either'),
  includeSubagents: z.boolean().default(false),
})

/**
 * Reject a config this plugin cannot act on: schemastery passes unknown keys
 * through, so a preset typo would otherwise go unnoticed.
 *
 * @param config - the raw plugin config.
 * @throws when the config carries a key outside {@link Config}.
 */
function rejectUnknownKeys(config: Config): void {
  const allowed = ['promoteOn', 'includeSubagents']
  const unknown = Object.keys(config).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...allowed].sort().join(', ')}`,
    )
  }
}

/**
 * Build a logger that reports `message` at most once, so a failing probe cannot
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

/** Register the post-promotion instruction-hint injector. */
export function apply(ctx: Context, config: Config = {}, internals: HintInternals = {}): void {
  rejectUnknownKeys(config)
  const promoteOn = config.promoteOn ?? 'either'
  const includeSubagents = config.includeSubagents ?? false
  const registry = requireProjections(ctx)
  ctx.effect(() => registerPromotionEpoch(registry))
  ctx.effect(() => registerHintInjected(registry))
  const warnOnce = createWarnOnce(ctx.logger)
  /** Sessions whose hint this process has already emitted or skipped. */
  const claimed = new Set<string>()

  ctx.on('agent/pre-step', async (
    { agent, signal }: { agent: Agent; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    // Downstream errors propagate untouched; only the hint's own logic is guarded.
    const decision = await next()
    if (decision.kind === 'reject') return decision
    try {
      if (!promotionStatus(registry, agent, promoteOn, includeSubagents).promoted) return decision
      const { session } = agent
      if (claimed.has(session.id)) return decision
      const injected = registry.stateOf(session, 'instructionHintInjected')?.injected === true
      // The claim precedes the probes so two concurrent steps of one turn
      // cannot both reach the filesystem. A probe that then fails costs this
      // session its hint, which beats injecting two.
      claimed.add(session.id)
      if (injected) return decision

      const host = (internals.fileSystem ?? (() => {
        const service = ctx.get('fs')
        return service === undefined ? undefined : hostFileSystem(service)
      }))()
      if (host === undefined) return decision

      const root = await findProjectRoot(host, session.header.cwd ?? process.cwd(), signal)
      const projectFiles = await presentInDir(host, root, PROJECT_CANDIDATES, signal)
      const userGlobalFiles = await presentInDir(host, resolveDshHome(), [USER_GLOBAL_CANDIDATE], signal)
      const text = composeHint(projectFiles, root, userGlobalFiles.length > 0)
      if (text === undefined) return decision

      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: name, form: 'instructions' },
          }),
        ],
      }
    } catch (error: unknown) {
      // A hint bug must never hurt the session: skip the hint.
      warnOnce(`${name}: hint injection failed, skipping: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
  }, { prepend: true })
}
