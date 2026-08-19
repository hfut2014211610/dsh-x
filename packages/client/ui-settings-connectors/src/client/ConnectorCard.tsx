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
  /** Anything else the channel wants read when its card is opened. */
  onOpen?: () => void
  /** Switch the channel's plugin on or off. */
  onSetEnabled: (enabled: boolean) => void
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The channel's controls, rendered only while its namespace is served. */
  children: ReactNode
  /**
   * Sign-in and permissions, when the channel has any. It sits below the
   * settings and outside their save: authorizing is not an edit waiting to be
   * written, it happens the moment it is asked for.
   */
  auth?: ReactNode
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
  const { onReadPresence, onOpen } = props
  useEffect(() => {
    if (!open) return
    onReadPresence()
    onOpen?.()
  }, [open, onReadPresence, onOpen])
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
                  {props.auth}
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
 * An either/or between two ways of setting a channel up.
 *
 * Radios rather than a disclosure per branch: the two paths are exclusive, and
 * two independently-openable sections would let someone fill in both and have
 * no way to tell which one is in effect. Each option carries the sentence that
 * says who it is for, because the names alone ("own app", "reuse") do not tell
 * a first-time reader which one they are.
 * @param props - the group's copy and the current choice.
 * @param props.t - locale reader for this page's copy.
 * @param props.labelKey - locale key naming the choice being made.
 * @param props.options - the branches, in display order.
 * @param props.value - the branch in effect.
 * @param props.disabled - disables the whole group while the document is read-only.
 * @param props.onChange - pick a branch.
 * @returns the branch selector.
 */
export function BranchField(props: {
  t: (key: ConnectorsKey) => string
  labelKey: ConnectorsKey
  options: ReadonlyArray<{ value: string; nameKey: ConnectorsKey; whyKey: ConnectorsKey }>
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const name = useId()
  return (
    <div className={css.field} role="radiogroup" aria-label={props.t(props.labelKey)}>
      <span className={css.fieldLabel}>{props.t(props.labelKey)}</span>
      <div className={css.branch}>
        {props.options.map(option => (
          <label
            key={option.value}
            className={option.value === props.value ? `${css.branchOption} ${css.branchOptionActive}` : css.branchOption}
          >
            <input
              className={css.branchRadio}
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === props.value}
              disabled={props.disabled}
              onChange={() => { props.onChange(option.value) }}
            />
            <span className={css.branchText}>
              <span className={css.branchName}>{props.t(option.nameKey)}</span>
              <span className={css.branchWhy}>{props.t(option.whyKey)}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * A list control, one entry per line.
 *
 * A textarea rather than a row of chips: the lists these cards carry are
 * pasted in from a config file or a chat message far more often than they are
 * typed one at a time, and paste into a chip row loses the line breaks.
 * @param props - the control's copy, its staged state, and the edit actions.
 * @param props.rows - visible line count; three fits the usual two or three entries.
 * @returns the labelled control.
 */
export function ListField(props: ConnectorFieldProps & { rows?: number }) {
  const id = useId()
  const { field } = props
  return (
    <div className={css.field}>
      <FieldHead {...props} id={id} />
      <textarea
        id={id}
        className={field.invalid ? `${css.textarea} ${css.inputInvalid}` : css.textarea}
        rows={props.rows ?? 3}
        spellCheck={false}
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
 * A named group of controls with a rule above it.
 *
 * A card that carries three unrelated groups — how a session behaves, who may
 * use it, which apps it listens on — reads as one long undifferentiated form
 * without them, and the reader has no way to tell which knob belongs to which
 * question.
 * @param props - the group's heading, its lead line, and its controls.
 * @param props.t - locale reader for this page's copy.
 * @param props.titleKey - locale key of the group heading.
 * @param props.leadKey - locale key of the line under the heading, when it needs one.
 * @param props.children - the group's controls.
 * @returns the group.
 */
export function FieldGroup(props: {
  t: (key: ConnectorsKey) => string
  titleKey: ConnectorsKey
  leadKey?: ConnectorsKey
  children: ReactNode
}) {
  return (
    <section className={css.group}>
      <h4 className={css.groupHeading}>{props.t(props.titleKey)}</h4>
      {props.leadKey === undefined ? null : <p className={css.hint}>{props.t(props.leadKey)}</p>}
      {props.children}
    </section>
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
