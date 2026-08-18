/**
 * Model-hub settings section: provider cards plus the model list, one modal
 * editor at a time. Every mutation writes through the wire (`settings.mutate`)
 * and the page re-renders from the post-write reload; the host plugin turns
 * each committed change into regenerated provider routes. The section also
 * surfaces the linkage facts the gateway reports — a failed route generation,
 * each provider's credential state, the compiled route per model, and the
 * default model selection — and offers the two loop-closing actions:
 * importing hand-written `llm-pi-ai` routes and setting the default model.
 */

import { useEffect, useState } from 'react'
import { Button, IconPlusOutline16, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { en } from './locales.ts'
import { routeNameFor } from './store.ts'
import type { ModelHubState, ModelHubStore } from './store.ts'
import type { HubModel, HubProvider, ImportNote, ImportOutcome } from './types.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { ModelEditor } from './ModelEditor.tsx'
import styles from './ModelHubSection.module.css'

/** Injected dependencies of {@link ModelHubSection} (slot `inject`). */
export interface ModelHubInjected {
  /** The page store (loaded on mount, refreshed after writes). */
  controller: ModelHubStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelHubState>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelHubSectionProps = Partial<ModelHubInjected>

/** Which editor modal is open: nothing, a new entry, or the key being edited. */
type EditorState = { kind: 'none' } | { kind: 'provider'; key: string | null } | { kind: 'model'; id: string | null }

/** Locale key per host skip reason (the wire sends codes, the page localizes). */
const REASON_KEYS = {
  'catalog-route': 'skipCatalog',
  'unknown-protocol': 'skipUnknownProtocol',
  'no-endpoint': 'skipNoEndpoint',
  'endpoint-conflict': 'skipConflict',
  'duplicate-model': 'skipDuplicate',
} as const satisfies Record<ImportNote['reason'], keyof typeof en>

/**
 * The model-hub settings page.
 * @param props - the inject face spread by the slot outlet.
 * @returns the section tree.
 */
export function ModelHubSection(props: ModelHubSectionProps) {
  const { controller, useSnapshot, t } = props
  const [editor, setEditor] = useState<EditorState>({ kind: 'none' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ImportOutcome | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const state = useSnapshot?.(snapshot => snapshot)
  useEffect(() => {
    if (controller !== undefined) void controller.load()
  }, [controller])
  if (state === undefined || t === undefined || controller === undefined) return null

  if (state.status === 'unmounted') return <div className={styles.notice}>{t('unmounted')}</div>
  if (state.status !== 'ready') return <div className={styles.notice}>{state.error ?? t('loading')}</div>

  const closeEditor = (): void => { setEditor({ kind: 'none' }); setActionError(null) }

  const removeProvider = async (key: string): Promise<void> => {
    const blocked = Object.entries(state.models).filter(([, model]) => model.provider === key).map(([id]) => id)
    if (blocked.length > 0) {
      setActionError(t('removeProviderBlocked') + blocked.join(', '))
      return
    }
    setActionError(await controller.removeProvider(key) ?? null)
  }
  const removeModel = async (id: string): Promise<void> => {
    setActionError(await controller.removeModel(id) ?? null)
  }
  const runImport = async (): Promise<void> => {
    setImportBusy(true)
    setImportSummary(null)
    const { outcome, error } = await controller.importFromPiAi()
    setImportBusy(false)
    if (error !== undefined) setActionError(error)
    else if (outcome !== undefined) setImportSummary(outcome)
  }
  const setDefault = async (route: string, id: string): Promise<void> => {
    setActionError(await controller.setDefaultModel(route, id) ?? null)
  }

  const providerEntries = Object.entries(state.providers)
  const modelEntries = Object.entries(state.models)
  const routeOf = (id: string, model: HubModel): string =>
    state.routeByModel[id] ?? routeNameFor(state.models, model.provider, model.api)

  return (
    <div className={styles.root}>
      <p className={styles.intro}>{t('intro')}</p>
      {state.writable ? null : <p className={styles.notice}>{t('readonly')}</p>}
      {state.reconcileError === null ? null : (
        <p className={styles.error}>{t('reconcileFailed')}{state.reconcileError}</p>
      )}
      {actionError === null ? null : <p className={styles.error}>{actionError}</p>}

      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{t('providers')}</h3>
        <div className={styles.headActions}>
          <Button variant="outline" disabled={importBusy} onClick={() => void runImport()}>
            {importBusy ? t('importBusy') : t('importButton')}
          </Button>
          <Button
            icon={<IconPlusOutline16 />}
            onClick={() => { setEditor({ kind: 'provider', key: null }) }}
          >{t('addProvider')}</Button>
        </div>
      </div>
      {importSummary === null ? null : (
        <div className={styles.summary}>
          <div className={styles.summaryHead}>
            <span>{t('importDone')}</span>
            <Button variant="outline" onClick={() => { setImportSummary(null) }}>{t('dismiss')}</Button>
          </div>
          {importSummary.providers.length + importSummary.models.length === 0
            ? <p className={styles.notice}>{t('importEmpty')}</p>
            : (
              <p className={styles.summaryLine}>
                {`${t('importedProviders')}${importSummary.providers.join(', ') || '—'}；${t('importedModels')}${importSummary.models.join(', ') || '—'}`}
              </p>
            )}
          {importSummary.notes.length === 0 ? null : (
            <ul className={styles.summaryNotes}>
              {importSummary.notes.map(note => (
                <li key={`${note.reason}:${note.subject}`}>{`${note.subject} — ${t(REASON_KEYS[note.reason])}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {providerEntries.length === 0 ? <p className={styles.notice}>{t('empty')}</p> : (
        <ul className={styles.list}>
          {providerEntries.map(([key, provider]) => {
            const credential = state.credentials[key]
            return (
              <li key={key} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{provider.displayName ?? key}</span>
                  <span className={styles.rowMeta}>{key}{provider.baseURL === undefined ? '' : ` · ${provider.baseURL}`}</span>
                  {credential === undefined ? null : credential.valid && credential.configured ? (
                    <span className={styles.rowMeta}>{t('credentialOk')}{provider.apiKeyEnv === undefined ? '' : ` (${provider.apiKeyEnv})`}</span>
                  ) : (
                    <span className={styles.errorText}>
                      {credential.valid ? t('credentialMissing') : t('credentialInvalid')}{provider.apiKeyEnv === undefined ? '' : ` (${provider.apiKeyEnv})`}
                    </span>
                  )}
                </div>
                <div className={styles.rowActions}>
                  <Button onClick={() => { setEditor({ kind: 'provider', key }) }}>{t('edit')}</Button>
                  <Button onClick={() => void removeProvider(key)}>{t('remove')}</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{t('models')}</h3>
        <Button
          icon={<IconPlusOutline16 />}
          onClick={() => { setEditor({ kind: 'model', id: null }) }}
        >{t('addModel')}</Button>
      </div>
      {modelEntries.length === 0 ? <p className={styles.notice}>{t('empty')}</p> : (
        <ul className={styles.list}>
          {modelEntries.map(([id, model]) => {
            const route = routeOf(id, model)
            const chain = state.chains[id]
            const isDefault = state.defaultModel?.provider === route && state.defaultModel.model === id
            const probeResults = state.probeResults[id]
            return (
              <li key={id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {model.name ?? id}
                    <Pill>{route}</Pill>
                    {isDefault ? <Pill active>{t('isDefault')}</Pill> : null}
                  </span>
                  <span className={styles.rowMeta}>{id} · {model.provider} · {model.api}</span>
                  {chain === undefined ? null : (
                    <span className={styles.rowMeta}>{t('chain')}{chain.join(' → ')}</span>
                  )}
                  {state.probing[id] ? <span className={styles.rowMeta}>{t('probing')}</span> : null}
                  {probeResults === undefined ? null : (
                    <span className={styles.probeResults}>
                      {probeResults.map((result, at) => (
                        <span key={result.route || at} className={result.ok ? styles.probeOk : styles.probeFail}>
                          {result.ok
                            ? `✓ ${result.route} · ${result.ms}ms`
                            : `✗ ${result.route === '' ? '' : `${result.route} · `}${result.code === undefined ? '' : `${result.code}: `}${result.message ?? ''}`}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className={styles.rowActions}>
                  <Button variant="outline" disabled={state.probing[id]} onClick={() => void controller.probe(id)}>
                    {t('probe')}
                  </Button>
                  {isDefault ? null : (
                    <Button onClick={() => void setDefault(route, id)}>{t('setDefault')}</Button>
                  )}
                  <Button onClick={() => { setEditor({ kind: 'model', id }) }}>{t('edit')}</Button>
                  <Button onClick={() => void removeModel(id)}>{t('remove')}</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ProviderEditor
        key={editor.kind === 'provider' ? `provider-${editor.key ?? 'new'}` : 'provider-closed'}
        open={editor.kind === 'provider'}
        editing={editor.kind === 'provider' ? editor.key : null}
        existing={editor.kind === 'provider' && editor.key !== null ? state.providers[editor.key] : undefined}
        credential={editor.kind === 'provider' && editor.key !== null ? state.credentials[editor.key] : undefined}
        takenKeys={providerEntries.map(([key]) => key)}
        presets={state.presets}
        t={t}
        onSave={async (key, value: HubProvider, apiKey?: string) => {
          const failure = await controller.saveProvider(key, value, apiKey)
          if (failure === undefined) closeEditor()
          return failure
        }}
        onClose={closeEditor}
      />

      <ModelEditor
        key={editor.kind === 'model' ? `model-${editor.id ?? 'new'}` : 'model-closed'}
        open={editor.kind === 'model'}
        editing={editor.kind === 'model' ? editor.id : null}
        existing={editor.kind === 'model' && editor.id !== null ? state.models[editor.id] : undefined}
        models={state.models}
        providers={providerEntries.map(([key]) => key)}
        providerPresets={Object.fromEntries(providerEntries.map(([key, provider]) => [key, provider.preset]))}
        presets={state.presets}
        t={t}
        onSave={async (id, value: HubModel) => {
          const failure = await controller.saveModel(id, value)
          if (failure === undefined) closeEditor()
          return failure
        }}
        onClose={closeEditor}
      />
    </div>
  )
}
