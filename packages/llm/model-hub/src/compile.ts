/**
 * Authoring-layer schema and the compiler from model-centered configuration to
 * stock `llm-pi-ai` provider routes.
 *
 * The authoring layout separates providers (endpoint + credential + shared
 * defaults) from models (owning provider + own wire protocol + capabilities).
 * The stock adapter serves one wire protocol per route, so the compiler groups
 * each provider's models by protocol and emits one official route per group —
 * automating the stock "split the provider across route keys" workaround
 * (`dsh-llm-pi-ai` README, Known Limitations).
 *
 * Route naming is the request identity (session logs reference it) and is
 * therefore deterministic: a provider whose models speak a single protocol
 * keeps its key as the route; a multi-protocol provider gets one
 * `provider~api` route per protocol.
 *
 * @module @deepseek-ai/dsh-model-hub/compile
 */

import z from '@deepseek-ai/schemastery'
import { supportedProtocols } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'

/** pi-ai's canonical thinking-level set, accepted as `reasoningEfforts` keys. */
export const REASONING_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Request modalities a model entry may declare. */
export const MODALITIES = ['text', 'image'] as const

/** Separator between provider key and protocol in generated multi-protocol route names. */
export const ROUTE_SEPARATOR = '~'

/** One supplier of models: endpoint, credential reference, and per-route defaults. */
export interface HubProvider {
  /** Vendor preset key this entry was created from (the page's model-preset filter); free-form, never compiled. */
  preset?: string
  /** Name shown by configuration surfaces; defaults to the provider key. */
  displayName?: string
  /** Endpoint shared by every model this provider serves. */
  baseURL: string
  /**
   * Per-protocol endpoint override. Path conventions differ by SDK: the OpenAI
   * protocols use the baseURL as a prefix (`{baseURL}/chat/completions`), while
   * anthropic-messages goes through the Anthropic SDK, which appends
   * `/v1/messages` itself — a gateway that serves OpenAI traffic under `/v1`
   * therefore needs its anthropic endpoint WITHOUT that suffix (e.g. baseURL
   * `.../v1` plus `endpoints: { anthropic-messages: ... }` on the bare root),
   * or every anthropic request 404s on the doubled `/v1/v1/messages`.
   */
  endpoints?: Record<string, string>
  /** Credential reference (environment-variable name), resolved per request by the stock adapter. */
  apiKeyEnv?: string
  /** Provider request headers; Harness attribution wins reserved names. */
  headers?: Record<string, string>
  /** Reasoning-dispatch switches, the route-level default for every generated model. */
  compat?: PiAiCompatProfile
  /** Modalities for models neither their entry nor a catalog describes. */
  defaultInput?: string[]
  /** Context capacity for unsized models (stock default 262,144). */
  defaultContextWindow?: number
  /** Output capability for unsized models (stock default 32,768). */
  defaultMaxTokens?: number
}

/** Reasoning-dispatch compat switches, mirroring the stock profile shape. */
export interface PiAiCompatProfile {
  /** Wire dialect for thinking parameters; validated by the stock adapter at write time. */
  thinkingFormat?: string
  /** Whether the endpoint accepts a reasoning-effort parameter. */
  supportsReasoningEffort?: boolean
}

/** One additional supplier a model may fall back to: provider key plus the wire protocol spoken there. */
export interface HubModelFallback {
  /** Key into {@link Config.providers}. */
  provider: string
  /** Wire protocol this model speaks on that provider; one of the stock adapter's `supportedProtocols()`. */
  api: string
}

/** One model declaration: who serves it, which wire protocol it speaks, and its capacities. */
export interface HubModel {
  /** Key into {@link Config.providers}; the primary supplier of this model. */
  provider: string
  /** Wire protocol this model speaks on its primary provider; one of the stock adapter's `supportedProtocols()`. */
  api: string
  /**
   * Ordered fallback suppliers tried after the primary route's own retry
   * budget is exhausted (see the `agent/request-error` listener in index.ts).
   * Each entry places this model on that provider's route too, so it stays
   * individually selectable there.
   */
  fallbacks?: HubModelFallback[]
  /** Display name; defaults to the model id. */
  name?: string
  /** Context capacity in tokens. */
  contextWindow?: number
  /** Output capability in tokens; also becomes the route's configured per-request default. */
  maxTokens?: number
  /** Request modalities; absence inherits catalog/route fallback. */
  input?: string[]
  /** Selectable thinking levels (key = level, value = wire spelling), or `false` for non-reasoning. */
  reasoningEfforts?: Record<string, string | null> | false
  /** Per-model reasoning-dispatch override over the provider's. */
  compat?: PiAiCompatProfile
}

/** Plugin configuration: providers, models, and internal bookkeeping. */
export interface Config {
  /** Suppliers keyed by provider id. */
  providers?: Record<string, HubProvider>
  /** Models keyed by model id; one id is declarable once across all providers. */
  models?: Record<string, HubModel>
  /**
   * Route keys this plugin generated into the `llm-pi-ai` user layer, recorded
   * after each successful reconcile so stale routes can be retracted without
   * ever touching hand-written routes. Written by the plugin, not by users.
   */
  _routes?: string[]
}

const compat: z<PiAiCompatProfile> = z.object({
  thinkingFormat: z.string(),
  supportsReasoningEffort: z.boolean(),
})

/**
 * Keys are offered levels, values their wire spellings; a valueless `off:`
 * survives as null (stock idiom — only resolution decides which levels may
 * leave the value empty). The assertion narrows schemastery's Dict typing,
 * which marks every literal key required while runtime validation checks only
 * present keys.
 */
const reasoningEfforts = z.dict(
  z.union([z.string(), z.const(null)]),
  z.union([...REASONING_EFFORT_LEVELS]),
) as unknown as z<Record<string, string | null>>

const hubModelFallback: z<HubModelFallback> = z.object({
  provider: z.string().required(),
  api: z.union([...supportedProtocols()]).required(),
})

const hubModel = z.object({
  provider: z.string().required(),
  api: z.union([...supportedProtocols()]).required(),
  fallbacks: z.array(hubModelFallback),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union([...MODALITIES])),
  reasoningEfforts: z.union([z.const(false), reasoningEfforts]),
  compat,
})

const hubProvider = z.object({
  preset: z.string(),
  displayName: z.string(),
  baseURL: z.string().required(),
  // Same key-validation idiom as reasoningEfforts: dict keys restricted to the
  // stock adapter's protocol names so a typo fails loud at write time.
  endpoints: z.dict(z.string(), z.union([...supportedProtocols()])),
  apiKeyEnv: z.string().role('credential-ref'),
  headers: z.dict(z.string()),
  compat,
  defaultInput: z.array(z.union([...MODALITIES])),
  defaultContextWindow: z.number().step(1).min(1),
  defaultMaxTokens: z.number().step(1).min(1),
})

/**
 * Whether a compat block carries at least one declared switch. schemastery
 * materializes an absent nested object as `{}`, which must read as "no
 * opinion" so route/model resolution can still fall through to lower layers.
 */
function hasCompatFields(compat: PiAiCompatProfile | undefined): boolean {
  return compat !== undefined && (compat.thinkingFormat !== undefined || compat.supportsReasoningEffort !== undefined)
}

/**
 * The provider-level compat switches one protocol group may inherit. Both
 * fields exist only on openai-completions — the stock adapter refuses a route
 * that sets them without an openai-completions model — so a group speaking
 * another protocol inherits nothing (thinking there is dispatched natively).
 */
function inheritedCompat(compat: PiAiCompatProfile | undefined, api: string): PiAiCompatProfile | undefined {
  if (api !== 'openai-completions' || !hasCompatFields(compat)) return undefined
  return { ...compat }
}

/** Runtime schema for {@link Config}; also the `dsh-x-model-hub` settings namespace schema. */
export const Config = z.object({
  providers: z.dict(hubProvider).default({}),
  models: z.dict(hubModel).default({}),
  _routes: z.array(z.string()),
  // schemastery's object inference marks members nullable; the interface is
  // the authoritative shape after resolution (stock idiom: the same cast the
  // pi-ai adapter uses for its reasoningEfforts dict).
}) as unknown as z<Config>

/** Every (provider, api) pair one model is served on: its primary placement first, then ordered fallbacks. */
function placementsOf(model: HubModel): HubModelFallback[] {
  return [{ provider: model.provider, api: model.api }, ...(model.fallbacks ?? [])]
}

/** One (provider, api) group of model placements, in declaration order. */
interface ModelGroup {
  providerKey: string
  api: string
  entries: PiAiModelProfile[]
}

/**
 * Group every model's placements by (provider, api). Shared by {@link compileRoutes}
 * and {@link compileChains} so route naming can never disagree between them.
 * @param config - the resolved authoring section.
 * @returns the populated groups plus each provider's protocol-group count.
 * @throws Error naming the model when a placement references an unknown provider.
 */
function groupModels(config: Pick<Config, 'providers' | 'models'>): { groups: ModelGroup[]; protocolCounts: Map<string, number> } {
  const providers = config.providers ?? {}
  const groups = new Map<string, ModelGroup>()
  for (const [id, model] of Object.entries(config.models ?? {})) {
    const entry: PiAiModelProfile = { id }
    if (model.name !== undefined) entry.name = model.name
    if (model.contextWindow !== undefined) entry.contextWindow = model.contextWindow
    if (model.maxTokens !== undefined) entry.maxTokens = model.maxTokens
    if (model.input !== undefined && model.input.length > 0) entry.input = [...model.input] as NonNullable<PiAiModelProfile['input']>
    if (model.reasoningEfforts !== undefined) entry.reasoningEfforts = model.reasoningEfforts
    if (model.compat !== undefined && hasCompatFields(model.compat)) entry.compat = { ...model.compat } as NonNullable<PiAiModelProfile['compat']>
    for (const placement of placementsOf(model)) {
      if (!(placement.provider in providers)) {
        throw new Error(`dsh-x-model-hub: model "${id}" references unknown provider "${placement.provider}"`)
      }
      const groupKey = `${placement.provider}\0${placement.api}`
      let group = groups.get(groupKey)
      if (group === undefined) {
        group = { providerKey: placement.provider, api: placement.api, entries: [] }
        groups.set(groupKey, group)
      }
      group.entries.push(entry)
    }
  }
  const protocolCounts = new Map<string, number>()
  for (const group of groups.values()) {
    protocolCounts.set(group.providerKey, (protocolCounts.get(group.providerKey) ?? 0) + 1)
  }
  return { groups: [...groups.values()], protocolCounts }
}

/** The deterministic route name of one group: bare provider key, or `provider~api` when the provider spans protocols. */
function routeNameOf(group: ModelGroup, protocolCounts: Map<string, number>): string {
  const count = protocolCounts.get(group.providerKey)
  if (count === undefined) throw new Error(`dsh-x-model-hub: missing protocol count for provider "${group.providerKey}"`)
  return count > 1 ? `${group.providerKey}${ROUTE_SEPARATOR}${group.api}` : group.providerKey
}

/**
 * Compile the authoring layer into stock `llm-pi-ai` provider profiles.
 * Models group by `(provider, api)` in declaration order — every placement
 * (primary and each fallback) lands the model on that group, so a
 * multi-provider model is listed and selectable on each of its routes; each
 * group becomes one route whose profile inherits the provider's endpoint,
 * credential, and defaults; the provider's reasoning-dispatch compat switches
 * inherit only onto openai-completions groups (the stock adapter rejects them
 * on any other protocol). A single-protocol provider keeps its bare key as
 * the route name; each extra protocol group gets a `provider~api` route.
 * @param config - the resolved authoring section.
 * @returns official provider profiles keyed by generated route name.
 * @throws Error naming the model when it references an unknown provider.
 */
export function compileRoutes(config: Pick<Config, 'providers' | 'models'>): Record<string, PiAiProviderProfile> {
  const providers = config.providers ?? {}
  const { groups, protocolCounts } = groupModels(config)
  const routes: Record<string, PiAiProviderProfile> = {}
  for (const group of groups) {
    const provider = providers[group.providerKey]
    if (provider === undefined) throw new Error(`dsh-x-model-hub: unknown grouped provider "${group.providerKey}"`)
    const count = protocolCounts.get(group.providerKey)
    if (count === undefined) throw new Error(`dsh-x-model-hub: missing protocol count for provider "${group.providerKey}"`)
    const multi = count > 1
    const groupCompat = inheritedCompat(provider.compat, group.api)
    routes[routeNameOf(group, protocolCounts)] = {
      ...provider.apiKeyEnv === undefined ? {} : { apiKeyEnv: provider.apiKeyEnv },
      displayName: multi ? `${provider.displayName ?? group.providerKey} · ${group.api}` : (provider.displayName ?? group.providerKey),
      api: group.api,
      baseURL: provider.endpoints?.[group.api] ?? provider.baseURL,
      ...provider.headers === undefined || Object.keys(provider.headers).length === 0 ? {} : { headers: { ...provider.headers } },
      ...groupCompat === undefined ? {} : { compat: groupCompat as NonNullable<PiAiProviderProfile['compat']> },
      // schemastery materializes an absent array as [], and the stock adapter
      // refuses an empty route-level defaultInput — an empty list here is "no
      // opinion", so it is omitted rather than forwarded.
      ...provider.defaultInput === undefined || provider.defaultInput.length === 0
        ? {}
        : { defaultInput: [...provider.defaultInput] as NonNullable<PiAiProviderProfile['defaultInput']> },
      ...provider.defaultContextWindow === undefined ? {} : { defaultContextWindow: provider.defaultContextWindow },
      ...provider.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: provider.defaultMaxTokens },
      models: group.entries,
    }
  }
  return routes
}

/**
 * The ordered fallback chain of every multi-provider model, keyed by model id:
 * its primary route first, then each fallback route in declaration order.
 * Single-placement models are absent. Route names come from the same grouping
 * pass as {@link compileRoutes}, so they always name real compiled routes.
 * @param config - the resolved authoring section.
 * @returns ordered route names per multi-provider model id.
 */
export function compileChains(config: Pick<Config, 'providers' | 'models'>): Record<string, string[]> {
  const { groups, protocolCounts } = groupModels(config)
  const nameByPair = new Map(groups.map(group => [`${group.providerKey}\0${group.api}`, routeNameOf(group, protocolCounts)]))
  const chains: Record<string, string[]> = {}
  for (const [id, model] of Object.entries(config.models ?? {})) {
    const placements = placementsOf(model)
    if (placements.length < 2) continue
    chains[id] = placements.map((placement) => {
      const route = nameByPair.get(`${placement.provider}\0${placement.api}`)
      if (route === undefined) {
        throw new Error(`dsh-x-model-hub: missing compiled route for provider "${placement.provider}" and api "${placement.api}"`)
      }
      return route
    })
  }
  return chains
}

/**
 * Reject an authoring section the compiler could not serve, naming the key at
 * fault. Registered as the namespace validator, so a bad write is refused
 * where it is written.
 * @param config - the resolved, schema-valid section.
 * @throws Error naming the offending provider or model key.
 */
export function assertUsable(config: Config): void {
  for (const [key, provider] of Object.entries(config.providers ?? {})) {
    if (key.length === 0) throw new Error('dsh-x-model-hub: provider keys must be non-empty')
    if (key.includes(ROUTE_SEPARATOR)) {
      throw new Error(`dsh-x-model-hub: provider key ${JSON.stringify(key)} contains "${ROUTE_SEPARATOR}", reserved for generated route names`)
    }
    if (provider.baseURL.length === 0) {
      throw new Error(`dsh-x-model-hub: provider "${key}" has an empty baseURL`)
    }
  }
  for (const [id, model] of Object.entries(config.models ?? {})) {
    if (id.length === 0) throw new Error('dsh-x-model-hub: model ids must be non-empty')
    const seen = new Set<string>()
    for (const placement of placementsOf(model)) {
      const pairKey = `${placement.provider}\0${placement.api}`
      if (seen.has(pairKey)) {
        throw new Error(`dsh-x-model-hub: model "${id}" lists provider "${placement.provider}" (${placement.api}) more than once`)
      }
      seen.add(pairKey)
    }
  }
  // Cross-reference check lives in the compiler; run it so writes fail here.
  compileRoutes(config)
}
