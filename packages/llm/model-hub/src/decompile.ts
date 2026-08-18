/**
 * Decompile stock `llm-pi-ai` provider routes back into the model-centered
 * authoring layout — the inverse of compile.ts, used to import hand-written
 * routes (from the settings user layer or the composition base) into the hub.
 *
 * Import is additive and loss-averse: routes the hub itself generated (the
 * `_routes` ledger) are never re-imported, existing hub entries are never
 * overwritten, and anything that cannot round-trip faithfully (catalog routes
 * without an explicit model list, routes without a determinable protocol or
 * endpoint, protocol groups whose endpoint disagrees with the provider they
 * would join) is skipped with a machine-readable note the UI can localize.
 *
 * @module @deepseek-ai/dsh-model-hub/decompile
 */

import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { HubModel, HubProvider } from './compile.ts'
import { ROUTE_SEPARATOR } from './compile.ts'

/** Why one route or model was not imported; the UI localizes these codes. */
export type ImportSkipReason =
  /** The route lists no models of its own (it serves an installed catalog). */
  | 'catalog-route'
  /** Neither the route profile nor a `provider~api` name says which protocol its models speak. */
  | 'unknown-protocol'
  /** The profile names no endpoint and a hub provider requires one. */
  | 'no-endpoint'
  /** The route's endpoint disagrees with the provider its models would join. */
  | 'endpoint-conflict'
  /** A model with this id is already declared in the hub. */
  | 'duplicate-model'

/** One skipped route or model, pairing its key with a {@link ImportSkipReason}. */
export interface ImportNote {
  /** Route name or model id that was skipped. */
  subject: string
  /** Machine-readable skip reason. */
  reason: ImportSkipReason
}

/** The additive result of planning an import. */
export interface ImportPlan {
  /** New provider entries to add (existing hub providers are never rewritten). */
  providers: Record<string, HubProvider>
  /** New model entries to add. */
  models: Record<string, HubModel>
  /** Every skipped route or model with its reason. */
  notes: ImportNote[]
}

/** Inputs {@link planImport} needs beyond the routes themselves. */
export interface ImportContext {
  /** Route keys the hub generated earlier (its `_routes` ledger); skipped silently. */
  managedRoutes?: readonly string[]
  /** Provider keys already declared in the hub; models may join them when the endpoint agrees. */
  existingProviders?: Record<string, HubProvider>
  /** Model ids already declared in the hub. */
  existingModels?: Record<string, HubModel>
}

/**
 * Derive the credential reference a provider's pasted API key is stored under,
 * mirroring the stock `<ROUTE>_API_KEY` convention upper-cased for the
 * provider key. The result always matches the seam's `credentialRef` pattern.
 * @param providerKey - the hub provider key (kebab-case by convention).
 * @returns the derived environment-variable-style reference.
 */
export function deriveKeyRef(providerKey: string): string {
  const normalized = providerKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const head = /^[A-Z_]/.test(normalized) ? normalized : `K_${normalized}`
  return `${head}_API_KEY`
}

/**
 * Merge one route's composition-base and user-layer profiles into the single
 * effective hand-written profile: scalar fields prefer the user layer, nested
 * maps merge leaf-wise, and the `models` list replaces wholesale (matching the
 * settings seam's layer semantics).
 * @param base - the route's base-layer profile, when one exists.
 * @param user - the route's user-layer profile, when one exists.
 * @returns the merged profile, or undefined when neither layer names the route.
 */
export function mergeRouteLayers(
  base: PiAiProviderProfile | undefined,
  user: PiAiProviderProfile | undefined,
): PiAiProviderProfile | undefined {
  if (base === undefined) return user
  if (user === undefined) return base
  return {
    ...base,
    ...user,
    ...base.headers === undefined && user.headers === undefined
      ? {}
      : { headers: { ...base.headers, ...user.headers } },
    ...base.compat === undefined && user.compat === undefined
      ? {}
      : { compat: { ...base.compat, ...user.compat } },
    ...user.models === undefined ? {} : { models: user.models },
  }
}

/**
 * Plan the import of hand-written `llm-pi-ai` routes into the authoring
 * layout. Pure: the gateway supplies the merged routes and the current hub
 * document, and applies the returned plan through the settings seam.
 * @param routes - effective hand-written routes keyed by route name.
 * @param context - managed route keys and existing hub entries to work around.
 * @returns the additions plus one note per skipped route or model.
 */
export function planImport(
  routes: Record<string, PiAiProviderProfile>,
  context: ImportContext = {},
): ImportPlan {
  const managed = new Set(context.managedRoutes ?? [])
  const existingProviders = context.existingProviders ?? {}
  const existingModels = context.existingModels ?? {}
  const plan: ImportPlan = { providers: {}, models: {}, notes: [] }

  for (const [route, profile] of Object.entries(routes)) {
    if (managed.has(route)) continue
    if (profile.models === undefined || profile.models.length === 0) {
      plan.notes.push({ subject: route, reason: 'catalog-route' })
      continue
    }
    const separator = route.indexOf(ROUTE_SEPARATOR)
    const providerKey = separator === -1 ? route : route.slice(0, separator)
    const api = profile.api ?? (separator === -1 ? undefined : route.slice(separator + 1))
    if (api === undefined) {
      plan.notes.push({ subject: route, reason: 'unknown-protocol' })
      continue
    }
    if (profile.baseURL === undefined || profile.baseURL.length === 0) {
      plan.notes.push({ subject: route, reason: 'no-endpoint' })
      continue
    }
    const knownProvider = plan.providers[providerKey] ?? existingProviders[providerKey]
    if (knownProvider !== undefined && knownProvider.baseURL !== profile.baseURL) {
      plan.notes.push({ subject: route, reason: 'endpoint-conflict' })
      continue
    }

    const models: Record<string, HubModel> = {}
    for (const entry of profile.models) {
      const planned = plan.models[entry.id]
      if (planned !== undefined) {
        // The same id on a second imported route becomes an ordered fallback
        // when it names another placement; a true duplicate is skipped.
        const samePlacement = planned.provider === providerKey && planned.api === api
        const alreadyFallback = planned.fallbacks?.some(fallback => fallback.provider === providerKey && fallback.api === api) ?? false
        if (!samePlacement && !alreadyFallback) {
          planned.fallbacks = [...(planned.fallbacks ?? []), { provider: providerKey, api }]
        } else {
          plan.notes.push({ subject: entry.id, reason: 'duplicate-model' })
        }
        continue
      }
      if (entry.id in existingModels || entry.id in models) {
        plan.notes.push({ subject: entry.id, reason: 'duplicate-model' })
        continue
      }
      const model: HubModel = { provider: providerKey, api }
      if (entry.name !== undefined) model.name = entry.name
      if (entry.contextWindow !== undefined) model.contextWindow = entry.contextWindow
      if (entry.maxTokens !== undefined) model.maxTokens = entry.maxTokens
      if (entry.input !== undefined && entry.input.length > 0) model.input = [...entry.input]
      if (entry.reasoningEfforts !== undefined) model.reasoningEfforts = entry.reasoningEfforts
      if (entry.compat !== undefined) model.compat = { ...entry.compat }
      models[entry.id] = model
    }
    if (Object.keys(models).length === 0) {
      // Every model was already declared (each logged its own note); importing
      // the provider alone would add nothing.
      continue
    }

    if (knownProvider === undefined) {
      const provider: HubProvider = { baseURL: profile.baseURL }
      if (profile.displayName !== undefined && profile.displayName !== route) provider.displayName = profile.displayName
      if (profile.apiKeyEnv !== undefined) provider.apiKeyEnv = profile.apiKeyEnv
      if (profile.headers !== undefined && Object.keys(profile.headers).length > 0) provider.headers = { ...profile.headers }
      if (profile.compat !== undefined) provider.compat = { ...profile.compat }
      if (profile.defaultInput !== undefined && profile.defaultInput.length > 0) provider.defaultInput = [...profile.defaultInput]
      if (profile.defaultContextWindow !== undefined) provider.defaultContextWindow = profile.defaultContextWindow
      if (profile.defaultMaxTokens !== undefined) provider.defaultMaxTokens = profile.defaultMaxTokens
      plan.providers[providerKey] = provider
    }
    Object.assign(plan.models, models)
  }
  return plan
}
