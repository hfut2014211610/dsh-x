/**
 * Model editor modal: create or edit one model entry — a preset dropdown
 * autofills everything the catalog knows (only "custom" is fully manual),
 * then provider, wire protocol, ordered fallback providers, capacities,
 * modalities, and selectable thinking levels stay editable. The compiled
 * route chain previews live. The editor owns its Modal so the action row
 * lands in the dialog footer.
 */

import { useState } from 'react'
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import { EFFORT_LEVELS, PROTOCOL_CHOICES, routeNameFor } from './store.ts'
import type { HubModel, HubModelFallback, PresetModel, ProviderPreset } from './types.ts'
import styles from './ModelHubSection.module.css'

/** Props for {@link ModelEditor}. */
export interface ModelEditorProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Model id being edited, or null when creating. */
  editing: string | null
  /** Current field values when editing. */
  existing: HubModel | undefined
  /** Every declared model (for the live route preview). */
  models: Record<string, HubModel>
  /** Provider keys the model may attach to. */
  providers: readonly string[]
  /** Vendor preset key per provider key (filters the model preset list). */
  providerPresets: Record<string, string | undefined>
  /** Vendor presets offered in the preset dropdown. */
  presets: readonly ProviderPreset[]
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Persist handler; returns the failure text to show, or undefined on success. */
  onSave: (id: string, value: HubModel) => Promise<string | undefined>
  /** Close without saving. */
  onClose: () => void
}

/** Parse one optional positive-integer field; NaN when the text is unusable. */
function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? value : Number.NaN
}

/** One selectable preset row: the model plus the vendor it came from. */
interface PresetChoice {
  value: string
  label: string
  vendor: string
  model: PresetModel
}

/**
 * The model dialog.
 * @param props - see {@link ModelEditorProps}.
 * @returns the modal tree.
 */
export function ModelEditor({ open, editing, existing, models, providers, providerPresets, presets, t, onSave, onClose }: ModelEditorProps) {
  const [id, setId] = useState(editing ?? '')
  const [provider, setProvider] = useState(existing?.provider ?? providers[0] ?? '')
  const [api, setApi] = useState(existing?.api ?? PROTOCOL_CHOICES[0])
  const [fallbacks, setFallbacks] = useState<HubModelFallback[]>(
    (existing?.fallbacks ?? []).map(fallback => ({ ...fallback })),
  )
  const [name, setName] = useState(existing?.name ?? '')
  const [contextWindow, setContextWindow] = useState(existing?.contextWindow?.toString() ?? '')
  const [maxTokens, setMaxTokens] = useState(existing?.maxTokens?.toString() ?? '')
  const [image, setImage] = useState(existing?.input?.includes('image') ?? false)
  const [efforts, setEfforts] = useState<readonly string[]>(
    typeof existing?.reasoningEfforts === 'object' ? Object.keys(existing.reasoningEfforts) : [],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [idTouched, setIdTouched] = useState(editing !== null)

  const toggleEffort = (level: string): void => {
    setEfforts(current => current.includes(level) ? current.filter(item => item !== level) : [...current, level])
  }

  const updateFallback = (index: number, patch: Partial<HubModelFallback>): void => {
    setFallbacks(current => current.map((fallback, at) => at === index ? { ...fallback, ...patch } : fallback))
  }
  const moveFallback = (index: number, delta: -1 | 1): void => {
    setFallbacks((current) => {
      const to = index + delta
      if (to < 0 || to >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(to, 0, item!)
      return next
    })
  }
  const removeFallback = (index: number): void => {
    setFallbacks(current => current.filter((_, at) => at !== index))
  }
  const addFallback = (): void => {
    const spare = providers.find(key => key !== provider) ?? providers[0]
    if (spare === undefined) return
    setFallbacks(current => [...current, { provider: spare, api: PROTOCOL_CHOICES[0] }])
  }

  // Preset choices follow the provider's vendor when it carries a preset
  // marker; without one every vendor is offered (grouped by vendor).
  const vendorKey = providerPresets[provider]
  const choices: PresetChoice[] = presets
    .filter(preset => vendorKey === undefined || preset.key === vendorKey)
    .flatMap(preset => preset.models.map(model => ({
      value: `${preset.key}:${model.id}`,
      label: `${model.name ?? model.id}${model.contextWindow === undefined ? '' : ` · ${Math.round(model.contextWindow / 1024)}K`}`,
      vendor: preset.label,
      model,
    })))

  const applyPreset = (value: string): void => {
    const choice = choices.find(candidate => candidate.value === value)
    if (choice === undefined) return
    const { model } = choice
    if (!idTouched || id.length === 0) setId(model.id)
    setName(model.name ?? '')
    setApi(model.api)
    setContextWindow(model.contextWindow?.toString() ?? '')
    setMaxTokens(model.maxTokens?.toString() ?? '')
    setImage(model.input?.includes('image') ?? false)
    setEfforts(typeof model.reasoningEfforts === 'object' ? Object.keys(model.reasoningEfforts) : [])
  }

  const previewModels = { ...models, [id || '?']: { provider, api, fallbacks } }
  const routePreview = provider.length > 0
    ? [{ provider, api }, ...fallbacks].map(placement => routeNameFor(previewModels, placement.provider, placement.api)).join(' → ')
    : '—'

  const submit = async (): Promise<void> => {
    const trimmedId = id.trim()
    if (trimmedId.length === 0) { setError(`${t('modelId')} ✕`); return }
    if (provider.length === 0) { setError(`${t('provider')} ✕`); return }
    const placements = [{ provider, api }, ...fallbacks]
    const seen = new Set<string>()
    for (const placement of placements) {
      const pairKey = `${placement.provider} ${placement.api}`
      if (seen.has(pairKey)) {
        setError(`${t('duplicatePlacement')}: ${placement.provider} (${placement.api})`)
        return
      }
      seen.add(pairKey)
    }
    const context = parseCapacity(contextWindow)
    const output = parseCapacity(maxTokens)
    if (Number.isNaN(context) || Number.isNaN(output)) {
      setError(`${t('contextWindow')} / ${t('maxTokens')}: positive integers only`)
      return
    }
    setBusy(true)
    const value: HubModel = { provider, api }
    if (fallbacks.length > 0) value.fallbacks = fallbacks.map(fallback => ({ ...fallback }))
    if (name.trim().length > 0) value.name = name.trim()
    if (context !== undefined) value.contextWindow = context
    if (output !== undefined) value.maxTokens = output
    value.input = image ? ['text', 'image'] : ['text']
    if (efforts.length > 0) {
      // Identity wire spelling: the gateway speaks the canonical level names.
      value.reasoningEfforts = Object.fromEntries(efforts.map(level => [level, level]))
    }
    const failure = await onSave(trimmedId, value)
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing !== null ? t('editModel') : t('addModel')}
      closeLabel={t('close')}
      description={t('modelDescription')}
      className={styles.dialog}
      contentClassName={styles.scrollContent}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('save')}</Button>
        </>
      )}
    >
      <div className={styles.form}>
        {choices.length === 0 ? null : (
          <section className={styles.group}>
            <span className={styles.groupTitle}>{t('groupPreset')}</span>
            <label className={styles.field}>
              <span className={styles.label}>{t('modelPreset')}</span>
              <select className={styles.select} value="" onChange={event => applyPreset(event.currentTarget.value)}>
                <option value="">{t('presetCustom')}</option>
                {choices.map(choice => (
                  <option key={choice.value} value={choice.value}>
                    {vendorKey === undefined ? `${choice.vendor} / ` : ''}{choice.label}
                  </option>
                ))}
              </select>
              <span className={styles.hint}>{t('modelPresetHint')}</span>
            </label>
          </section>
        )}

        <section className={styles.group}>
          <span className={styles.groupTitle}>{t('groupBasic')}</span>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.label}>{t('modelId')}</span>
              <Input
                value={id}
                onChange={(event) => { setIdTouched(true); setId(event.currentTarget.value) }}
                readOnly={editing !== null}
                placeholder="my-model"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t('displayName')}（{t('optional')}）</span>
              <Input value={name} onChange={event => setName(event.currentTarget.value)} />
            </label>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.label}>{t('provider')}</span>
              <select className={styles.select} value={provider} onChange={event => setProvider(event.currentTarget.value)}>
                {providers.map(key => <option key={key} value={key}>{key}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t('protocol')}</span>
              <select className={styles.select} value={api} onChange={event => setApi(event.currentTarget.value)}>
                {PROTOCOL_CHOICES.map(choice => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className={styles.group}>
          <span className={styles.groupTitle}>{t('groupCapability')}</span>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.label}>{t('contextWindow')}（{t('optional')}）</span>
              <Input value={contextWindow} onChange={event => setContextWindow(event.currentTarget.value)} placeholder="262144" />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t('maxTokens')}（{t('optional')}）</span>
              <Input value={maxTokens} onChange={event => setMaxTokens(event.currentTarget.value)} placeholder="32768" />
            </label>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <span className={styles.label}>{t('modalities')}</span>
              <div className={styles.checks}>
                <label className={styles.check}>
                  <input type="checkbox" checked readOnly />
                  <span>text</span>
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={image} onChange={event => setImage(event.currentTarget.checked)} />
                  <span>image</span>
                </label>
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>{t('routePreview')}</span>
              <code className={styles.preview}>{routePreview}</code>
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('efforts')}（{t('optional')}）</span>
            <div className={styles.pills}>
              {EFFORT_LEVELS.map(level => (
                <Pill key={level} active={efforts.includes(level)} onClick={() => toggleEffort(level)}>{level}</Pill>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <span className={styles.groupTitle}>{t('fallbacks')}</span>
          {fallbacks.length === 0 ? null : (
            <div className={styles.fallbackRows}>
              {fallbacks.map((fallback, index) => (
                <div key={index} className={styles.fallbackRow}>
                  <span className={styles.fallbackOrder}>{index + 2}.</span>
                  <select
                    className={styles.select}
                    value={fallback.provider}
                    onChange={event => updateFallback(index, { provider: event.currentTarget.value })}
                  >
                    {providers.map(key => <option key={key} value={key}>{key}</option>)}
                  </select>
                  <select
                    className={styles.select}
                    value={fallback.api}
                    onChange={event => updateFallback(index, { api: event.currentTarget.value })}
                  >
                    {PROTOCOL_CHOICES.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                  <span className={styles.fallbackOps}>
                    <Button variant="outline" disabled={index === 0} onClick={() => moveFallback(index, -1)}>↑</Button>
                    <Button variant="outline" disabled={index === fallbacks.length - 1} onClick={() => moveFallback(index, 1)}>↓</Button>
                    <Button variant="outline" onClick={() => removeFallback(index)}>×</Button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button variant="outline" disabled={providers.length === 0} onClick={addFallback}>{t('addFallback')}</Button>
          </div>
          <span className={styles.hint}>{t('fallbackHint')}</span>
        </section>

        {error === null ? null : <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  )
}
