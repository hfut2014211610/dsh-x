/**
 * Shared shape mirrors of `dsh-x-model-hub`'s authoring section. Redeclared
 * here on purpose: client bundles may not import another plugin's runtime
 * (the module table cannot answer it), and the settings namespace is the
 * collaboration seam. Field-for-field copy of
 * personal/plugins/dsh-x-model-hub/src/compile.ts — keep in sync.
 */

/** One supplier of models: endpoint, credential reference, and per-route defaults. */
export interface HubProvider {
  /** Vendor preset key this entry was created from (filters the model preset list). */
  preset?: string
  displayName?: string
  baseURL?: string
  /** Per-protocol endpoint override (see compile.ts — the Anthropic SDK appends /v1/messages itself). */
  endpoints?: Record<string, string>
  apiKeyEnv?: string
  headers?: Record<string, string>
  compat?: { thinkingFormat?: string; supportsReasoningEffort?: boolean }
  defaultInput?: string[]
  defaultContextWindow?: number
  defaultMaxTokens?: number
}

/** One additional supplier a model falls back to (mirrors compile.ts — keep in sync). */
export interface HubModelFallback {
  provider: string
  api: string
}

/** One model declaration: who serves it, which wire protocol, and its capacities. */
export interface HubModel {
  provider: string
  api: string
  /** Ordered fallback suppliers; the model is also listed on each of their routes. */
  fallbacks?: HubModelFallback[]
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoningEfforts?: Record<string, string | null> | false
  compat?: { thinkingFormat?: string; supportsReasoningEffort?: boolean }
}

/** The `dsh-x-model-hub` settings namespace document. */
export interface HubDoc {
  providers?: Record<string, HubProvider>
  models?: Record<string, HubModel>
  _routes?: string[]
}

/** The `agent-default-model` selection, mirrored from the host gateway. */
export interface DefaultModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Credential-seam state of one provider's reference: resolvable or not, ref well-formed or not. */
export interface CredentialState {
  configured: boolean
  valid: boolean
}

/** Why the host skipped one route or model on import (mirrors decompile.ts — keep in sync). */
export type ImportSkipReason = 'catalog-route' | 'unknown-protocol' | 'no-endpoint' | 'endpoint-conflict' | 'duplicate-model'

/** One skipped route or model from an import. */
export interface ImportNote {
  subject: string
  reason: ImportSkipReason
}

/** The host gateway's import summary. */
export interface ImportOutcome {
  providers: string[]
  models: string[]
  notes: ImportNote[]
}

/** One model a vendor preset offers (mirrors presets.ts — keep in sync). */
export interface PresetModel {
  id: string
  name?: string
  api: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoningEfforts?: Record<string, string | null> | false
}

/** One vendor preset: suggested provider key, label, endpoint, models. */
export interface ProviderPreset {
  key: string
  label: string
  baseURL: string
  models: PresetModel[]
}

/** One route's probe outcome (mirrors the host's probeModel result). */
export interface ProbeResult {
  route: string
  ok: boolean
  ms: number
  code?: string
  message?: string
}
