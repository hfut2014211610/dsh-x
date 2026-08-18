/**
 * JSON-safe Model Hub Remote vocabulary. The public `./types` subpath is the
 * stable import surface shared by generated clients and host consumers.
 *
 * @module @deepseek-ai/dsh-model-hub/types
 */

import type { HubModel, HubProvider } from './compile.ts'
import type { ImportNote } from './decompile.ts'

export type {
  HubModel,
  HubModelFallback,
  HubProvider,
  PiAiCompatProfile,
} from './compile.ts'
export type {
  ImportContext,
  ImportNote,
  ImportPlan,
  ImportSkipReason,
} from './decompile.ts'
export type { PresetModel, ProviderPreset } from './presets.ts'

/**
 * Resolved authoring document and linkage state rendered by the settings
 * page.
 */
export interface HubDocView {
  /** Provider declarations keyed by provider id. */
  providers: Record<string, HubProvider>
  /** Model declarations keyed by model id. */
  models: Record<string, HubModel>
  /** Whether the active settings layer accepts edits. */
  writable: boolean
  /** Compare-and-set revision of the active settings layer. */
  revision?: number
  /** Compiled route name per model id; empty while the section does not compile. */
  routeByModel: Record<string, string>
  /** Ordered fallback chain per multi-provider model id, primary route first. */
  chains: Record<string, string[]>
  /** Last failed reconcile message while generated routes lag the authoring section. */
  reconcileError?: string
  /** Current `agent-default-model` selection when that namespace is registered. */
  defaultModel?: { provider: string; model: string; reasoningEffort?: string }
  /** Credential state per provider that names a credential reference. */
  credentials: Record<string, { configured: boolean; valid: boolean }>
}

/** Result of importing hand-written `llm-pi-ai` routes into the hub. */
export interface ImportOutcome {
  /** Provider keys added to the authoring section. */
  providers: string[]
  /** Model ids added to the authoring section. */
  models: string[]
  /** Skipped routes or models with machine-readable reasons. */
  notes: ImportNote[]
}

/** Outcome of probing one compiled provider route. */
export interface ProbeResult {
  /** Compiled route name. */
  route: string
  /** Whether the route completed a minimal request. */
  ok: boolean
  /** End-to-end probe duration in milliseconds. */
  ms: number
  /** Normalized adapter failure code. */
  code?: string
  /** Human-readable failure detail. */
  message?: string
}
