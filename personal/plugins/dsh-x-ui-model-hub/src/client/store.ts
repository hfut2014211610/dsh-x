/**
 * Model-hub settings page store: reads and writes the `dsh-x-model-hub`
 * authoring section through the host plugin's `modelHub/*` RPC gateway. The
 * HTTP `settings.*` surface allowlists namespaces and refuses this one, so
 * the page cannot use `settings.describe/mutate` directly; the gateway is the
 * page's wire seam, and every write still lands on the settings document
 * (schema validation, persistence, and the `settings/document-updated` push
 * included).
 *
 * The pure mappings (form ⇄ document, compiled-route preview) are exported
 * for unit tests.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { CredentialState, DefaultModelSelection, HubModel, HubProvider, ImportOutcome, ProbeResult, ProviderPreset } from './types.ts'

/** The namespace this page edits. */
export const HUB_NS = 'dsh-x-model-hub'

/** Minimal RPC face the page needs (the connection's rpc channel). */
export interface HubRpc {
  call(path: string, endpoint: string, payload: { args: Record<string, unknown> }): Promise<HubRpcResult>
}

/** RPC settlement shape. */
export type HubRpcResult = { ok: true; value: unknown } | { ok: false; error: { message: string } }

/** The gateway's getDoc payload. */
interface HubDocPayload {
  providers: Record<string, HubProvider>
  models: Record<string, HubModel>
  writable: boolean
  revision?: number
  routeByModel?: Record<string, string>
  chains?: Record<string, string[]>
  reconcileError?: string
  defaultModel?: DefaultModelSelection
  credentials?: Record<string, CredentialState>
}

/** Wire protocols a hand-declared model may speak (stock adapter's table). */
export const PROTOCOL_CHOICES = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

/** Selectable thinking levels offered in the model editor. */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Page snapshot. */
export interface ModelHubState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unmounted'
  /** Whole-load or write failure text. */
  error: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  providers: Record<string, HubProvider>
  models: Record<string, HubModel>
  /** Settings document revision, echoed as expectedRevision on writes. */
  revision: number | undefined
  /** Host-compiled route per model id (authoritative over the client preview). */
  routeByModel: Record<string, string>
  /** Ordered fallback chain per multi-provider model id. */
  chains: Record<string, string[]>
  /** Last route-generation failure on the host, while routes lag the document. */
  reconcileError: string | null
  /** The default selection for future sessions, when set. */
  defaultModel: DefaultModelSelection | null
  /** Credential-seam state per provider that names a reference. */
  credentials: Record<string, CredentialState>
  /** Vendor presets for the editors' dropdowns (from the pi-ai catalog). */
  presets: ProviderPreset[]
  /** Latest probe outcome per model id. */
  probeResults: Record<string, ProbeResult[]>
  /** Probe in flight per model id. */
  probing: Record<string, boolean>
}

/** Human text for a rejected wire call. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Client mirror of the host's credential-reference derivation (decompile.ts —
 * keep in sync), used only to preview where a pasted API key will be stored.
 * @param providerKey - the provider key being edited.
 * @returns the derived reference name.
 */
export function deriveKeyRef(providerKey: string): string {
  const normalized = providerKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const head = /^[A-Z_]/.test(normalized) ? normalized : `K_${normalized}`
  return `${head}_API_KEY`
}

/**
 * The compiled route name for one model, mirroring the host compiler's
 * deterministic rule: a provider whose placements (primary or fallback, across
 * every declared model) speak a single protocol keeps its bare key; each extra
 * protocol group gets a `provider~api` route.
 * @param models - every declared model (with the candidate edit applied).
 * @param provider - the model's provider key.
 * @param api - the model's protocol.
 * @returns the route the model lands on.
 */
export function routeNameFor(
  models: Record<string, Pick<HubModel, 'provider' | 'api' | 'fallbacks'>>,
  provider: string,
  api: string,
): string {
  const apis = new Set<string>()
  for (const model of Object.values(models)) {
    if (model.provider === provider) apis.add(model.api)
    for (const fallback of model.fallbacks ?? []) {
      if (fallback.provider === provider) apis.add(fallback.api)
    }
  }
  return apis.size > 1 ? `${provider}~${api}` : provider
}

/** Provider ids still referenced by at least one model. */
export function providersInUse(models: Record<string, HubModel>): ReadonlySet<string> {
  return new Set(Object.values(models).map(model => model.provider))
}

/** The page controller (one per settings surface). */
export class ModelHubStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelHubState> = createSnapshotStore<ModelHubState>({
    status: 'idle',
    error: null,
    writable: false,
    providers: {},
    models: {},
    revision: undefined,
    routeByModel: {},
    chains: {},
    reconcileError: null,
    defaultModel: null,
    credentials: {},
    presets: [],
    probeResults: {},
    probing: {},
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param rpc - the connection's RPC channel (the `modelHub/*` gateway lives behind it).
   */
  constructor(private readonly rpc: HubRpc) {}

  /**
   * Refresh the page snapshot from the gateway. A failure keeps the last good
   * rows and surfaces the error.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { if (s.status !== 'ready') s.status = 'loading' })
    let result: HubRpcResult
    try {
      result = await this.rpc.call('/api', 'modelHub/getDoc', { args: {} })
    } catch (error) {
      if (generation === this.generation) {
        this.store.update((s) => { s.status = 'error'; s.error = messageOf(error) })
      }
      return
    }
    if (!result.ok) {
      if (generation === this.generation) {
        // An unclaimed endpoint means the host plugin (and its gateway) is not
        // mounted; anything else is a genuine failure worth showing verbatim.
        const unmounted = /unknown|unclaimed|not found|no endpoint/i.test(result.error.message)
        this.store.update((s) => {
          s.status = unmounted ? 'unmounted' : 'error'
          s.error = unmounted ? null : result.error.message
        })
      }
      return
    }
    // Presets change only with the host build; fetch them once per page.
    let presets = this.store.getSnapshot().presets
    if (presets.length === 0) {
      try {
        const presetsResult = await this.rpc.call('/api', 'modelHub/listPresets', { args: {} })
        if (presetsResult.ok) presets = (presetsResult.value as { presets: ProviderPreset[] }).presets ?? []
      } catch {
        // A preset failure never blocks the page: the editors simply offer "custom".
      }
    }
    if (generation !== this.generation) return
    // A payload that doesn't match the gateway's shape must degrade to the
    // error state, never hang the page on 'loading'.
    try {
      const payload = result.value as HubDocPayload
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.writable = payload.writable
        s.providers = payload.providers ?? {}
        s.models = payload.models ?? {}
        s.revision = payload.revision
        s.routeByModel = payload.routeByModel ?? {}
        s.chains = payload.chains ?? {}
        s.reconcileError = payload.reconcileError ?? null
        s.defaultModel = payload.defaultModel ?? null
        s.credentials = payload.credentials ?? {}
        s.presets = presets
      })
    } catch (error) {
      this.store.update((s) => { s.status = 'error'; s.error = messageOf(error) })
    }
  }

  /**
   * Invoke one gateway write and reload. Row-level failures return their
   * message for the editor to show; nothing throws.
   * @param endpoint - the gateway method suffix (e.g. `saveProvider`).
   * @param args - the wire arguments.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  private async callWrite(endpoint: string, args: Record<string, unknown>): Promise<string | undefined> {
    let result: HubRpcResult
    try {
      result = await this.rpc.call('/api', `modelHub/${endpoint}`, { args })
    } catch (error) {
      return messageOf(error)
    }
    if (!result.ok) return result.error.message
    await this.load()
    return undefined
  }

  /**
   * Create or replace one provider entry.
   * @param key - provider id (immutable once created).
   * @param value - the provider fields.
   * @param apiKey - a pasted API key to store in the credentials seam first.
   * @returns the failure message, or undefined on success.
   */
  saveProvider(key: string, value: HubProvider, apiKey?: string): Promise<string | undefined> {
    return this.callWrite('saveProvider', { key, value, ...apiKey === undefined || apiKey.length === 0 ? {} : { apiKey } })
  }

  /**
   * Remove one provider entry. The caller refuses removal while a model still
   * references it ({@link providersInUse}); the host validator is the backstop.
   * @param key - provider id.
   * @returns the failure message, or undefined on success.
   */
  removeProvider(key: string): Promise<string | undefined> {
    return this.callWrite('removeProvider', { key })
  }

  /**
   * Remove one model entry.
   * @param id - model id.
   * @returns the failure message, or undefined on success.
   */
  removeModel(id: string): Promise<string | undefined> {
    return this.callWrite('removeModel', { id })
  }

  /**
   * Import hand-written `llm-pi-ai` routes into the authoring layout.
   * @returns the import summary, or the failure message.
   */
  async importFromPiAi(): Promise<{ outcome?: ImportOutcome; error?: string }> {
    let result: HubRpcResult
    try {
      result = await this.rpc.call('/api', 'modelHub/importFromPiAi', { args: {} })
    } catch (error) {
      return { error: messageOf(error) }
    }
    if (!result.ok) return { error: result.error.message }
    await this.load()
    return { outcome: result.value as ImportOutcome }
  }

  /**
   * Set the default model for future sessions.
   * @param route - the compiled route the model lives on.
   * @param model - the model id.
   * @returns the failure message, or undefined on success.
   */
  setDefaultModel(route: string, model: string): Promise<string | undefined> {
    return this.callWrite('setDefaultModel', { route, model })
  }

  /**
   * Probe one model on every route it compiles to. The outcome (or the wire
   * failure, as a route-less single result) lands in `probeResults[id]`.
   * @param id - the model id.
   * @returns nothing; read the snapshot.
   */
  async probe(id: string): Promise<void> {
    this.store.update((s) => {
      s.probing[id] = true
      delete s.probeResults[id]
    })
    const settle = (results: ProbeResult[]): void => {
      this.store.update((s) => {
        delete s.probing[id]
        s.probeResults[id] = results
      })
    }
    try {
      const result = await this.rpc.call('/api', 'modelHub/probeModel', { args: { id } })
      if (result.ok) settle((result.value as { results: ProbeResult[] }).results)
      else settle([{ route: '', ok: false, ms: 0, message: result.error.message }])
    } catch (error) {
      settle([{ route: '', ok: false, ms: 0, message: messageOf(error) }])
    }
  }

  /**
   * Create or replace one model entry.

  /**
   * Create or replace one model entry.
   * @param id - model id (immutable once created).
   * @param value - the model fields.
   * @returns the failure message, or undefined on success.
   */
  saveModel(id: string, value: HubModel): Promise<string | undefined> {
    return this.callWrite('saveModel', { id, value })
  }
}
