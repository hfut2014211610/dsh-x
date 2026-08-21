/**
 * Dedicated Werewolf conversation view: lobby, covered role reveal, night/day
 * table, generic action forms, spectator state, result, and authorized
 * replay. All data and callbacks arrive through injected props from the
 * host-authorized projection; the component never reads Cordis context.
 * @module ./WerewolfView
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WerewolfKey } from './locales.ts'
import type {
  WerewolfHumanViewV1,
  WerewolfLobbyViewV1,
  WerewolfReplayV1,
} from '@deepseek-ai/dsh-werewolf/types'
import type { WerewolfActionSpecJsonV1, WerewolfSingleActionSpecJsonV1 } from '@deepseek-ai/dsh-werewolf/types'
import styles from './WerewolfView.module.css'

/** One value a closed spec field accepts, derived for the shared renderer. */
interface FieldChoice {
  id: string
  label: string
  disabledReason?: string
}

/** The inject face: typed Remote verbs plus the invalidation feed. */
export interface WerewolfViewInjected {
  /** Lobby listing available before any game exists. */
  getLobby: () => Promise<WerewolfLobbyViewV1>
  /** Start one game on the exact rule-set pair with a fresh seed. */
  start: (request: {
    requestId: string
    expectedGameRevision: 0
    ruleSetId: string
    ruleSetRevision: number
    seed: number
  }) => Promise<WerewolfHumanViewV1>
  /** Re-read the current authorized projection. */
  getView: (gameId: string) => Promise<WerewolfHumanViewV1>
  /** Submit the current action form value. */
  submitAction: (request: {
    gameId: string
    requestId: string
    expectedGameRevision: number
    phaseInstanceId: string
    action: import('@deepseek-ai/dsh-session/types').JsonValue
  }) => Promise<WerewolfHumanViewV1>
  /** Resume one paused game. */
  resume: (request: { gameId: string; requestId: string; expectedGameRevision: number }) => Promise<WerewolfHumanViewV1>
  /** Abort one running or paused game. */
  abortGame: (request: { gameId: string; requestId: string; expectedGameRevision: number }) => Promise<WerewolfHumanViewV1>
  /** Read the authorized terminal replay. */
  getReplay: (gameId: string) => Promise<WerewolfReplayV1>
  /** Invalidation feed; the listener ignores other games. */
  subscribeInvalidated: (listener: (gameId: string) => void) => () => void
  /** Locale dictionary bound to this namespace. */
  translate: (key: WerewolfKey, params?: Record<string, string | number>) => string
}

function newRequestId(): string {
  return crypto.randomUUID()
}

/** Fill a template like `{count} left` from params. */
function fill(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`))
}

/** The main view component; see the module doc for the interaction states. */
export function WerewolfView(props: { sessionId: string } & WerewolfViewInjected): React.JSX.Element {
  const { sessionId, translate } = props
  const t = useCallback((key: WerewolfKey, params?: Record<string, string | number>) => fill(translate(key), params), [translate])
  const [lobby, setLobby] = useState<WerewolfLobbyViewV1 | null>(null)
  const [view, setView] = useState<WerewolfHumanViewV1 | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<Record<string, string | null>>({})
  const [replay, setReplay] = useState<WerewolfReplayV1 | null>(null)
  const viewRef = useRef<WerewolfHumanViewV1 | null>(null)
  viewRef.current = view

  const applyResult = useCallback((next: WerewolfHumanViewV1) => {
    setView(next)
    setError(null)
    setDraft('')
    setSelected({})
  }, [])

  useEffect(() => {
    void (async () => {
      setBusy(true)
      try {
        setLobby(await props.getLobby())
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(false)
      }
    })()
    return props.subscribeInvalidated((gameId) => {
      if (viewRef.current?.gameId !== gameId) return
      void (async () => {
        try {
          applyResult(await props.getView(gameId))
        } catch {
          // The invalidation lost a race with a newer mutation response; the
          // next mutation or invalidation carries the fresh projection.
        }
      })()
    })
    // The inject face is stable for the session lifetime.
  }, [sessionId])

  const onStart = useCallback((ruleSetId: string, ruleSetRevision: number) => {
    void (async () => {
      setBusy(true)
      try {
        applyResult(await props.start({
          requestId: newRequestId(),
          expectedGameRevision: 0,
          ruleSetId,
          ruleSetRevision,
          seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
        }))
        setRevealed(false)
        setReady(false)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(false)
      }
    })()
  }, [props, applyResult])

  const mutate = useCallback(async (run: () => Promise<WerewolfHumanViewV1>) => {
    setBusy(true)
    try {
      applyResult(await run())
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [applyResult])

  if (view === null) {
    return (
      <section className={styles.lobby} aria-label={t('lobby.title')} data-testid="werewolf-lobby">
        <h2>{t('lobby.title')}</h2>
        <p>{t('lobby.subtitle')}</p>
        {(lobby?.availableRuleSets ?? []).length === 0
          ? <p role="status">{t('lobby.unavailable')}</p>
          : (
            <ul className={styles.rules}>
              {/* v8 ignore start -- the empty-list ternary above already proved
                  availableRuleSets non-empty in this render pass, so the fallback
                  array here is unreachable. */
                (lobby?.availableRuleSets ?? []).map(rule => (
                  /* v8 ignore stop */ <li key={`${rule.id}@${rule.revision}`} className={styles.ruleCard}>
                    <div className={styles.ruleName}>{rule.displayName}</div>
                    <div>{t('lobby.players', { count: rule.playerCount })}</div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>{  onStart(rule.id, rule.revision) }}
                    >
                      {busy ? t('lobby.starting') : t('lobby.start')}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        {error !== null && (
          <p role="alert">
            {t('error.title')}
            {error === '' ? '' : `: ${error}`}
            {' '}
            <button type="button" onClick={() =>{  setError(null) }}>{t('error.retry')}</button>
          </p>
        )}
        {busy && <p role="status" aria-live="polite">{t('busy.label')}</p>}
      </section>
    )
  }

  if (view.result !== null) {
    const self = view.players.find(player => player.playerId === view.self.playerId)
    return (
      <section className={styles.result} aria-label={t('result.title')} data-testid="werewolf-result">
        <h2>{t('result.title')}</h2>
        <p className={styles.outcome}>
          {view.result.outcome.kind === 'faction'
            ? t(view.result.outcome.factionId === 'wolf' ? 'result.wolf' : 'result.village')
            : t(view.result.outcome.kind === 'tie' ? 'result.tie' : 'result.aborted')}
        </p>
        <p>{t('result.summary', { outcome: self?.alive === true ? t('result.survived') : t('result.eliminated') })}</p>
        <ul className={styles.roster}>
          {view.players.map(player => (
            <li key={player.playerId}>
              {player.displayName}
              {' — '}
              {player.revealedRole?.name ?? t('table.unknownRole')}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void mutateReplay(props, view.gameId, setReplay, setBusy, setError)}
          >
            {t('result.review')}
          </button>
          <button type="button" onClick={() => { setView(null); setRevealed(false); setReady(false) }}>
            {t('result.newGame')}
          </button>
        </div>
        {replay !== null && (
          <div className={styles.replay} data-testid="werewolf-replay" aria-label={t('replay.title')}>
            <h3>{t('replay.title')}</h3>
            <ol>
              {replay.checkpoints.map((checkpoint, index) => (
                <li key={index}>{t('replay.checkpoint', { revision: checkpoint.gameRevision, type: checkpoint.eventType })}</li>
              ))}
            </ol>
            <button type="button" onClick={() =>{  setReplay(null) }}>{t('replay.close')}</button>
          </div>
        )}
        {error !== null && (
          <p role="alert">
            {t('error.title')}
            {error === '' ? '' : `: ${error}`}
          </p>
        )}
      </section>
    )
  }

  if (!revealed || !ready) {
    const teammates = view.self.teammates
      .map(mate => view.players.find(player => player.playerId === mate.playerId)?.displayName ?? mate.seat)
      .join(', ')
    const resources = Object.entries(view.self.resources)
    return (
      <section className={styles.reveal} aria-label={t('reveal.title')} data-testid="werewolf-reveal">
        <h2>{t('reveal.title')}</h2>
        {!revealed
          ? (
            <>
              <p>{t('reveal.covered')}</p>
              <button type="button" className={styles.cardBack} onClick={() =>{  setRevealed(true) }}>
                {t('reveal.action')}
              </button>
            </>
          )
          : (
            <>
              <dl>
                <dt>{t('table.role')}</dt>
                <dd>{view.self.role.name}</dd>
                <dt>{t('reveal.faction', { faction: view.self.role.faction })}</dt>
                <dd>{teammates.length > 0 ? t('reveal.teammates', { names: teammates }) : t('reveal.none')}</dd>
              </dl>
              {resources.length > 0 && (
                <>
                  <h3>{t('reveal.resources')}</h3>
                  <ul>
                    {resources.map(([id, remaining]) => (
                      <li key={id}>{id}: {remaining}</li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" onClick={() =>{  setReady(true) }} autoFocus>{t('reveal.ready')}</button>
            </>
          )}
      </section>
    )
  }

  const night = view.phase !== null && view.phase.segment === 'night'
  const humanSeat = view.players.find(player => player.human)
  const selfAlive = humanSeat?.alive ?? true
  const form = view.actionForm
  return (
    <section
      className={night ? `${styles.table} ${styles.night}` : styles.table}
      aria-label={t('table.title')}
      data-testid="werewolf-table"
      aria-live="off"
    >
      <h2 className={styles.phaseHeading} tabIndex={-1}>
        {night ? t('table.night', { day: view.day }) : t('table.day', { day: view.day })}
        {'·'}
        {view.phase !== null ? t('table.phase', { phase: view.phase.phaseId }) : t('table.empty')}
      </h2>
      {night && <p className={styles.hint}>{t('night.privateHint')}</p>}
      <div className={styles.columns}>
        <aside className={styles.timeline} aria-label={t('table.timeline')}>
          <h3>{t('table.timeline')}</h3>
          {view.timeline.length === 0
            ? <p>{t('table.empty')}</p>
            : (
              <ol>
                {view.timeline.map(entry => (
                  <li key={entry.id}>
                    {entry.day}
                    {'·'}
                    {entry.phaseId}
                    {'·'}
                    {entry.kind}
                  </li>
                ))}
              </ol>
            )}
        </aside>
        <div className={styles.seats} role="list">
          {view.players.map(player => (
            <div
              key={player.playerId}
              role="listitem"
              className={[
                styles.seat,
                player.alive ? '' : styles.dead,
                player.human ? styles.self : '',
                selectedTargetOf(selected) === player.playerId ? styles.selected : '',
              ].filter(Boolean).join(' ')}
            >
              <span className={styles.seatName}>
                {t('table.seat', { seat: player.seat })}
                {'·'}
                {player.displayName}
                {player.human ? ` (${t('table.you')})` : ''}
              </span>
              <span>{player.alive ? t('table.alive') : player.deathDay !== undefined ? t('table.deadOn', { day: player.deathDay }) : t('table.dead')}</span>
              <span>{player.revealedRole?.name ?? t('table.unknownRole')}</span>
            </div>
          ))}
        </div>
        <aside className={styles.selfPane} aria-label={t('table.notices')}>
          <h3>{t('table.role')}</h3>
          <p>{view.self.role.name}</p>
          <h3>{t('table.notices')}</h3>
          {view.self.notices.length === 0
            ? <p>{t('table.noNotices')}</p>
            : (
              <ul>
                {view.self.notices.map((notice, index) => (
                  <li key={index}>{notice.kind}</li>
                ))}
              </ul>
            )}
        </aside>
      </div>
      {!selfAlive && (
        <p role="status" className={styles.hint} data-testid="werewolf-spectator">
          <strong>{t('spectator.title')}</strong>
          {' '}
          {t('spectator.hint')}
        </p>
      )}
      {view.status === 'paused' && (
        <div className={styles.paused} data-testid="werewolf-paused">
          <h3>{t('paused.title')}</h3>
          <p>{t('paused.reason', { reason: view.pauseReason ?? '' })}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void mutate(() => props.resume({
              gameId: view.gameId, requestId: newRequestId(), expectedGameRevision: view.gameRevision,
            }))}
          >
            {busy ? t('paused.resuming') : t('paused.resume')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('paused.confirmAbort'))) {
                void mutate(() => props.abortGame({
                  gameId: view.gameId, requestId: newRequestId(), expectedGameRevision: view.gameRevision,
                }))
              }
            }}
          >
            {t('paused.abort')}
          </button>
        </div>
      )}
      {selfAlive && form !== null && view.status === 'running' && (
        <ActionForm
          form={form}
          players={view.players}
          draft={draft}
          selected={selected}
          busy={busy}
          onDraft={setDraft}
          onSelect={(fieldId, value) =>{  setSelected(current => ({ ...current, [fieldId]: value })) }}
          onSubmit={() => {
            const action = buildAction(form.spec, draft, selected)
            void mutate(() => props.submitAction({
              gameId: view.gameId,
              requestId: newRequestId(),
              expectedGameRevision: view.gameRevision,
              phaseInstanceId: form.phaseInstanceId,
              action,
            }))
          }}
          t={t}
        />
      )}
      {busy && <p role="status" aria-live="polite">{t('busy.label')}</p>}
      {error !== null && (
        <p role="alert">
          {t('error.title')}
          {error === '' ? '' : `: ${error}`}
          {' '}
          <button type="button" onClick={() =>{  setError(null) }}>{t('error.retry')}</button>
        </p>
      )}
    </section>
  )
}

function selectedTargetOf(selected: Record<string, string | null>): string | null {
  for (const value of Object.values(selected)) {
    if (value !== null) return value
  }
  return null
}

async function mutateReplay(
  props: WerewolfViewInjected,
  gameId: string,
  setReplay: (replay: WerewolfReplayV1 | null) => void,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  setBusy(true)
  try {
    setReplay(await props.getReplay(gameId))
  } catch (cause) {
    setError((cause as Error).message)
  } finally {
    setBusy(false)
  }
}

/** Build the action JSON one form submit sends. */
export function buildAction(
  spec: WerewolfActionSpecJsonV1,
  draft: string,
  selected: Record<string, string | null>,
): import('@deepseek-ai/dsh-session/types').JsonValue {
  if (spec.kind === 'compound') {
    const action: Record<string, import('@deepseek-ai/dsh-session/types').JsonValue> = {}
    for (const field of spec.fields) {
      action[field.id] = fieldValue(field.spec, field.id, draft, selected)
    }
    return action
  }
  return { value: fieldValue(spec, 'value', draft, selected) }
}

function fieldValue(
  spec: WerewolfSingleActionSpecJsonV1,
  fieldId: string,
  draft: string,
  selected: Record<string, string | null>,
): string | null {
  if (spec.kind === 'text') {
    const trimmed = draft.trim()
    return trimmed.length > 0 ? trimmed.slice(0, spec.maxChars) : null
  }
  const value = selected[fieldId] ?? null
  return value
}

/** Choices one spec field offers, resolved against the current roster. */
export function fieldChoices(
  spec: WerewolfSingleActionSpecJsonV1,
  players: WerewolfHumanViewV1['players'],
): FieldChoice[] {
  if (spec.kind === 'player-target') {
    return spec.targets.map((target) => {
      const player = players.find(candidate => candidate.playerId === target)
      return {
        id: target,
        label: player === undefined ? target : `${player.seat} · ${player.displayName}`,
        ...(player?.alive === false ? { disabledReason: 'dead' } : {}),
      }
    })
  }
  if (spec.kind === 'choice') {
    return spec.options.map(option => ({ id: option, label: option }))
  }
  return []
}

/** The generic action form over the closed spec vocabulary. */
function ActionForm(input: {
  form: NonNullable<WerewolfHumanViewV1['actionForm']>
  players: WerewolfHumanViewV1['players']
  draft: string
  selected: Record<string, string | null>
  busy: boolean
  onDraft: (draft: string) => void
  onSelect: (fieldId: string, value: string | null) => void
  onSubmit: () => void
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string
}): React.JSX.Element {
  const { form, players, draft, selected, busy, onDraft, onSelect, onSubmit, t } = input
  const spec = form.spec
  const fields = spec.kind === 'compound' ? spec.fields : [{ id: 'value', spec }]
  const allowSkip = spec.allowSkip
  const canSubmit = useMemo(() => {
    if (spec.kind === 'text') return allowSkip || draft.trim().length > 0
    if (spec.kind === 'compound') {
      return spec.fields.every(field =>
        field.spec.kind === 'text' ? true : (selected[field.id] ?? null) !== null)
    }
    return allowSkip || (selected.value ?? null) !== null
  }, [spec, draft, selected, allowSkip])
  return (
    <form
      className={styles.actionForm}
      aria-label={spec.kind === 'text' ? t('speech.title') : t('action.title')}
      data-testid="werewolf-action-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit && !busy) onSubmit()
      }}
    >
      <h3>{spec.kind === 'text' ? t('speech.title') : t('action.title')}</h3>
      {spec.kind === 'player-target' && (selected.value ?? null) !== null && (
        <p className={styles.selectedName} data-testid="werewolf-selected-target">
          {t('vote.selected', {
            /* v8 ignore next 2 -- selected.value always names one id from this
               spec's own fieldChoices and the paragraph guard proved it non-null,
               so the lookup-miss and empty-string arms are unreachable. */
            name: fieldChoices(spec, players).find(choice => choice.id === selected.value)?.label
              ?? (selected.value ?? ''),
          })}
        </p>
      )}
      {fields.map(field => (
        <fieldset key={field.id}>
          <legend>{field.id}</legend>
          {field.spec.kind === 'text'
            ? (
              <>
                <label>
                  <span className={styles.speechLabel}>{t('speech.placeholder')}</span>
                  <textarea
                    value={draft}
                    maxLength={field.spec.maxChars}
                    placeholder={t('speech.placeholder')}
                    onChange={(event) =>{  onDraft(event.target.value) }}
                    aria-describedby={`${field.id}-remaining`}
                  />
                </label>
                <p id={`${field.id}-remaining`}>
                  {t('speech.remaining', { count: Math.max(0, field.spec.maxChars - draft.length) })}
                </p>
              </>
            )
            : (
              <div className={styles.choices} role="radiogroup" aria-label={field.id}>
                {fieldChoices(field.spec, players).map(choice => (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    aria-checked={selected[field.id] === choice.id}
                    className={selected[field.id] === choice.id ? styles.selected : ''}
                    disabled={choice.disabledReason !== undefined}
                    onClick={() =>{  onSelect(field.id, selected[field.id] === choice.id ? null : choice.id) }}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
        </fieldset>
      ))}
      <div className={styles.actions}>
        <button type="submit" disabled={busy || !canSubmit}>
          {spec.kind === 'text' ? t('speech.speak') : spec.kind === 'player-target' ? t('vote.confirm') : t('action.submit')}
        </button>
        {allowSkip && (
          <button
            type="button"
            title={t('action.passLabel')}
            disabled={busy}
            onClick={() => {
              for (const field of fields) onSelect(field.id, null)
              if (spec.kind === 'text') onDraft('')
            }}
          >
            {spec.kind === 'text' ? t('speech.pass') : t('vote.abstain')}
          </button>
        )}
      </div>
    </form>
  )
}
