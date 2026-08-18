/**
 * Mainstream-vendor presets for the model-hub settings page, derived at
 * runtime from pi-ai's installed catalog (`dsh-llm-pi-ai` builtins) so model
 * ids, context windows, and thinking levels track the pinned upstream instead
 * of drifting in a hand-maintained table. Two vendors need an overlay: Qwen
 * (no pure DashScope builtin exists — only multi-vendor token plans) and
 * Gemini (the builtin speaks `google-generative-ai`, which hand-declared
 * routes cannot name — the preset repoints at Google's OpenAI-compatible
 * endpoint instead). Everything remains editable after autofill; "custom" is
 * simply the empty manual form.
 *
 * @module @deepseek-ai/dsh-model-hub/presets
 */

import { catalogModels } from '@deepseek-ai/dsh-llm-pi-ai'

/** One model a preset offers, ready to land in a {@link HubModel} entry. */
export interface PresetModel {
  id: string
  name?: string
  api: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoningEfforts?: Record<string, string | null> | false
}

/** One vendor preset: suggested provider key, label, endpoint, and its models. */
export interface ProviderPreset {
  key: string
  label: string
  baseURL: string
  models: PresetModel[]
}

/** Thinking levels offered for a catalog reasoning model without its own level map (identity wire spelling). */
const DEFAULT_EFFORTS: Record<string, string | null> = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** One catalog-backed vendor entry in the preset table. */
interface VendorSpec {
  key: string
  label: string
  /** pi-ai builtin provider id the preset derives from. */
  catalogId: string
  /** Endpoint override (the catalog endpoint speaks another protocol). */
  baseURLOverride?: string
  /** Force every derived model onto this wire protocol. */
  apiOverride?: string
  /** Keep only matching model ids (catalogs ship dated duplicates and preview rows). */
  filter?: (id: string) => boolean
}

/** Dated catalog duplicates look like `…-20251001` / `…-2025-08-05` / `…-10-2025`; the alias rows are the ones to offer. */
const DATED_OR_PREVIEW = /-20\d{6}$|-20\d{2}(-\d{2}){0,2}$|-\d{2}-20\d{2}$|preview/

const VENDORS: readonly VendorSpec[] = [
  { key: 'deepseek', label: 'DeepSeek', catalogId: 'deepseek' },
  { key: 'kimi', label: 'Kimi（Moonshot）', catalogId: 'moonshotai-cn' },
  { key: 'mimo', label: 'MiMo（小米）', catalogId: 'xiaomi' },
  { key: 'claude', label: 'Claude（Anthropic）', catalogId: 'anthropic', filter: id => !DATED_OR_PREVIEW.test(id) },
  {
    key: 'glm',
    label: 'GLM（智谱）',
    catalogId: 'zai-coding-cn',
  },
  { key: 'minimax', label: 'MiniMax', catalogId: 'minimax-cn' },
  {
    key: 'gpt',
    label: 'GPT（OpenAI）',
    catalogId: 'openai',
    filter: id => /^(gpt-5|gpt-4\.1|gpt-4o|o[34])/.test(id) && !DATED_OR_PREVIEW.test(id),
  },
  {
    key: 'gemini',
    label: 'Gemini（Google）',
    catalogId: 'google',
    // Hand-declared routes cannot name google-generative-ai; Google serves the
    // same models over an OpenAI-compatible endpoint.
    baseURLOverride: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiOverride: 'openai-completions',
    filter: id => id.startsWith('gemini-') && !DATED_OR_PREVIEW.test(id),
  },
  { key: 'grok', label: 'Grok（xAI）', catalogId: 'xai' },
]

/**
 * Qwen has no pure-vendor builtin (only multi-vendor token plans), so the
 * preset is the one hand-written table: DashScope's OpenAI-compatible
 * endpoint with conservative capacities — adjust to the actual deployment.
 */
const QWEN: ProviderPreset = {
  key: 'qwen',
  label: 'Qwen（阿里百炼）',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: [
    { id: 'qwen3-max', api: 'openai-completions', contextWindow: 262144, maxTokens: 32768, reasoningEfforts: false },
    { id: 'qwen-plus', api: 'openai-completions', contextWindow: 131072, maxTokens: 8192, reasoningEfforts: false },
    { id: 'qwen-flash', api: 'openai-completions', contextWindow: 131072, maxTokens: 8192, reasoningEfforts: false },
    { id: 'qwq-plus', api: 'openai-completions', contextWindow: 131072, maxTokens: 8192, reasoningEfforts: { ...DEFAULT_EFFORTS } },
  ],
}

/** Shape of one pi-ai catalog model as read here (the fields presets derive from). */
interface CatalogModelLike {
  id: string
  name?: string
  api: string
  baseUrl?: string
  reasoning?: boolean
  input?: readonly string[]
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null>
}

/**
 * Derive one catalog-backed vendor preset. A vendor whose catalog is absent
 * from the pinned pi-ai build is dropped rather than failing the table.
 */
function deriveVendor(spec: VendorSpec): ProviderPreset | undefined {
  const models = [...catalogModels(spec.catalogId).values()] as CatalogModelLike[]
  const picked = models.filter(model => spec.filter === undefined || spec.filter(model.id))
  const first = picked.at(0)
  if (first === undefined) return undefined
  return {
    key: spec.key,
    label: spec.label,
    baseURL: spec.baseURLOverride ?? first.baseUrl ?? '',
    models: picked.map((model) => {
      const preset: PresetModel = {
        id: model.id,
        api: spec.apiOverride ?? model.api,
      }
      if (model.name !== undefined && model.name !== model.id) preset.name = model.name
      if (model.contextWindow !== undefined) preset.contextWindow = model.contextWindow
      if (model.maxTokens !== undefined) preset.maxTokens = model.maxTokens
      if (model.input !== undefined && model.input.length > 0) preset.input = [...model.input]
      preset.reasoningEfforts = model.reasoning === true ? { ...(model.thinkingLevelMap ?? DEFAULT_EFFORTS) } : false
      return preset
    }),
  }
}

/**
 * The preset table offered to the settings page, in vendor order. Derived
 * once per process; the catalog is a build-time constant.
 * @returns presets whose catalog source exists in the pinned pi-ai build.
 */
export function listPresets(): ProviderPreset[] {
  const derived = VENDORS.map(deriveVendor).filter((preset): preset is ProviderPreset => preset !== undefined)
  // Qwen goes where the vendor list reads naturally: after Claude, before GLM.
  const at = derived.findIndex(preset => preset.key === 'glm')
  derived.splice(at === -1 ? derived.length : at, 0, QWEN)
  return derived
}

/**
 * Find the preset a provider was created from.
 * @param provider - provider entry carrying an optional preset marker.
 * @param presets - available vendor presets.
 * @returns the matching preset, or undefined for a custom provider.
 */
export function presetOf(provider: { preset?: string } | undefined, presets: readonly ProviderPreset[]): ProviderPreset | undefined {
  return provider?.preset === undefined ? undefined : presets.find(preset => preset.key === provider.preset)
}
