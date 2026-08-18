/**
 * Provider editor modal: create or edit one supplier entry. A vendor preset
 * dropdown autofills the endpoint and identity (only "custom" is fully
 * manual); the API key is stored into the credentials seam, never the
 * document. The provider key is permanent once saved — sessions and routes
 * reference it — so editing keeps it read-only. The editor owns its Modal so
 * the action row lands in the dialog footer.
 */

import { useState } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { EditorDialog, IdentityFields } from './EditorFields.tsx'
import type { en } from './locales.ts'
import { deriveKeyRef } from './store.ts'
import type { CredentialState, HubProvider, ProviderPreset } from './types.ts'
import styles from './ModelHubSection.module.css'

/** Props for {@link ProviderEditor}. */
export interface ProviderEditorProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Provider key being edited, or null when creating. */
  editing: string | null
  /** Current field values when editing. */
  existing: HubProvider | undefined
  /** Credential-seam state of the existing entry's reference, when one is set. */
  credential: CredentialState | undefined
  /** Keys already taken (duplicate-key guard when creating). */
  takenKeys: readonly string[]
  /** Vendor presets offered in the type dropdown. */
  presets: readonly ProviderPreset[]
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Persist handler; returns the failure text to show, or undefined on success. */
  onSave: (key: string, value: HubProvider, apiKey?: string) => Promise<string | undefined>
  /** Close without saving. */
  onClose: () => void
}

const KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * The provider dialog.
 * @param props - see {@link ProviderEditorProps}.
 * @returns the modal tree.
 */
export function ProviderEditor({ open, editing, existing, credential, takenKeys, presets, t, onSave, onClose }: ProviderEditorProps) {
  const [key, setKey] = useState(editing ?? '')
  const [presetKey, setPresetKey] = useState(existing?.preset ?? '')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? '')
  const [anthropicEndpoint, setAnthropicEndpoint] = useState(existing?.endpoints?.['anthropic-messages'] ?? '')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState(existing?.apiKeyEnv ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [keyTouched, setKeyTouched] = useState(editing !== null)

  const applyPreset = (next: string): void => {
    setPresetKey(next)
    const preset = presets.find(candidate => candidate.key === next)
    if (preset === undefined) return
    setDisplayName(preset.label)
    setBaseURL(preset.baseURL)
    if (!keyTouched || !key || takenKeys.includes(key)) setKey(preset.key)
    if (apiKeyEnv.length === 0) setApiKeyEnv('')
  }

  const submit = async (): Promise<void> => {
    const trimmedKey = key.trim()
    if (!KEY_PATTERN.test(trimmedKey)) {
      setError(`${t('providerKey')}: a-z0-9-`)
      return
    }
    if (editing === null && takenKeys.includes(trimmedKey)) {
      setError(`${t('providerKey')}: "${trimmedKey}" ✕`)
      return
    }
    if (baseURL.trim().length === 0) {
      setError(`${t('baseURL')} ✕`)
      return
    }
    setBusy(true)
    const value: HubProvider = { baseURL: baseURL.trim() }
    if (presetKey.length > 0) value.preset = presetKey
    if (displayName.trim().length > 0) value.displayName = displayName.trim()
    // Preserve protocol overrides the form does not edit; only the
    // anthropic-messages row round-trips through this dialog.
    const endpoints = { ...existing?.endpoints }
    if (anthropicEndpoint.trim().length > 0) endpoints['anthropic-messages'] = anthropicEndpoint.trim()
    else delete endpoints['anthropic-messages']
    if (Object.keys(endpoints).length > 0) value.endpoints = endpoints
    if (apiKeyEnv.trim().length > 0) value.apiKeyEnv = apiKeyEnv.trim()
    const failure = await onSave(trimmedKey, value, apiKey.length > 0 ? apiKey : undefined)
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  const keyHint = credential !== undefined && !credential.valid
    ? t('apiKeyInvalid')
    : credential?.configured === true
      ? `${t('apiKeyConfigured')} (${existing?.apiKeyEnv ?? ''})`
      : editing !== null && existing?.apiKeyEnv !== undefined
        ? `${t('apiKeyMissing')} (${existing.apiKeyEnv})`
        : `${t('apiKeyStoredAs')} ${deriveKeyRef(key.trim() || 'my-gateway')}`

  return (
    <EditorDialog
      open={open}
      onClose={onClose}
      title={editing !== null ? t('editProvider') : t('addProvider')}
      closeLabel={t('close')}
      description={t('providerDescription')}
      cancelLabel={t('cancel')}
      saveLabel={t('save')}
      busy={busy}
      onSubmit={() => { void submit() }}
    >
      <div className={styles.form}>
        <section className={styles.group}>
          <span className={styles.groupTitle}>{t('groupPreset')}</span>
          <label className={styles.field}>
            <span className={styles.label}>{t('providerPreset')}</span>
            <select
              className={styles.select}
              value={presetKey}
              onChange={(event) => { applyPreset(event.currentTarget.value) }}
            >
              <option value="">{t('presetCustom')}</option>
              {presets.map(preset => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
            </select>
            <span className={styles.hint}>{t('providerPresetHint')}</span>
          </label>
        </section>

        <IdentityFields
          sectionLabel={t('groupBasic')}
          identityLabel={t('providerKey')}
          identityValue={key}
          identityPlaceholder="my-gateway"
          identityHint={t('keyHint')}
          displayNameLabel={`${t('displayName')}（${t('optional')}）`}
          displayName={displayName}
          readOnly={editing !== null}
          onIdentityChange={(value) => { setKeyTouched(true); setKey(value) }}
          onDisplayNameChange={setDisplayName}
        />
        <section className={styles.group}>
          <label className={styles.field}>
            <span className={styles.label}>{t('baseURL')}</span>
            <Input
              value={baseURL}
              onChange={(event) => { setBaseURL(event.currentTarget.value) }}
              placeholder="https://gateway.example/v1"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('anthropicEndpoint')}</span>
            <Input
              value={anthropicEndpoint}
              onChange={(event) => { setAnthropicEndpoint(event.currentTarget.value) }}
              placeholder="http://127.0.0.1:18080"
            />
            <span className={styles.hint}>{t('anthropicEndpointHint')}</span>
          </label>
        </section>

        <section className={styles.group}>
          <span className={styles.groupTitle}>{t('groupCredential')}</span>
          <label className={styles.field}>
            <span className={styles.label}>{t('apiKey')}（{t('optional')}）</span>
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => { setApiKey(event.currentTarget.value) }}
              placeholder={editing !== null ? t('apiKeyKeep') : 'sk-…'}
            />
            <span className={credential !== undefined && (!credential.valid || !credential.configured) ? styles.errorText : styles.hint}>
              {keyHint}
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('apiKeyEnv')}（{t('optional')}）</span>
            <Input
              value={apiKeyEnv}
              onChange={(event) => { setApiKeyEnv(event.currentTarget.value) }}
              placeholder="GATEWAY_API_KEY"
            />
            <span className={styles.hint}>{t('apiKeyEnvHint')}</span>
          </label>
        </section>

        {error === null ? null : <p className={styles.error}>{error}</p>}
      </div>
    </EditorDialog>
  )
}
