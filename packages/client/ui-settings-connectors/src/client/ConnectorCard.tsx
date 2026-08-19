/**
 * One connector's card: a header naming the channel and saying what it does,
 * a state pill, and — disclosed in place — the controls plus the save that
 * writes them.
 *
 * Unlike a plugin card, a connector that this deployment does not compose is
 * still listed. The page's job is to say what dsh CAN be reached from, so an
 * absent channel shows its name, a "not installed" pill, and the one line that
 * installs it; hiding it would leave the user with no path from wanting the
 * channel to having it. What an absent card never shows is controls: there is
 * no namespace to write, and a disabled form would only invite the attempt.
 */

import { useEffect, useId, useState, type ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectorFieldState, ConnectorFormState } from './connector-form.ts'
import type { ConnectorPresenceState } from './connector-presence.ts'
import type { ConnectorsKey } from './locales.ts'
import css from './ConnectorCard.module.css'

/** Card chrome shared by every connector. */
export interface ConnectorCardProps {
  /** Locale reader for this page's copy. */
  t: (key: ConnectorsKey) => string
  /** Locale key of the channel's name. */
  nameKey: ConnectorsKey
  /** Locale key of the line saying what the channel does. */
  summaryKey: ConnectorsKey
  /** Locale key of the line that installs the channel, shown while it is absent. */
  absentKey: ConnectorsKey
  /** The card's form state: what the host serves, and what a save would do. */
  state: ConnectorFormState
  /** Where the channel's plugin stands in the profile, and whether it is switching. */
  presence: ConnectorPresenceState
  /** Read the plugin tree; the card calls this when it is first opened. */
  onReadPresence: () => void
  /** Switch the channel's plugin on or off. */
  onSetEnabled: (enabled: boolean) => void
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The channel's controls, rendered only while its namespace is served. */
  children: ReactNode
}

/**
 * Pill copy for each presence.
 *
 * The pill reports the plugin, not the settings namespace: a channel switched
 * off still HAS a configuration, and calling that "not installed" is what sent
 * people to the command line for a switch they already had.
 */
const PRESENCE_KEY: Record<ConnectorPresenceState['presence'], ConnectorsKey> = {
  unknown: 'state.loading',
  missing: 'state.missing',
  disabled: 'state.off',
  enabled: 'state.on',
}

/**
 * Render one connector card.
 * @param props - the channel's copy keys, its form state, and its controls.
 * @returns the card.
 */
export function ConnectorCard(props: ConnectorCardProps) {
  const [open, setOpen] = useState(false)
  const { state, presence, t } = props
  const name = t(props.nameKey)
  const blocked = !state.dirty || state.invalid || state.saving
  const switchId = useId()
  // Read the tree the first time the card is opened rather than on mount: a
  // page listing every channel would otherwise ask the host once per card for
  // an answer nobody has looked at yet.
  const { onReadPresence } = props
  useEffect(() => {
    if (open) onReadPresence()
  }, [open, onReadPresence])
  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${name}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.nameRow}>
            <span className={css.name}>{name}</span>
            <span className={css.state} data-state={presence.presence}>{t(PRESENCE_KEY[presence.presence])}</span>
          </span>
          <span className={css.summary}>{t(props.summaryKey)}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{t('unsaved')}</span> : null}
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {presence.presence === 'missing'
              ? <p className={css.absent} role="status">{t(props.absentKey)}</p>
              : (
                <>
                  <div className={css.power}>
                    <label className={css.powerLabel} htmlFor={switchId}>{t('power.label')}</label>
                    <input
                      id={switchId}
                      className={css.powerSwitch}
                      type="checkbox"
                      role="switch"
                      checked={presence.presence === 'enabled'}
                      disabled={presence.presence === 'unknown' || presence.busy}
                      onChange={(event) => { props.onSetEnabled(event.target.checked) }}
                    />
                  </div>
                  <p className={css.hint}>{t('power.hint')}</p>
                  {presence.failed
                    ? (
                      <p className={css.failed} role="status">
                        {t('power.failed')}
                        {/* The plugin's own words. A channel that cannot reach
                            its bridge says so here, and that sentence is the
                            only thing on the page naming what to go fix. */}
                        {presence.reason === undefined
                          ? null
                          : <><br /><code className={css.reason}>{presence.reason}</code></>}
                      </p>
                    )
                    : null}
                  {/* No namespace means no controls to render, but not for
                      one reason: a switched-off plugin serves none because it
                      is not running, and a running one may simply register
                      none. Saying the first when the second is true tells the
                      reader their channel is off while its switch reads on. */}
                  {state.status === 'absent'
                    ? (
                      <p className={css.absent} role="status">
                        {t(presence.presence === 'disabled' ? 'power.offNoSettings' : 'power.noSettings')}
                      </p>
                    )
                    : (
                      <>
                        {state.writable ? null : <p className={css.readOnly} role="status">{t('readOnly')}</p>}
                        {props.children}
                        <div className={css.footer}>
                          {state.failed ? <p className={css.failed} role="status">{t('saveFailed')}</p> : null}
                          <button
                            type="button"
                            className={css.discard}
                            disabled={!state.dirty || state.saving}
                            onClick={props.onDiscard}
                          >
                            {t('discard')}
                          </button>
                          <button type="button" className={css.save} disabled={blocked} onClick={props.onSave}>
                            {t(state.saving ? 'saving' : 'save')}
                          </button>
                        </div>
                      </>
                    )}
                </>
              )}
          </div>
        )
        : null}
    </li>
  )
}

/** What every control on a connector card needs, whatever its value type. */
export interface ConnectorFieldProps {
  /** Locale reader for this page's copy. */
  t: (key: ConnectorsKey) => string
  /** Locale key of the visible label. */
  labelKey: ConnectorsKey
  /** Locale key of the one-line explanation under the control. */
  hintKey: ConnectorsKey
  /** The control's staged state. */
  field: ConnectorFieldState
  /** Disables the control while the settings document is read-only. */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/**
 * The label row every control shares: name, override badge, and the reset that
 * stages a clear back to the composition layer.
 * @param props - the control's copy, its staged state, and the reset action.
 * @param props.id - id of the control this row labels.
 * @returns the label row.
 */
function FieldHead(props: ConnectorFieldProps & { id: string }) {
  return (
    <div className={css.fieldHead}>
      <label className={css.fieldLabel} htmlFor={props.id}>{props.t(props.labelKey)}</label>
      {props.field.overridden
        ? (
          <span className={css.badges}>
            <span className={css.badge}>{props.t('overridden')}</span>
            <button type="button" className={css.reset} disabled={props.disabled} onClick={props.onReset}>
              {props.t('reset')}
            </button>
          </span>
        )
        : null}
    </div>
  )
}

/**
 * A staged text control. `numeric` only hints the keypad: which drafts a field
 * takes is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the control's copy, its staged state, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(props: ConnectorFieldProps & {
  /** Hints a numeric keypad without narrowing what the control takes. */
  numeric?: boolean
}) {
  const id = useId()
  const { field } = props
  return (
    <div className={css.field}>
      <FieldHead {...props} id={id} />
      <input
        id={id}
        className={field.invalid ? `${css.input} ${css.inputInvalid}` : css.input}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...field.invalid ? { 'aria-invalid': true } : {}}
        value={field.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={field.invalid ? css.invalid : css.hint}>
        {props.t(field.invalid ? 'invalid' : props.hintKey)}
      </p>
    </div>
  )
}

/**
 * A fixed-choice control. The empty option is what clears the field, so
 * re-inheriting the composition layer stays reachable without the reset badge.
 * @param props - the control's copy, its staged state, and the choice labels.
 * @param props.choices - value and locale key of each option, in display order.
 * @returns the labelled control.
 */
export function ChoiceField(props: ConnectorFieldProps & {
  choices: ReadonlyArray<{ value: string; labelKey: ConnectorsKey }>
}) {
  const id = useId()
  const { field } = props
  return (
    <div className={css.field}>
      <FieldHead {...props} id={id} />
      <select
        id={id}
        className={css.select}
        value={field.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      >
        <option value="" />
        {props.choices.map(choice => (
          <option key={choice.value} value={choice.value}>{props.t(choice.labelKey)}</option>
        ))}
      </select>
      <p className={css.hint}>{props.t(props.hintKey)}</p>
    </div>
  )
}
