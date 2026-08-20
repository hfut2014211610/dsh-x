/**
 * The Feishu channel's card.
 *
 * One question decides the whole layout: is this set up or not.
 *
 * Not set up — two ways in and nothing else. Showing the knobs before the
 * channel exists asks people to tune something that is not running yet, and
 * the ordinary path (its own app, scan a code) gets buried among options that
 * only matter to the other one.
 *
 * Set up — a status line, the settings folded away, and the two actions that
 * undo it. A working channel needs no explaining; what it needs is a way to
 * see it is working and a way out.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BranchField, ChoiceField, ConnectorCard, FactRow, FieldGroup, ListField, ValueField,
} from './ConnectorCard.tsx'
import { FeishuAuthPanel } from './FeishuAuthPanel.tsx'
import type { FeishuCardFace, FeishuCardState, FeishuMode } from './feishu-card-controller.ts'
import type { ConnectorsKey } from './locales.ts'
import type {} from './slot-contract.ts'
import css from './ConnectorCard.module.css'

/** Density options in display order, each with the copy key of its label. */
const DENSITIES: ReadonlyArray<{ value: string; labelKey: ConnectorsKey }> = [
  { value: 'compact', labelKey: 'feishu.density.compact' },
  { value: 'standard', labelKey: 'feishu.density.standard' },
  { value: 'detailed', labelKey: 'feishu.density.detailed' },
]

/** Direct-message modes, widest first so the list reads as a narrowing. */
const DM_MODES: ReadonlyArray<{ value: string; labelKey: ConnectorsKey }> = [
  { value: 'open', labelKey: 'feishu.dmMode.open' },
  { value: 'allowlist', labelKey: 'feishu.dmMode.allowlist' },
  { value: 'disabled', labelKey: 'feishu.dmMode.disabled' },
]

/** The require-an-@ toggle, rendered as a choice so "not set here" stays sayable. */
const MENTION: ReadonlyArray<{ value: string; labelKey: ConnectorsKey }> = [
  { value: 'true', labelKey: 'feishu.requireMention.on' },
  { value: 'false', labelKey: 'feishu.requireMention.off' },
]

/** The two ways in, ordinary one first. */
const MODES: ReadonlyArray<{ value: FeishuMode; nameKey: ConnectorsKey; whyKey: ConnectorsKey }> = [
  { value: 'direct', nameKey: 'feishu.mode.direct', whyKey: 'feishu.mode.directWhy' },
  { value: 'bridge', nameKey: 'feishu.mode.bridge', whyKey: 'feishu.mode.bridgeWhy' },
]

/** Which line says who can reach the channel as configured. */
const REACH: Record<FeishuCardState['reach'], ConnectorsKey> = {
  nobody: 'feishu.reach.nobody',
  'dm-only': 'feishu.reach.dmOnly',
  'group-only': 'feishu.reach.groupOnly',
  both: 'feishu.reach.both',
}

/** The controls this card edits — the section fields, and only those. */
type FeishuField =
  | 'mode' | 'profileId' | 'appId' | 'eventCommand' | 'workspace'
  | 'presetId' | 'density' | 'flushMs' | 'approvalTimeoutMs' | 'endpoint'
  | 'dmMode' | 'dmAllowlist' | 'groupAllowlist' | 'requireMention' | 'staleMs'

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
  const mode = state.mode.text
  const user = state.auth.status?.user
  const field = (name: FeishuField) => ({
    t,
    disabled,
    field: state[name],
    onEdit: (text: string) => { props.edit(name, text) },
    onReset: () => { props.resetField(name) },
  })
  // 接好了就不再摆接入那一段，除非人自己点开——除非它压根还没接好。
  const showSetup = !state.ready || state.setupOpen
  return (
    <ConnectorCard
      t={t}
      nameKey="feishu.name"
      absentKey="feishu.absent"
      state={state}
      presence={state.plugin}
      runningKey={state.ready ? 'state.on' : 'state.unset'}
      onReadPresence={props.readPresence}
      onOpen={props.readAuth}
      onSetEnabled={props.setEnabled}
      onSave={props.save}
      onDiscard={props.discard}
      auth={showSetup && mode === 'direct'
        ? (
          <FeishuAuthPanel
            t={t}
            state={state.auth}
            onBind={props.bindApp}
            onSelect={props.selectDomain}
            onBegin={props.beginAuth}
            onCancel={props.cancelAuth}
            onReload={props.readAuth}
          />
        )
        : undefined}
    >
      {state.ready
        ? (
          <FieldGroup t={t} titleKey="feishu.status.title">
            <FactRow label={t('feishu.status.mode')}>
              {t(mode === 'direct' ? 'feishu.mode.direct' : 'feishu.mode.bridge')}
            </FactRow>
            <FactRow label={t('feishu.status.app')}>
              <code className={css.reason}>
                {mode === 'direct' ? state.auth.status?.appId ?? '' : state.appId.text}
              </code>
            </FactRow>
            {mode === 'direct' && user !== undefined
              ? (
                <>
                  <FactRow label={t('feishu.status.user')}>
                    {user.userName ?? user.openId ?? ''}
                  </FactRow>
                  <FactRow label={t('feishu.status.scopes')}>
                    <span className={css.authCount}>{user.scopes.length}</span>
                    {t('auth.scopes')}
                  </FactRow>
                </>
              )
              : null}
            <FactRow label={t('feishu.status.bridge')}>
              {t(state.bridge.connected ? 'feishu.status.bridgeOn' : 'feishu.status.bridgeOff')}
            </FactRow>
            <p className={state.reach === 'nobody' ? css.absent : css.hint} role="status">
              {t(REACH[state.reach])}
            </p>
            <div className={css.authActions}>
              <button type="button" className={css.discard} onClick={props.reopenSetup}>
                {t(state.setupOpen ? 'feishu.action.hideSetup' : 'feishu.action.reconfigure')}
              </button>
              <button
                type="button"
                className={state.confirmingReset ? css.save : css.discard}
                disabled={disabled}
                onClick={props.reset}
              >
                {t(state.confirmingReset ? 'feishu.action.resetConfirm' : 'feishu.action.reset')}
              </button>
            </div>
          </FieldGroup>
        )
        : null}

      {showSetup
        ? (
          <>
            <BranchField
              t={t}
              labelKey="feishu.mode.label"
              options={MODES}
              value={mode}
              disabled={disabled}
              onChange={(value) => { props.edit('mode', value) }}
            />
            {/* 选了才摆对应的那一组。没选之前这张卡片上只有上面那两个选项。 */}
            {mode === 'direct'
              ? (
                <ValueField
                  {...field('profileId')}
                  labelKey="feishu.profileId.label"
                  hintKey="feishu.profileId.hint"
                />
              )
              : null}
            {mode === 'bridge'
              ? (
                <>
                  <ValueField
                    {...field('appId')}
                    labelKey="feishu.appId.label"
                    hintKey="feishu.appId.hint"
                  />
                  <ValueField
                    {...field('eventCommand')}
                    labelKey="feishu.eventCommand.label"
                    hintKey="feishu.eventCommand.hint"
                  />
                </>
              )
              : null}
          </>
        )
        : null}

      {/* 接好了才谈怎么跑。默认折起来：装完就能用，调它是后来的事。 */}
      {state.ready
        ? (
          <section className={css.group}>
            <button type="button" className={css.foldHead} onClick={props.toggleSettings}>
              <span className={css.groupHeading}>{t('feishu.settings.title')}</span>
              <span className={css.foldMark}>{t(state.settingsOpen ? 'collapse' : 'expand')}</span>
            </button>
            {state.settingsOpen
              ? (
                <>
                  <ValueField
                    {...field('workspace')}
                    labelKey="feishu.workspace.label"
                    hintKey="feishu.workspace.hint"
                  />
                  <ValueField
                    {...field('presetId')}
                    labelKey="feishu.presetId.label"
                    hintKey="feishu.presetId.hint"
                  />
                  <ChoiceField
                    {...field('dmMode')}
                    labelKey="feishu.dmMode.label"
                    hintKey="feishu.dmMode.hint"
                    choices={DM_MODES}
                  />
                  <ListField
                    {...field('dmAllowlist')}
                    labelKey="feishu.dmAllowlist.label"
                    hintKey="feishu.dmAllowlist.hint"
                    rows={2}
                  />
                  <ListField
                    {...field('groupAllowlist')}
                    labelKey="feishu.groupAllowlist.label"
                    hintKey="feishu.groupAllowlist.hint"
                    rows={2}
                  />
                  <ChoiceField
                    {...field('requireMention')}
                    labelKey="feishu.requireMention.label"
                    hintKey="feishu.requireMention.hint"
                    choices={MENTION}
                  />
                  <ChoiceField
                    {...field('density')}
                    labelKey="feishu.density.label"
                    hintKey="feishu.density.hint"
                    choices={DENSITIES}
                  />
                  <ValueField
                    {...field('flushMs')}
                    labelKey="feishu.flushMs.label"
                    hintKey="feishu.flushMs.hint"
                    numeric
                  />
                  <ValueField
                    {...field('approvalTimeoutMs')}
                    labelKey="feishu.approvalTimeoutMs.label"
                    hintKey="feishu.approvalTimeoutMs.hint"
                    numeric
                  />
                  <ValueField
                    {...field('staleMs')}
                    labelKey="feishu.staleMs.label"
                    hintKey="feishu.staleMs.hint"
                    numeric
                  />
                  <ValueField
                    {...field('endpoint')}
                    labelKey="feishu.endpoint.label"
                    hintKey="feishu.endpoint.hint"
                  />
                </>
              )
              : null}
          </section>
        )
        : null}
    </ConnectorCard>
  )
}
