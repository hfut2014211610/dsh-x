/** The Feishu channel's card: how a session opened from Feishu behaves. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ChoiceField, ConnectorCard, ValueField } from './ConnectorCard.tsx'
import { FeishuAuthPanel } from './FeishuAuthPanel.tsx'
import type { FeishuCardFace } from './feishu-card-controller.ts'
import type { ConnectorsKey } from './locales.ts'
import type {} from './slot-contract.ts'

/** Density options in display order, each with the copy key of its label. */
const DENSITIES: ReadonlyArray<{ value: string; labelKey: ConnectorsKey }> = [
  { value: 'compact', labelKey: 'feishu.density.compact' },
  { value: 'standard', labelKey: 'feishu.density.standard' },
  { value: 'detailed', labelKey: 'feishu.density.detailed' },
]

/** Props the renderer binds for the Feishu card. */
export type FeishuCardProps =
  PropsRuntime<'settings.connector.item'>
  & PropsLocale<'settings.connectors'>
  & InjectFace<FeishuCardFace>

/**
 * Render the Feishu card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function FeishuCard(props: FeishuCardProps) {
  const { t } = props
  const state = props.useFeishuCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <ConnectorCard
      t={t}
      nameKey="feishu.name"
      summaryKey="feishu.summary"
      absentKey="feishu.absent"
      state={state}
      presence={state.plugin}
      onReadPresence={props.readPresence}
      onOpen={props.readAuth}
      onSetEnabled={props.setEnabled}
      onSave={props.save}
      onDiscard={props.discard}
      auth={(
        <FeishuAuthPanel
          t={t}
          state={state.auth}
          onSelect={props.selectDomain}
          onBegin={props.beginAuth}
          onCancel={props.cancelAuth}
          onLogout={props.logout}
          onReload={props.readAuth}
        />
      )}
    >
      <ValueField
        t={t}
        labelKey="feishu.presetId.label"
        hintKey="feishu.presetId.hint"
        field={state.presetId}
        disabled={disabled}
        onEdit={(text) => { props.edit('presetId', text) }}
        onReset={() => { props.resetField('presetId') }}
      />
      <ChoiceField
        t={t}
        labelKey="feishu.density.label"
        hintKey="feishu.density.hint"
        choices={DENSITIES}
        field={state.density}
        disabled={disabled}
        onEdit={(text) => { props.edit('density', text) }}
        onReset={() => { props.resetField('density') }}
      />
      <ValueField
        t={t}
        labelKey="feishu.flushMs.label"
        hintKey="feishu.flushMs.hint"
        numeric
        field={state.flushMs}
        disabled={disabled}
        onEdit={(text) => { props.edit('flushMs', text) }}
        onReset={() => { props.resetField('flushMs') }}
      />
      <ValueField
        t={t}
        labelKey="feishu.approvalTimeoutMs.label"
        hintKey="feishu.approvalTimeoutMs.hint"
        numeric
        field={state.approvalTimeoutMs}
        disabled={disabled}
        onEdit={(text) => { props.edit('approvalTimeoutMs', text) }}
        onReset={() => { props.resetField('approvalTimeoutMs') }}
      />
      <ValueField
        t={t}
        labelKey="feishu.endpoint.label"
        hintKey="feishu.endpoint.hint"
        field={state.endpoint}
        disabled={disabled}
        onEdit={(text) => { props.edit('endpoint', text) }}
        onReset={() => { props.resetField('endpoint') }}
      />
    </ConnectorCard>
  )
}
