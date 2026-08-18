/**
 * Model-centered provider/model authoring for DeepSeek Harness.
 *
 * You declare suppliers and models separately — every model names its provider
 * and its own wire protocol — and this plugin compiles that layout into stock
 * `llm-pi-ai` provider routes in the settings user layer. The stock adapter
 * keeps doing the heavy lifting (protocol implementations, credentials,
 * hot route registration, model directory); this plugin only owns the
 * authoring layout and the reconciliation that keeps the generated routes in
 * sync with it.
 *
 * ```yaml
 * # $DSH_HOME/settings.yaml (user layer; the cordis patch `config:` is the base layer)
 * dsh-x-model-hub:
 *   providers:
 *     my-gateway:
 *       baseURL: http://127.0.0.1:18080/v1
 *       apiKeyEnv: LOCAL_GATEWAY_API_KEY
 *   models:
 *     deepseek-v4-pro:
 *       provider: my-gateway
 *       api: openai-completions
 *     claude-sonnet-5:
 *       provider: my-gateway
 *       api: anthropic-messages      # same supplier, another protocol
 * ```
 *
 * compiles to the stock routes `my-gateway` (openai-completions models) and
 * `my-gateway~anthropic-messages`. See compile.ts for the naming contract and
 * README.md for the ownership rules (routes named with `~` are managed here —
 * do not hand-edit them in `settings.yaml`).
 *
 * The wire gateway additionally: stores pasted API keys in the credentials
 * seam under a derived `<KEY>_API_KEY` reference (the authoring document only
 * ever carries the reference); reports linkage state to the page (compiled
 * route per model, credential resolvability, the last reconcile failure);
 * imports hand-written `llm-pi-ai` routes back into the authoring layout
 * (decompile.ts); and sets the default model selection.
 *
 * @module @deepseek-ai/dsh-model-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assertUsable, compileChains, compileRoutes, Config } from './compile.ts'
import { deriveKeyRef, mergeRouteLayers, planImport } from './decompile.ts'
import { listPresets } from './presets.ts'
import type {
  HubDocView,
  HubModel,
  HubProvider,
  ImportOutcome,
  ProbeResult,
  ProviderPreset,
} from './types.ts'

export { assertUsable, compileChains, compileRoutes, Config, MODALITIES, REASONING_EFFORT_LEVELS, ROUTE_SEPARATOR } from './compile.ts'
export type { Config as HubConfig } from './compile.ts'
export { listPresets, presetOf } from './presets.ts'
export { deriveKeyRef, mergeRouteLayers, planImport } from './decompile.ts'
export type * from './types.ts'

export const name = 'dsh-x-model-hub'

const NS = settingsNamespace('dsh-x-model-hub')
const PI_AI_NS = settingsNamespace('llm-pi-ai')
const AGENT_DEFAULT_NS = settingsNamespace('agent-default-model')

/**
 * Compute the settings edits that bring the stock adapter's user layer in
 * sync with the desired routes: retract generated routes that are no longer
 * desired, upsert every desired route. Only route keys recorded as generated
 * (the `last` ledger) are ever unset — hand-written routes are never touched.
 * @param desired - compiled routes keyed by generated route name.
 * @param last - route keys this plugin generated previously.
 * @returns ordered `providers.<route>` path ops for the `llm-pi-ai` namespace.
 */
export function diffRouteOps(
  desired: Record<string, PiAiProviderProfile>,
  last: readonly string[],
): SettingsPathOp[] {
  const ops: SettingsPathOp[] = []
  for (const key of last) {
    if (!Object.hasOwn(desired, key)) ops.push({ op: 'unset', path: ['providers', key] })
  }
  for (const [key, profile] of Object.entries(desired)) {
    ops.push({ op: 'set', path: ['providers', key], value: profile })
  }
  return ops
}

/**
 * One reconciliation pass: compile the authoring section, apply the diff to
 * the stock namespace, then record the generated route key set in this
 * plugin's own namespace (which re-triggers a no-op pass by design).
 * @param settings - the settings seam (write path for both namespaces).
 * @param config - the currently resolved authoring section.
 * @returns whether any write was issued.
 * @throws whatever the settings seam rejects (invalid generated profile, missing namespace).
 */
export async function reconcileRoutes(
  settings: Pick<SettingsProvider, 'mutate'>,
  config: Config,
): Promise<{ changed: boolean }> {
  const desired = compileRoutes(config)
  const last = config._routes ?? []
  const desiredKeys = Object.keys(desired)
  const sameKeySet = last.length === desiredKeys.length && last.every(key => desiredKeys.includes(key))
  const ops = diffRouteOps(desired, last)
  if (ops.length === 0 && sameKeySet) return { changed: false }
  if (ops.length > 0) await settings.mutate(PI_AI_NS, ops)
  if (!sameKeySet) await settings.mutate(NS, [{ op: 'set', path: ['_routes'], value: desiredKeys }])
  return { changed: true }
}

/** The last failed reconcile's message, or null when generated routes are in sync. */
let lastReconcileFailure: string | null = null

/**
 * Failure codes that justify trying the model's next provider route: the
 * stock retryable set plus quota and credential failures — a failover swaps
 * the credential with the provider, so a bad or missing key on the primary
 * is exactly when the backup helps. `CONTEXT_WINDOW_EXCEEDED` is excluded:
 * it is deterministic for the model's declared sizing everywhere.
 */
export const FAILOVER_CODES = [
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'QUOTA',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
  'INVALID_CREDENTIAL',
  'MISSING_CREDENTIAL',
] as const

/**
 * The route a failed attempt should fail over to: the entry after `provider`
 * in the model's chain, or undefined when the failure is not failover-worthy,
 * the model has no chain, or the failed route is not mid-chain.
 * @param chains - ordered route lists per model id (from `compileChains`).
 * @param model - the failed request's model id.
 * @param provider - the route that served the failed attempt.
 * @param code - the normalized failure code.
 * @returns the next route, or undefined to delegate recovery downstream.
 */
export function nextFallbackRoute(
  chains: Record<string, readonly string[]>,
  model: string | undefined,
  provider: string,
  code: string,
): string | undefined {
  if (!(FAILOVER_CODES as readonly string[]).includes(code)) return undefined
  if (model === undefined) return undefined
  const chain = chains[model]
  if (chain === undefined) return undefined
  const index = chain.indexOf(provider)
  if (index < 0 || index + 1 >= chain.length) return undefined
  return chain[index + 1]
}

/** Per-route probe ceiling: reasoning gateways can think a while even on "ping". */
export const PROBE_TIMEOUT_MS = 30_000

/**
 * Probe one model on each given route with a minimal real request (maxTokens
 * 1), in parallel. Never throws: adapter failures arrive as terminal error
 * chunks and dispatch failures as throws, and both land in the per-route
 * result so the page can name the broken route.
 * @param stream - the llm seam's raw stream (`ctx.llm.stream` bound).
 * @param model - the model id to probe.
 * @param routes - compiled routes listing the model (primary first).
 * @param timeoutMs - per-route ceiling.
 * @returns one result per route, in input order.
 */
export async function probeRoutes(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  model: string,
  routes: readonly string[],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult[]> {
  return Promise.all(routes.map(async (route): Promise<ProbeResult> => {
    const started = Date.now()
    const elapsed = (): number => Date.now() - started
    try {
      const options: GenerateOptions = {
        provider: route,
        model,
        maxTokens: 1,
        messages: [createUserMessage({
          content: [{ type: 'text', text: 'ping' }],
          source: { kind: 'plugin', plugin: 'dsh-x-model-hub' },
        })],
        signal: AbortSignal.timeout(timeoutMs),
      }
      let failure: LlmFailure | undefined
      for await (const chunk of stream(options)) {
        if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          failure = chunk.reason.failure
        }
      }
      return failure === undefined
        ? { route, ok: true, ms: elapsed() }
        : { route, ok: false, ms: elapsed(), code: failure.code, message: failure.message }
    } catch (error) {
      return { route, ok: false, ms: elapsed(), message: error instanceof Error ? error.message : String(error) }
    }
  }))
}

/**
 * One compiled route's probe plan: `stale` carries an immediate failure when
 * the route is not live in the llm registry, otherwise the route needs a real
 * probe. Plan order is the compiled order (primary first, fallbacks in order).
 */
export interface ProbePlanEntry {
  route: string
  stale?: ProbeResult
}

/**
 * Split a model's compiled routes into ones worth probing and ones already
 * answered. A refused reconcile leaves the registry on stale route names, and
 * probing those would surface a cryptic NO_ADAPTER — name the real cause (the
 * pending reconcile failure) instead.
 * @param doc - the resolved authoring section.
 * @param id - the model id to resolve.
 * @param liveRoutes - route ids currently registered on the llm seam.
 * @param reconcileError - the last reconcile failure, when one is pending.
 * @returns one plan entry per compiled route, in compiled order.
 * @throws Error when no compiled route lists the model.
 */
export function resolveProbeRoutes(
  doc: Pick<Config, 'providers' | 'models'>,
  id: string,
  liveRoutes: readonly string[],
  reconcileError: string | null = null,
): ProbePlanEntry[] {
  const compiled = Object.entries(compileRoutes(doc))
    .filter(([, profile]) => profile.models?.some(entry => entry.id === id))
    .map(([route]) => route)
  if (compiled.length === 0) throw new Error(`dsh-x-model-hub: no compiled route lists model "${id}"`)
  const live = new Set(liveRoutes)
  return compiled.map((route): ProbePlanEntry => {
    if (live.has(route)) return { route }
    return {
      route,
      stale: {
        route,
        ok: false,
        ms: 0,
        code: 'ROUTE_NOT_LIVE',
        message: reconcileError === null
          ? 'no adapter registered for this route — the compiled routes are not live'
          : `route not live: llm-pi-ai refused the compiled routes — ${reconcileError}`,
      },
    }
  })
}

/**
 * Validate and normalize one provider entry arriving from the page. A
 * declared `apiKeyEnv` must be an env-var-style reference (never a pasted
 * key), and a pasted API key becomes a credentials-seam write under that
 * reference — derived as `<KEY>_API_KEY` when the entry names none — so the
 * authoring document only ever stores the reference.
 * @param key - the provider key being saved.
 * @param value - the provider fields from the form.
 * @param apiKey - a pasted API key, when the form carried one.
 * @returns the entry to persist plus the credential write to issue first.
 * @throws Error when the declared reference is malformed.
 */
export function prepareProviderEntry(
  key: string,
  value: unknown,
  apiKey?: unknown,
): { entry: HubProvider; credential?: { ref: string; value: string } } {
  const entry = { ...(value as HubProvider) }
  if (entry.apiKeyEnv !== undefined) {
    try {
      credentialRef(entry.apiKeyEnv)
    } catch {
      throw new Error(
        `dsh-x-model-hub: "${entry.apiKeyEnv}" is not a credential reference (A-Z, 0-9, _ only)`
        + ' — paste the API key itself into the API Key field instead',
      )
    }
  }
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    const ref = entry.apiKeyEnv ?? deriveKeyRef(key)
    entry.apiKeyEnv = ref
    return { entry, credential: { ref, value: apiKey } }
  }
  return { entry }
}

/**
 * RPC gateway for the model-hub settings page. The HTTP `settings.*` surface
 * allowlists namespaces (`WEB_SETTINGS_NAMESPACES` in dsh-host-apiproxy) and
 * refuses this plugin's namespace, so the page talks to this service instead:
 * the gateway's SRC-mode claims are discovered by the Typert gateway from the
 * live service, no generated artifacts needed. Every write still goes through
 * the settings seam, keeping schema validation, persistence, hot reload, and
 * the `settings/document-updated` push the page subscribes to.
 *
 * Beyond plain document CRUD the gateway owns the page's linkage actions:
 * storing a pasted API key into the credentials seam (deriving the provider's
 * `<KEY>_API_KEY` reference), importing hand-written `llm-pi-ai` routes back
 * into the authoring layout, and setting the default model selection.
 */
export class ModelHubGateway extends TypertRemoteService {
  static inject = ['settings', 'credentials', 'llm']

  constructor(ctx: Context) {
    super(ctx, 'modelHub')
  }

  /**
   * Read the resolved authoring section plus linkage facts for the page.
   * @returns the redacted authoring document and its live linkage state.
   */
  @Remote('getDoc')
  async getDoc(): Promise<HubDocView> {
    const view = this.ctx.settings.describe({ redactSecrets: true }).find(descriptor => descriptor.ns === NS)
    const doc = (view?.value ?? {}) as Config
    const routeByModel: Record<string, string> = {}
    let chains: Record<string, string[]> = {}
    try {
      chains = compileChains(doc)
      for (const [route, profile] of Object.entries(compileRoutes(doc))) {
        for (const entry of profile.models ?? []) {
          // A multi-provider model is listed on every one of its routes; the
          // page pill names its PRIMARY route (the chain head).
          if (routeByModel[entry.id] === undefined) routeByModel[entry.id] = chains[entry.id]?.[0] ?? route
        }
      }
    } catch {
      // assertUsable refuses uncompilable writes, so this only names models
      // while a composition base disagrees — the page then shows no preview.
    }
    const credentials: HubDocView['credentials'] = {}
    await Promise.all(Object.entries(doc.providers ?? {}).map(async ([key, provider]) => {
      if (provider.apiKeyEnv === undefined) return
      let info
      try {
        info = await this.ctx.credentials.describe(credentialRef(provider.apiKeyEnv))
      } catch {
        // A malformed reference fails credentialRef() before any lookup.
        credentials[key] = { configured: false, valid: false }
        return
      }
      credentials[key] = { configured: info.configured, valid: true }
    }))
    const defaultModel = this.ctx.settings.get(AGENT_DEFAULT_NS) as HubDocView['defaultModel']
    return {
      providers: doc.providers ?? {},
      models: doc.models ?? {},
      writable: this.ctx.settings.writable,
      ...view?.revision === undefined ? {} : { revision: view.revision },
      routeByModel,
      chains,
      ...lastReconcileFailure === null ? {} : { reconcileError: lastReconcileFailure },
      ...defaultModel === undefined ? {} : { defaultModel },
      credentials,
    }
  }

  /**
   * Create or replace one provider entry; rejections surface as RPC errors.
   * A pasted API key is stored in the credentials seam before the document
   * write, so the reconcile that follows the write can already resolve it.
   * @param key - provider id to create or replace.
   * @param value - complete provider entry from the editor.
   * @param apiKey - optional write-only credential value.
   * @returns success after both credential and settings writes settle.
   */
  @Remote('saveProvider')
  async saveProvider(key: string, value: HubProvider, apiKey?: string): Promise<{ ok: true }> {
    const { entry, credential } = prepareProviderEntry(key, value, apiKey)
    if (credential !== undefined) await this.ctx.credentials.set(credentialRef(credential.ref), credential.value)
    await this.ctx.settings.mutate(NS, [{ op: 'set', path: ['providers', key], value: entry }])
    return { ok: true }
  }

  /**
   * Return the vendor preset table derived from the pi-ai catalog.
   * @returns presets in the page's stable vendor order.
   */
  @Remote('listPresets')
  listPresets(): { presets: ProviderPreset[] } {
    return { presets: listPresets() }
  }

  /**
   * Probe one model on every route it compiles to — primary first, fallbacks
   * in order — so a misconfigured credential, endpoint, protocol, or model id
   * surfaces here instead of mid-conversation. Probes are real minimal
   * requests and never throw; per-route failures land in the results. A
   * compiled route that is not live (a refused reconcile) answers immediately
   * with the pending reconcile failure instead of a cryptic NO_ADAPTER.
   * @param id - authored model id to probe.
   * @param timeoutMs - optional positive timeout for each route.
   * @returns one result per compiled placement, in failover order.
   */
  @Remote('probeModel')
  async probeModel(id: string, timeoutMs?: number): Promise<{ results: ProbeResult[] }> {
    const doc = (this.ctx.settings.get(NS) ?? {}) as Config
    const live = this.ctx.llm.listProviders().map(provider => provider.id)
    const plan = resolveProbeRoutes(doc, id, live, lastReconcileFailure)
    const timeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : PROBE_TIMEOUT_MS
    const pending = plan.filter(entry => entry.stale === undefined).map(entry => entry.route)
    const probed = await probeRoutes(options => this.ctx.llm.stream(options), id, pending, timeout)
    const byRoute = new Map(probed.map(result => [result.route, result]))
    return {
      results: plan.map((entry) => {
        if (entry.stale !== undefined) return entry.stale
        const result = byRoute.get(entry.route)
        if (result === undefined) throw new Error(`dsh-x-model-hub: probe omitted route "${entry.route}"`)
        return result
      }),
    }
  }

  /**
   * Remove one provider entry.
   * @param key - provider id to remove.
   * @returns success after the settings mutation settles.
   */
  @Remote('removeProvider')
  async removeProvider(key: string): Promise<{ ok: true }> {
    await this.ctx.settings.mutate(NS, [{ op: 'unset', path: ['providers', key] }])
    return { ok: true }
  }

  /**
   * Create or replace one model entry.
   * @param id - model id to create or replace.
   * @param value - complete model entry from the editor.
   * @returns success after the settings mutation settles.
   */
  @Remote('saveModel')
  async saveModel(id: string, value: HubModel): Promise<{ ok: true }> {
    await this.ctx.settings.mutate(NS, [{ op: 'set', path: ['models', id], value }])
    return { ok: true }
  }

  /**
   * Remove one model entry.
   * @param id - model id to remove.
   * @returns success after the settings mutation settles.
   */
  @Remote('removeModel')
  async removeModel(id: string): Promise<{ ok: true }> {
    await this.ctx.settings.mutate(NS, [{ op: 'unset', path: ['models', id] }])
    return { ok: true }
  }

  /**
   * Set the default model for future sessions. Any live registered route is
   * accepted (not only hub-compiled ones — the official adapters' routes are
   * legitimate defaults too); the reasoning effort resets to the provider's
   * default.
   * @param route - live provider route to select.
   * @param model - model id listed by that route.
   * @returns success after the default-model settings write settles.
   */
  @Remote('setDefaultModel')
  async setDefaultModel(route: string, model: string): Promise<{ ok: true }> {
    if (!this.ctx.llm.listProviders().some(provider => provider.id === route)) {
      throw new Error(`dsh-x-model-hub: "${route}" is not a registered provider route`)
    }
    if (!(await this.ctx.llm.listModels(route)).some(candidate => candidate.id === model)) {
      throw new Error(`dsh-x-model-hub: route "${route}" does not list model "${model}"`)
    }
    await this.ctx.settings.replace(AGENT_DEFAULT_NS, { provider: route, model })
    return { ok: true }
  }

  /**
   * Import hand-written `llm-pi-ai` routes (settings user layer merged over
   * the composition base) into the authoring layout. Additive only: managed
   * routes and existing entries are left untouched, and anything that cannot
   * round-trip faithfully is skipped with a note.
   * @returns added provider/model ids and one note per skipped entry.
   */
  @Remote('importFromPiAi')
  async importFromPiAi(): Promise<ImportOutcome> {
    const descriptor = this.ctx.settings.describe().find(candidate => candidate.ns === PI_AI_NS)
    if (descriptor === undefined) {
      throw new Error('dsh-x-model-hub: the "llm-pi-ai" settings namespace is not registered')
    }
    const layerProviders = (layer: unknown): Record<string, PiAiProviderProfile> =>
      ((layer as { providers?: Record<string, PiAiProviderProfile> } | undefined)?.providers ?? {})
    const base = layerProviders(descriptor.base)
    const user = layerProviders(descriptor.user)
    const routes: Record<string, PiAiProviderProfile> = {}
    for (const route of new Set([...Object.keys(base), ...Object.keys(user)])) {
      const merged = mergeRouteLayers(base[route], user[route])
      if (merged !== undefined) routes[route] = merged
    }
    const doc = (this.ctx.settings.get(NS) ?? {}) as Config
    const plan = planImport(routes, {
      managedRoutes: doc._routes ?? [],
      existingProviders: doc.providers ?? {},
      existingModels: doc.models ?? {},
    })
    const ops: SettingsPathOp[] = [
      ...Object.entries(plan.providers).map(([key, provider]): SettingsPathOp => ({ op: 'set', path: ['providers', key], value: provider })),
      ...Object.entries(plan.models).map(([id, model]): SettingsPathOp => ({ op: 'set', path: ['models', id], value: model })),
    ]
    if (ops.length > 0) await this.ctx.settings.mutate(NS, ops)
    return { providers: Object.keys(plan.providers), models: Object.keys(plan.models), notes: plan.notes }
  }
}

/**
 * Mount the authoring namespace, the wire gateway, and reconcile the generated
 * routes on attach and on every committed change. The framework contains
 * inject-fiber rejections, so reconcile passes report failures through the
 * logger and keep the last good generated state.
 * @param ctx - plugin context.
 * @param config - validated entry configuration from the cordis patch.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let settings: SettingsProvider | undefined
  lastReconcileFailure = null

  /**
   * One contained reconcile pass: failures keep the last good generated
   * routes, are logged, and are remembered for the page's getDoc banner.
   */
  const reconcile = async (failure: string): Promise<void> => {
    try {
      if (settings === undefined) throw new Error('dsh-x-model-hub: settings service is not available')
      await reconcileRoutes(settings, current())
      lastReconcileFailure = null
    } catch (error) {
      lastReconcileFailure = error instanceof Error ? error.message : String(error)
      ctx.logger.error('dsh-x-model-hub: %s', failure)
      ctx.logger.error(error)
    }
  }

  installSettingsSection(ctx, NS, Config, config, {
    validate: assertUsable,
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      if (settings === undefined) return
      void reconcile('keeping the previously generated routes after a refused update')
    },
  })

  ctx.plugin(ModelHubGateway)

  // Ordered cross-provider fallback. llm-retry (mounted by the base bundle,
  // ahead of this plugin) spends the failed route's own retry budget first
  // and delegates with next() on exhaustion or an out-of-policy code; the
  // listener below then owns recovery, and the re-issued attempt picks up
  // the next compiled route from the pending swap. The swap is the only
  // state: the chain walk derives from the failed provider, and the loop's
  // own request/header change keeps later steps on the new route — failover
  // is sticky for the rest of the session, and a fresh session starts from
  // the selection again. No custom session event is needed: the failure is
  // durable in llm/retry and the swap in request/header.
  const pendingSwaps = new WeakMap<Agent, Map<string, string>>()

  ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure, signal }, next) => {
    if (signal.aborted) return next()
    let target: string | undefined
    try {
      target = nextFallbackRoute(compileChains(current()), agent.session.requestHeader()?.config.model, provider, failure.code)
    } catch (error) {
      // A doc the validator would refuse can still arrive via the composition
      // base; a broken chain table must never break recovery dispatch.
      ctx.logger.error('dsh-x-model-hub: failed to compile fallback chains; delegating recovery')
      ctx.logger.error(error)
      return next()
    }
    if (target === undefined) return next()
    let pending = pendingSwaps.get(agent)
    if (pending === undefined) {
      pending = new Map()
      pendingSwaps.set(agent, pending)
    }
    pending.set(`${turn}:${step}`, target)
    ctx.logger.warn(
      'dsh-x-model-hub: route "%s" failed (%s); failing the step over to "%s"',
      provider,
      failure.code,
      target,
    )
    return { kind: 'retry' }
  })

  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const resolved = await next()
    const pending = pendingSwaps.get(agent)
    if (pending === undefined) return resolved
    const key = `${turn}:${step}`
    const target = pending.get(key)
    if (target === undefined) return resolved
    pending.delete(key)
    return { ...resolved, provider: target }
  })

  ctx.inject(['settings'], (injected) => {
    settings = injected.settings
    if (!settings.describe().some(descriptor => descriptor.ns === PI_AI_NS)) {
      throw new Error(
        'dsh-x-model-hub: the "llm-pi-ai" settings namespace is not registered —'
        + ' this plugin compiles into the stock pi-ai adapter, so @deepseek-ai/dsh-llm-pi-ai must be mounted',
      )
    }
    // Inject-fiber rejections are contained by the framework, so the first
    // pass reports loudly itself: a boot with silently absent routes is the
    // failure mode this exists to prevent.
    void reconcile('initial reconcile failed; no routes were generated')
  })
}
