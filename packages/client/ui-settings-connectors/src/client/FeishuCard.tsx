/**
 * The Feishu channel's card.
 *
 * Three questions, in the order someone setting this up actually asks them:
 * where the messages come from, who is allowed to send them, and how a session
 * behaves once one starts. The first is an either/or — dsh's own Feishu app, or
 * a subscription the bridge already holds for other agents — so it is radios,
 * and only the chosen branch shows its controls. Two independently-openable
 * sections would let someone fill in both and leave no way to tell which one is
 * in effect.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BranchField, ChoiceField, ConnectorCard, FieldGroup, ListField, ValueField } from './ConnectorCard.tsx'
import { FeishuAuthPanel } from './FeishuAuthPanel.tsx'
import type { FeishuAccess, FeishuCardFace, FeishuCardState } from './feishu-card-controller.ts'
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
const ACCESS: ReadonlyArray<{ value: FeishuAccess; nameKey: ConnectorsKey; whyKey: ConnectorsKey }> = [
  { value: 'own', nameKey: 'feishu.access.own', whyKey: 'feishu.access.ownWhy' },
  { value: 'reuse', nameKey: 'feishu.access.reuse', whyKey: 'feishu.access.reuseWhy' },
]

/** Which line says who can reach the channel as configured. */
const REACH: Record<FeishuCardState['reach'], ConnectorsKey> = {
  nobody: 'feishu.reach.nobody',
  'dm-only': 'feishu.reach.dmOnly',
  'group-only': 'feishu.reach.groupOnly',
  both: 'feishu.reach.both',
}

/**
 * The controls this card edits — the section fields, and only those. Named
 * separately from the card state because that also carries what is read but
 * never written: the plugin's presence, the sign-in panel, the branch.
 */
type FeishuField =
  | 'presetId' | 'density' | 'flushMs' | 'approvalTimeoutMs' | 'endpoint'
  | 'eventConfigDirs' | 'cardActionConfigDirs' | 'eventEndpoint'
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
  const field = (name: FeishuField) => ({
    t,
    disabled,
    field: state[name],
    onEdit: (text: string) => { props.edit(name, text) },
    onReset: () => { props.resetField(name) },
  })
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
      auth={state.authFolded
        ? (
          <section className={css.auth}>
            <h4 className={css.authHeading}>{t('auth.heading')}</h4>
            <div className={css.folded}>
              <p className={css.foldedWhy}>{t('auth.foldedReuse')}</p>
              <button type="button" className={css.discard} onClick={props.toggleAuth}>
                {t('auth.unfold')}
              </button>
            </div>
          </section>
        )
        : (
          <>
            <FeishuAuthPanel
              t={t}
              state={state.auth}
              onSelectProfile={props.selectProfile}
              onSelect={props.selectDomain}
              onBegin={props.beginAuth}
              onCancel={props.cancelAuth}
              onLogout={props.logout}
              onReload={props.readAuth}
            />
            {state.access === 'reuse'
              ? (
                <div className={css.folded}>
                  <p className={css.foldedWhy} />
                  <button type="button" className={css.discard} onClick={props.toggleAuth}>
                    {t('auth.fold')}
                  </button>
                </div>
              )
              : null}
          </>
        )}
    >
      <BranchField
        t={t}
        labelKey="feishu.access.label"
        options={ACCESS}
        value={state.access}
        disabled={disabled}
        onChange={(value) => { props.setAccess(value as FeishuAccess) }}
      />

      {/* Only the chosen branch shows controls. The other one's field is not
          greyed out but absent: a disabled textarea still displays a value,
          and a list sitting there greyed reads as "in effect, just locked". */}
      {state.access === 'reuse'
        ? (
          <FieldGroup t={t} titleKey="feishu.bridge.title" leadKey="feishu.bridge.lead">
            <ListField
              {...field('eventConfigDirs')}
              labelKey="feishu.eventConfigDirs.label"
              hintKey="feishu.eventConfigDirs.hint"
            />
            <ListField
              {...field('cardActionConfigDirs')}
              labelKey="feishu.cardActionConfigDirs.label"
              hintKey="feishu.cardActionConfigDirs.hint"
              rows={2}
            />
            <ValueField
              {...field('eventEndpoint')}
              labelKey="feishu.eventEndpoint.label"
              hintKey="feishu.eventEndpoint.hint"
            />
          </FieldGroup>
        )
        : null}

      <FieldGroup t={t} titleKey="feishu.reach.title" leadKey="feishu.reach.lead">
        {/* The standing answer, above the knobs that produce it. Deny-by-default
            is silent otherwise: allowlist mode with an empty list is a channel
            that is switched on, authorized, connected, and unusable. */}
        <p className={state.reach === 'nobody' ? css.absent : css.hint} role="status">
          {t(REACH[state.reach])}
        </p>
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
        <ValueField
          {...field('staleMs')}
          labelKey="feishu.staleMs.label"
          hintKey="feishu.staleMs.hint"
          numeric
        />
      </FieldGroup>

      <FieldGroup t={t} titleKey="feishu.behaviour.title">
        <ValueField
          {...field('presetId')}
          labelKey="feishu.presetId.label"
          hintKey="feishu.presetId.hint"
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
          {...field('endpoint')}
          labelKey="feishu.endpoint.label"
          hintKey="feishu.endpoint.hint"
        />
      </FieldGroup>
    </ConnectorCard>
  )
}
