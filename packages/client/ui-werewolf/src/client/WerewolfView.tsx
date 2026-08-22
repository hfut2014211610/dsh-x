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
}

/** The inject face: typed Remote verbs plus the invalidation feed. */
export interface WerewolfViewInjected {
  /** Game bound to the rendered Host Session, when this is not a launcher. */
  initialGameId?: string
  /** Navigate from a launcher session to the dedicated game Host Session. */
  openGame: (gameId: string) => void
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
  const {
    sessionId, translate, initialGameId, getLobby, getView, subscribeInvalidated, openGame,
  } = props
  const t = useCallback((key: WerewolfKey, params?: Record<string, string | number>) => fill(translate(key), params), [translate])
  const [lobby, setLobby] = useState<WerewolfLobbyViewV1 | null>(null)
  const [view, setView] = useState<WerewolfHumanViewV1 | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [ready, setReady] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, string | null>>({})
  const [replay, setReplay] = useState<WerewolfReplayV1 | null>(null)
  const [retry, setRetry] = useState<(() => void) | null>(null)
  const viewRef = useRef<WerewolfHumanViewV1 | null>(null)
  const phaseHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const priorPhaseRef = useRef<string | undefined>(undefined)
  viewRef.current = view

  const applyResult = useCallback((next: WerewolfHumanViewV1) => {
    const current = viewRef.current
    if (current?.gameId === next.gameId && next.gameRevision < current.gameRevision) return false
    const sameForm = current?.gameId === next.gameId
      && current.actionForm?.phaseInstanceId === next.actionForm?.phaseInstanceId
    const changedGame = current?.gameId !== next.gameId
    viewRef.current = next
    setView(next)
    setError(null)
    setRetry(null)
    if (!sameForm) {
      setDrafts({})
      setSelected({})
    }
    if (changedGame) {
      setRevealed(false)
      setReady(false)
      setReplay(null)
    }
    return true
  }, [])

  const fail = useCallback((cause: unknown, rerun: () => void) => {
    setError(cause instanceof Error ? cause.message : String(cause))
    setRetry(() => rerun)
  }, [])

  const loadLobby = useCallback(() => {
    const run = (): void => { void (async () => {
      setBusy(true)
      try {
        setLobby(await getLobby())
        setError(null)
        setRetry(null)
      } catch (cause) {
        fail(cause, run)
      } finally {
        setBusy(false)
      }
    })() }
    run()
  }, [getLobby, fail])

  const loadGame = useCallback((gameId: string) => {
    const run = (): void => { void (async () => {
      setBusy(true)
      try {
        applyResult(await getView(gameId))
      } catch (cause) {
        fail(cause, run)
      } finally {
        setBusy(false)
      }
    })() }
    run()
  }, [getView, applyResult, fail])

  useEffect(() => {
    const refresh = (gameId: string): void => {
      void getView(gameId)
        .then(applyResult)
        .catch((cause: unknown) => { fail(cause, () => { refresh(gameId) }) })
    }
    const stop = subscribeInvalidated((gameId) => {
      if (viewRef.current?.gameId !== gameId) return
      refresh(gameId)
    })
    if (initialGameId === undefined) loadLobby()
    else loadGame(initialGameId)
    return stop
  }, [sessionId, initialGameId, subscribeInvalidated, getView, applyResult, fail, loadLobby, loadGame])

  const phaseInstanceId = view?.phase?.phaseInstanceId
  useEffect(() => {
    const prior = priorPhaseRef.current
    priorPhaseRef.current = phaseInstanceId
    if (ready && prior !== undefined && phaseInstanceId !== prior) phaseHeadingRef.current?.focus()
  }, [phaseInstanceId, ready])

  const onStart = useCallback((ruleSetId: string, ruleSetRevision: number) => {
    const request = {
      requestId: newRequestId(),
      expectedGameRevision: 0 as const,
      ruleSetId,
      ruleSetRevision,
      seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    }
    const run = (): void => { void (async () => {
      setBusy(true)
      try {
        const next = await props.start(request)
        applyResult(next)
        openGame(next.gameId)
      } catch (cause) {
        fail(cause, run)
      } finally {
        setBusy(false)
      }
    })() }
    run()
  }, [props.start, applyResult, openGame, fail])

  const mutate = useCallback(async (input: {
    gameId: string
    run: () => Promise<WerewolfHumanViewV1>
    retry: () => void
    applicable: () => boolean
  }) => {
    setBusy(true)
    try {
      applyResult(await input.run())
    } catch (cause) {
      try {
        applyResult(await getView(input.gameId))
      } catch {
        // Preserve the mutation diagnostic; the same idempotency key remains retryable.
      }
      if (input.applicable()) fail(cause, input.retry)
    } finally {
      setBusy(false)
    }
  }, [applyResult, getView, fail])

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
        {error !== null && <ErrorAlert error={error} retry={retry} busy={busy} t={t} />}
        {busy && <p role="status" aria-live="polite">{t('busy.label')}</p>}
      </section>
    )
  }

  if (view.result !== null) {
    const self = view.players.find(player => player.playerId === view.self.playerId)
    const review = (): void => {
      void mutateReplay(props, view.gameId, setReplay, setBusy, setError, setRetry, fail, review)
    }
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
            onClick={review}
          >
            {t('result.review')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              viewRef.current = null
              setView(null)
              setRevealed(false)
              setReady(false)
              setReplay(null)
              loadLobby()
            }}
          >
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
        {error !== null && <ErrorAlert error={error} retry={retry} busy={busy} t={t} />}
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
  const resume = (): void => {
    const current = viewRef.current
    if (current?.gameId !== view.gameId || current.status !== 'paused') return
    const requestId = newRequestId()
    const run = (): void => {
      const latest = viewRef.current
      if (latest?.gameId !== view.gameId || latest.status !== 'paused') return
      void mutate({
        gameId: view.gameId,
        run: async () => await props.resume({
          gameId: view.gameId, requestId, expectedGameRevision: latest.gameRevision,
        }),
        retry: run,
        applicable: () => viewRef.current?.gameId === view.gameId && viewRef.current.status === 'paused',
      })
    }
    run()
  }
  const abort = (): void => {
    const requestId = newRequestId()
    const run = (): void => {
      const latest = viewRef.current
      if (latest?.gameId !== view.gameId || latest.status === 'ended') return
      void mutate({
        gameId: view.gameId,
        run: async () => await props.abortGame({
          gameId: view.gameId, requestId, expectedGameRevision: latest.gameRevision,
        }),
        retry: run,
        applicable: () => viewRef.current?.gameId === view.gameId && viewRef.current.status !== 'ended',
      })
    }
    run()
  }
  const submit = (action: import('@deepseek-ai/dsh-session/types').JsonValue): void => {
    if (form === null) return
    const requestId = newRequestId()
    const phase = form.phaseInstanceId
    const run = (): void => {
      const latest = viewRef.current
      if (latest?.gameId !== view.gameId || latest.actionForm?.phaseInstanceId !== phase) return
      void mutate({
        gameId: view.gameId,
        run: async () => await props.submitAction({
          gameId: view.gameId,
          requestId,
          expectedGameRevision: latest.gameRevision,
          phaseInstanceId: phase,
          action,
        }),
        retry: run,
        applicable: () => viewRef.current?.gameId === view.gameId
          && viewRef.current.actionForm?.phaseInstanceId === phase,
      })
    }
    run()
  }
  return (
    <section
      className={night ? `${styles.table} ${styles.night}` : styles.table}
      aria-label={t('table.title')}
      data-testid="werewolf-table"
      aria-live="off"
    >
      <h2 ref={phaseHeadingRef} className={styles.phaseHeading} tabIndex={-1}>
        {night ? t('table.night', { day: view.day }) : t('table.day', { day: view.day })}
        {'·'}
        {view.phase !== null ? t('table.phase', { phase: view.phase.phaseId }) : t('table.empty')}
      </h2>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {`${night ? t('table.night', { day: view.day }) : t('table.day', { day: view.day })} · ${
          view.phase !== null ? t('table.phase', { phase: view.phase.phaseId }) : t('table.empty')
        }`}
      </p>
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
            onClick={resume}
          >
            {busy ? t('paused.resuming') : t('paused.resume')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('paused.confirmAbort'))) {
                abort()
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
          drafts={drafts}
          selected={selected}
          busy={busy}
          onDraft={(fieldId, value) => { setDrafts(current => ({ ...current, [fieldId]: value })) }}
          onSelect={(fieldId, value) =>{  setSelected(current => ({ ...current, [fieldId]: value })) }}
          onSubmit={() => {
            submit(buildAction(form.spec, drafts, selected))
          }}
          onSkip={() => { submit(buildSkippedAction(form.spec)) }}
          t={t}
        />
      )}
      {busy && <p role="status" aria-live="polite">{t('busy.label')}</p>}
      {error !== null && <ErrorAlert error={error} retry={retry} busy={busy} t={t} />}
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
  setRetry: (retry: (() => void) | null) => void,
  fail: (cause: unknown, retry: () => void) => void,
  retry: () => void,
): Promise<void> {
  setBusy(true)
  try {
    setReplay(await props.getReplay(gameId))
    setError(null)
    setRetry(null)
  } catch (cause) {
    fail(cause, retry)
  } finally {
    setBusy(false)
  }
}

function ErrorAlert(input: {
  error: string
  retry: (() => void) | null
  busy: boolean
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string
}): React.JSX.Element {
  return (
    <p role="alert">
      {input.t('error.title')}
      {input.error === '' ? '' : `: ${input.error}`}
      {input.retry !== null && (
        <>
          {' '}
          <button type="button" disabled={input.busy} onClick={input.retry}>{input.t('error.retry')}</button>
        </>
      )}
    </p>
  )
}

/** Build the action JSON one form submit sends. */
export function buildAction(
  spec: WerewolfActionSpecJsonV1,
  drafts: Record<string, string>,
  selected: Record<string, string | null>,
): import('@deepseek-ai/dsh-session/types').JsonValue {
  if (spec.kind === 'compound') {
    const action: Record<string, import('@deepseek-ai/dsh-session/types').JsonValue> = {}
    for (const field of spec.fields) {
      action[field.id] = fieldValue(field.spec, field.id, drafts, selected)
    }
    return action
  }
  return { value: fieldValue(spec, 'value', drafts, selected) }
}

/** Build the explicit null action sent by a visible skip control. */
export function buildSkippedAction(
  spec: WerewolfActionSpecJsonV1,
): import('@deepseek-ai/dsh-session/types').JsonValue {
  if (spec.kind !== 'compound') return { value: null }
  return Object.fromEntries(spec.fields.map(field => [field.id, null]))
}

function fieldValue(
  spec: WerewolfSingleActionSpecJsonV1,
  fieldId: string,
  drafts: Record<string, string>,
  selected: Record<string, string | null>,
): string | null {
  if (spec.kind === 'text') {
    const trimmed = (drafts[fieldId] ?? '').trim()
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
  drafts: Record<string, string>
  selected: Record<string, string | null>
  busy: boolean
  onDraft: (fieldId: string, draft: string) => void
  onSelect: (fieldId: string, value: string | null) => void
  onSubmit: () => void
  onSkip: () => void
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string
}): React.JSX.Element {
  const { form, players, drafts, selected, busy, onDraft, onSelect, onSubmit, onSkip, t } = input
  const spec = form.spec
  const fields = spec.kind === 'compound' ? spec.fields : [{ id: 'value', spec }]
  const allowSkip = spec.allowSkip
  const canSubmit = useMemo(() => {
    if (spec.kind === 'text') return allowSkip || (drafts.value ?? '').trim().length > 0
    if (spec.kind === 'compound') {
      return spec.fields.every(field =>
        field.spec.kind === 'text'
          ? field.spec.allowSkip || (drafts[field.id] ?? '').trim().length > 0
          : field.spec.allowSkip || (selected[field.id] ?? null) !== null)
    }
    return allowSkip || (selected.value ?? null) !== null
  }, [spec, drafts, selected, allowSkip])
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
                    value={drafts[field.id] ?? ''}
                    maxLength={field.spec.maxChars}
                    placeholder={t('speech.placeholder')}
                    onChange={(event) =>{  onDraft(field.id, event.target.value) }}
                    aria-describedby={`${field.id}-remaining`}
                  />
                </label>
                <p id={`${field.id}-remaining`}>
                  {t('speech.remaining', { count: Math.max(0, field.spec.maxChars - (drafts[field.id]?.length ?? 0)) })}
                </p>
              </>
            )
            : (
              <div
                className={styles.choices}
                role="radiogroup"
                aria-label={field.id}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onSelect(field.id, null)
                    return
                  }
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                  event.preventDefault()
                  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
                    .filter(button => !button.disabled)
                  if (buttons.length === 0) return
                  const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement))
                  const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
                  const next = buttons[(current + delta + buttons.length) % buttons.length]
                  next?.focus()
                  const value = next?.dataset.choiceId
                  if (value !== undefined) onSelect(field.id, value)
                }}
              >
                {fieldChoices(field.spec, players).map((choice, index) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    data-choice-id={choice.id}
                    aria-checked={selected[field.id] === choice.id}
                    tabIndex={selected[field.id] === choice.id || ((selected[field.id] ?? null) === null && index === 0) ? 0 : -1}
                    className={selected[field.id] === choice.id ? styles.selected : ''}
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
            onClick={onSkip}
          >
            {spec.kind === 'text' ? t('speech.pass') : t('vote.abstain')}
          </button>
        )}
      </div>
    </form>
  )
}
