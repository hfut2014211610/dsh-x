/**
 * Per-model sampling defaults for DeepSeek Harness.
 *
 * The stock `llm-pi-ai` settings own protocol, endpoint, context window, and
 * thinking-level vocabulary, but the harness deliberately keeps no per-model
 * defaults for the sampling fields of {@link LlmCallConfig}. This plugin owns
 * that gap: a `dsh-x-model-tuning` settings namespace maps `provider/model`
 * keys to `temperature` / `maxTokens` / `stop` / `reasoningEffort` defaults,
 * and an `agent/request` waterfall listener applies the matching entry to
 * every request so the values land in the logged request header (model-visible
 * ⟺ logged stays intact). The `/model-tuning` slash command edits the same
 * namespace without opening `settings.yaml`.
 *
 * ```yaml
 * # $DSH_HOME/settings.yaml (user layer; the cordis patch `config:` is the base layer)
 * dsh-x-model-tuning:
 *   profiles:
 *     deepseek/deepseek-chat:
 *       temperature: 0.6
 *       maxTokens: 8192
 *     gateway/openai/gpt-5:        # model ids may contain slashes
 *       reasoningEffort: high
 *       stop: ["<END>"]
 * ```
 *
 * Declared fields override every request to that model; fields an entry omits
 * pass through untouched, so a UI-driven reasoning-effort choice survives
 * unless the entry declares its own. An effort the exact model does not offer
 * fails the request loud with `UNSUPPORTED_REASONING_EFFORT` from the adapter.
 *
 * @module @personal/dsh-x-model-tuning
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

/** Selectable reasoning levels, mirroring pi-ai's canonical thinking-level set. */
export const REASONING_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Canonical level spelling accepted by {@link ModelTuning.reasoningEffort}. */
export type ReasoningEffortLevel = (typeof REASONING_EFFORTS)[number]

/** Sampling defaults applied to every request to the entry's model. */
export interface ModelTuning {
  /** Sampling temperature, 0..2. */
  temperature?: number
  /** Per-request output cap; wins over the adapter's configured default. */
  maxTokens?: number
  /** Stop sequences; an absent (schema-materialized empty) list carries no opinion. */
  stop?: string[]
  /** Reasoning effort as a canonical level; the owning adapter maps it to the wire spelling. */
  reasoningEffort?: ReasoningEffortLevel
}

/** Plugin configuration: tuning entries keyed by `provider/model`. */
export interface Config {
  /** Tuning entries; the key's first slash separates provider route from model id. */
  profiles?: Record<string, ModelTuning>
}

const tuningEntry: z<ModelTuning> = z.object({
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().step(1).min(1),
  stop: z.array(z.string()),
  reasoningEffort: z.union(REASONING_EFFORTS),
})

/** Runtime schema for {@link Config}; also the `dsh-x-model-tuning` settings namespace schema. */
export const Config: z<Config> = z.object({
  profiles: z.dict(tuningEntry).default({}),
})

export const name = 'dsh-x-model-tuning'

const NS = settingsNamespace('dsh-x-model-tuning')

/**
 * Reject profile keys that cannot split into a non-empty provider and model.
 * Registered as the namespace validator so a malformed key is refused where it
 * is written instead of silently never matching any request.
 * @param config - the resolved, schema-valid section.
 * @throws Error naming the offending key.
 */
export function assertWellFormedKeys(config: Config): void {
  for (const key of Object.keys(config.profiles ?? {})) {
    const slash = key.indexOf('/')
    if (slash <= 0 || slash === key.length - 1) {
      throw new Error(
        `dsh-x-model-tuning: profile key ${JSON.stringify(key)} must be "provider/model" with both sides`
        + ' non-empty (the first slash separates the two; later slashes belong to the model id)',
      )
    }
  }
}

/**
 * Merge one entry's declared fields over a resolved call configuration.
 * `stop` applies only when non-empty: schemastery materializes an absent array
 * as `[]`, and an empty list must stay "no opinion" rather than clearing an
 * inherited value.
 * @param resolved - the configuration the machine would use.
 * @param entry - the matching tuning entry, when one exists.
 * @returns the configuration the request should carry.
 */
export function applyTuning(resolved: LlmCallConfig, entry: ModelTuning | undefined): LlmCallConfig {
  if (entry === undefined) return resolved
  return {
    ...resolved,
    ...entry.temperature === undefined ? {} : { temperature: entry.temperature },
    ...entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens },
    ...entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort as ReasoningEffortId },
    ...entry.stop === undefined || entry.stop.length === 0 ? {} : { stop: [...entry.stop] },
  }
}

/**
 * Build the `agent/request` waterfall listener over a live profile source.
 * The waterfall contract requires delegating through `next()` first; the
 * entry is looked up per request so settings edits apply without a restart.
 * @param getProfiles - thunk returning the current tuning entries.
 * @returns a listener replacing the call configuration when an entry matches.
 */
export function createRequestListener(
  getProfiles: () => Readonly<Record<string, ModelTuning>>,
): (payload: unknown, next: () => Promise<LlmCallConfig>) => Promise<LlmCallConfig> {
  return async (_payload, next) => {
    const resolved = await next()
    const entry = getProfiles()[`${resolved.provider}/${resolved.model}`]
    return applyTuning(resolved, entry)
  }
}

/** One parsed field value ready for a settings `set` op. */
type ParsedFieldValue = number | string | string[]

/**
 * Parse and range-check a `set` value for one tunable field.
 * @param field - the field being set.
 * @param raw - the raw argument(s) following the field name.
 * @returns the parsed value.
 * @throws Error with a user-facing reason when the value is unusable.
 */
function parseFieldValue(field: keyof ModelTuning, raw: string[]): ParsedFieldValue {
  const text = raw.join(' ')
  switch (field) {
    case 'temperature': {
      const value = Number(text)
      if (!Number.isFinite(value) || value < 0 || value > 2) {
        throw new Error(`temperature 需要 0..2 之间的数字，收到 ${JSON.stringify(text)}`)
      }
      return value
    }
    case 'maxTokens': {
      const value = Number(text)
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`maxTokens 需要正整数，收到 ${JSON.stringify(text)}`)
      }
      return value
    }
    case 'reasoningEffort': {
      if (!(REASONING_EFFORTS as readonly string[]).includes(text)) {
        throw new Error(`reasoningEffort 需要 ${REASONING_EFFORTS.join(' | ')} 之一，收到 ${JSON.stringify(text)}`)
      }
      return text
    }
    case 'stop': {
      if (raw.length === 0) throw new Error('stop 需要至少一个停止序列（空格分隔多个）')
      return raw
    }
  }
}

const FIELD_NAMES = ['temperature', 'maxTokens', 'stop', 'reasoningEffort'] as const

/** Render the current entries for the bare `/model-tuning` form. */
function renderProfiles(profiles: Readonly<Record<string, ModelTuning>>): string {
  const keys = Object.keys(profiles)
  if (keys.length === 0) {
    return 'model-tuning 当前没有配置任何条目。用法：/model-tuning set <provider/model> <字段> <值>，字段：' + FIELD_NAMES.join(' / ')
  }
  const lines = keys.map((key) => {
    // Read through rather than asserting: the keys came from this very object,
    // but the index signature does not know that and the repository forbids
    // saying so with a non-null assertion.
    const entry = profiles[key] ?? {}
    const parts = FIELD_NAMES
      .filter(field => entry[field] !== undefined && !(field === 'stop' && (entry.stop?.length ?? 0) === 0))
      .map(field => `${field}=${field === 'stop' ? JSON.stringify(entry.stop) : String(entry[field])}`)
    return `${key}: ${parts.length === 0 ? '（空条目）' : parts.join('  ')}`
  })
  return ['model-tuning 当前条目：', ...lines].join('\n')
}

/**
 * Execute one `/model-tuning` line against the live configuration.
 * Writes go through the settings seam so validation, persistence, and hot
 * reload stay in one place; without a mounted settings provider the command
 * still reports the current entries but refuses writes.
 * @param rawInput - exact text following the command name.
 * @param profiles - the currently resolved tuning entries.
 * @param settings - the settings seam, when mounted.
 * @returns the command outcome rendered by the dispatching UI.
 */
export async function runModelTuningCommand(
  rawInput: string,
  profiles: Readonly<Record<string, ModelTuning>>,
  settings: Pick<SettingsProvider, 'mutate'> | undefined,
): Promise<CommandResult> {
  const args = rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
  if (args.length === 0) return { kind: 'success', text: renderProfiles(profiles) }

  const [action, key, field, ...rest] = args
  if ((action !== 'set' && action !== 'unset') || key === undefined) {
    return {
      kind: 'error',
      text: '用法：/model-tuning [set <provider/model> <字段> <值> | unset <provider/model> [字段]]，字段：' + FIELD_NAMES.join(' / '),
    }
  }
  const slash = key.indexOf('/')
  if (slash <= 0 || slash === key.length - 1) {
    return { kind: 'error', text: `键 ${JSON.stringify(key)} 需要 "provider/model" 形式且两侧非空` }
  }
  if (settings === undefined) {
    return { kind: 'error', text: 'settings 服务未挂载，无法写入；请改在 cordis patch 的插件 config 里配置' }
  }
  try {
    if (action === 'unset') {
      const path = field === undefined ? ['profiles', key] : ['profiles', key, field]
      if (field !== undefined && !(FIELD_NAMES as readonly string[]).includes(field)) {
        return { kind: 'error', text: `未知字段 ${JSON.stringify(field)}，可选：${FIELD_NAMES.join(' / ')}` }
      }
      await settings.mutate(NS, [{ op: 'unset', path }])
      return { kind: 'success', text: `已移除 ${path.join(' › ')}` }
    }
    if (field === undefined || !(FIELD_NAMES as readonly string[]).includes(field)) {
      return { kind: 'error', text: `未知字段 ${JSON.stringify(field ?? '')}，可选：${FIELD_NAMES.join(' / ')}` }
    }
    const value = parseFieldValue(field as keyof ModelTuning, rest)
    await settings.mutate(NS, [{ op: 'set', path: ['profiles', key, field], value }])
    return { kind: 'success', text: `已设置 ${key} 的 ${field} = ${JSON.stringify(value)}，下一请求生效` }
  } catch (error) {
    return { kind: 'error', text: `写入被拒：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Mount the namespace, the request listener, and the slash command.
 * @param ctx - plugin context.
 * @param config - validated entry configuration from the cordis patch.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, NS, Config, config, {
    validate: assertWellFormedKeys,
    setSource: (source) => {
      current = source
    },
    // Nothing registration-level derives from the value: the listener reads
    // the source per request, so a committed change needs no re-judgment here.
    onChange: () => undefined,
  })
  const getProfiles = (): Readonly<Record<string, ModelTuning>> => current().profiles ?? {}
  ctx.on('agent/request', createRequestListener(getProfiles))
  ctx.inject(['commands'], (injected) => {
    injected.commands.register({
      name: 'model-tuning',
      description: '查看/修改每模型采样默认值（temperature、maxTokens、stop、reasoningEffort）',
      input: { hint: '[set <provider/model> <字段> <值> | unset <provider/model> [字段]]' },
      handler: invocation => runModelTuningCommand(invocation.rawInput, getProfiles(), ctx.get('settings')),
    })
  })
}
