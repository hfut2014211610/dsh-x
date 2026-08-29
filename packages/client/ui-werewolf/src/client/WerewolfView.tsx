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
import sigil01 from './assets/sigils/sigil-01.png'
import sigil02 from './assets/sigils/sigil-02.png'
import sigil03 from './assets/sigils/sigil-03.png'
import sigil04 from './assets/sigils/sigil-04.png'
import sigil05 from './assets/sigils/sigil-05.png'
import sigil06 from './assets/sigils/sigil-06.png'
import sigil07 from './assets/sigils/sigil-07.png'
import styles from './WerewolfView.module.css'

const SIGIL_URLS = [
  sigil01, sigil02, sigil03, sigil04, sigil05, sigil06, sigil07,
]

/** Per-seat identity sigil asset names, stable-mapped 1..7. */
export function sigilForSeat(seat: number): string {
  const clamped = seat >= 1 && seat <= 7 ? seat : ((seat - 1) % 7 + 7) % 7 + 1
  return `sigil-0${clamped}.png`
}

/** Browser URL for one sigil, served as a static package source. */
function sigilUrl(seat: number): string {
  const index = Number(sigilForSeat(seat).slice(6, 8)) - 1
  return SIGIL_URLS[index] ?? sigil01
}

/** One value a closed spec field accepts, derived for the shared renderer. */
interface FieldChoice {
  id: string
  label: string
}

/** The inject face: typed Remote verbs plus the invalidation feed. */
export interface WerewolfViewInjected {
  /** Game bound to the rendered Host Session, when this is not a launcher. */
  initialGameId?: string
  /** Persist the selected game in the dedicated window URL, or clear it for the lobby. */
  openGame: (gameId?: string) => void
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
export function WerewolfView(props: { sessionId?: string | undefined } & WerewolfViewInjected): React.JSX.Element {
  const {
    translate, initialGameId, getLobby, getView, subscribeInvalidated, openGame,
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
  const [finding, setFinding] = useState<number | null>(null)
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
      setFinding(null)
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
  }, [initialGameId, subscribeInvalidated, getView, applyResult, fail, loadLobby, loadGame])

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
        {(lobby?.activeGames ?? []).length > 0 && (
          <section className={styles.activeGames} aria-label={t('lobby.activeTitle')}>
            <h3>{t('lobby.activeTitle')}</h3>
            <ul>
              {(lobby?.activeGames ?? []).map(game => (
                <li key={game.gameId}>
                  <div>
                    <strong>{game.ruleSet.displayName}</strong>
                    <span>{t('lobby.activeMeta', { day: game.day, status: t(`status.${game.status}`) })}</span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      openGame(game.gameId)
                      loadGame(game.gameId)
                    }}
                  >
                    {t('lobby.continue')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
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
              setFinding(null)
              openGame()
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
  const teammateIds = new Set(view.self.teammates.map(teammate => teammate.playerId))
  const speechFlow = view.phase?.speech ?? null
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
        <span className={styles.signalBrand}>
          <span>{t('table.signalTitle')}</span>
          <small>{t('table.solo')}</small>
        </span>
        <span className={styles.phaseTitle}>
          {night ? t('table.night', { day: view.day }) : t('table.day', { day: view.day })}
          {'·'}
          {view.phase !== null ? t('table.phase', { phase: view.phase.phaseId }) : t('table.empty')}
        </span>
      </h2>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {`${night ? t('table.night', { day: view.day }) : t('table.day', { day: view.day })} · ${
          view.phase !== null ? t('table.phase', { phase: view.phase.phaseId }) : t('table.empty')
        }`}
      </p>
      {night && <p className={styles.hint}>{t('night.privateHint')}</p>}
      {speechFlow !== null && (
        <section className={styles.flowStatus} aria-label={t('speech.title')} data-testid="werewolf-speech-flow">
          <div>
            <span className={styles.flowKicker}>{t('flow.progress', {
              completed: speechFlow.completed,
              total: speechFlow.total,
            })}</span>
            <strong>
              {speechFlow.current?.human === true
                ? t('flow.yourTurn')
                : speechFlow.current === null
                  ? t('flow.progress', { completed: speechFlow.total, total: speechFlow.total })
                  : t('flow.speaking', {
                    seat: speechFlow.current.seat,
                    name: speechFlow.current.displayName,
                  })}
            </strong>
          </div>
          <p>{t('flow.afterSpeeches')}</p>
        </section>
      )}
      <div className={styles.columns}>
        <div className={styles.track} data-testid="werewolf-track" aria-hidden="true">
          {t('table.track', {
            day: view.day,
            phase: view.phase !== null ? view.phase.phaseId : '—',
          })}
        </div>
        <aside className={styles.timeline} aria-label={t('table.timeline')}>
          <h3>{t('table.timeline')}</h3>
          {view.timeline.length === 0
            ? <p>{t('table.empty')}</p>
            : (
              <ol>
                {view.timeline.map(entry => (
                  <TimelineEntry key={entry.id} entry={entry} players={view.players} t={t} />
                ))}
              </ol>
            )}
        </aside>
        <div className={styles.circle} role="list">
          <ul className={styles.circleList}>
            {view.players.map((player, index) => {
              const count = view.players.length
              const angle = count > 0 ? (index / count) * 360 - 90 : 0
              const findingIndex = latestNoticeIndexForTarget(view.self.notices, player.playerId)
              const known = findingIndex >= 0
              const teammate = teammateIds.has(player.playerId)
              return (
                <li
                  key={player.playerId}
                  role="listitem"
                  className={[
                    styles.seat,
                    player.alive ? '' : styles.dead,
                    player.human ? styles.self : '',
                    known ? styles.known : '',
                    teammate ? styles.teammate : '',
                    selectedTargetOf(selected) === player.playerId ? styles.selected : '',
                  ].filter(Boolean).join(' ')}
                  style={{ '--seat-angle': `${angle}deg` } as React.CSSProperties}
                >
                  <img
                    className={styles.sigil}
                    src={sigilUrl(player.seat)}
                    data-sigil={sigilForSeat(player.seat)}
                    alt={t('table.seat', { seat: player.seat })}
                  />
                  <span className={styles.seatName}>
                    {t('table.seat', { seat: player.seat })}
                    {'·'}
                    {player.displayName}
                    {player.human ? ` (${t('table.you')})` : ''}
                  </span>
                  {teammate && (
                    <span className={styles.teammateBadge} aria-label={t('table.teammate')}>
                      <span aria-hidden="true">◆</span>
                      {t('table.teammate')}
                    </span>
                  )}
                  {player.alive
                    ? player.human
                      ? <span>{view.self.role.name}</span>
                      : known ? null : <span>{t('table.knownNone')}</span>
                    : (
                      <span>
                        {player.revealedRole?.name ?? t('table.dead')}
                        {player.deathDay !== undefined ? ` · ${t('table.deadOn', { day: player.deathDay })}` : ''}
                      </span>
                    )}
                  {known && (
                    <button
                      type="button"
                      className={styles.findingOpen}
                      aria-label={t('table.openFinding')}
                      onClick={() => { setFinding(findingIndex) }}
                    >
                      {t('table.openFinding')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <aside className={styles.selfPane} aria-label={t('table.notices')}>
          {finding === null
            ? (
              <>
                <h3>{t('table.role')}</h3>
                <p>{view.self.role.name}</p>
                <h3>{t('finding.title')}</h3>
                {view.self.notices.length === 0
                  ? <p>{t('table.noNotices')}</p>
                  : (
                    <ul>
                      {view.self.notices.map((notice, index) => (
                        <li key={index}>
                          <button type="button" className={styles.findingLink} onClick={() => { setFinding(index) }}>
                            {noticeLabel(notice, t)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            )
            : (
              <FindingDetail
                notices={view.self.notices}
                players={view.players}
                finding={finding}
                onBack={() => { setFinding(null) }}
                onPick={(index) => { setFinding(index) }}
                t={t}
              />
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

/** Render public game events as readable statements instead of raw event tags. */
function TimelineEntry(input: {
  entry: WerewolfHumanViewV1['timeline'][number]
  players: WerewolfHumanViewV1['players']
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string
}): React.JSX.Element {
  const { entry, players, t } = input
  const actor = entry.actorId === undefined
    ? undefined
    : players.find(player => player.playerId === entry.actorId)
  const actorLabel = actor === undefined
    ? entry.actorId ?? ''
    : t(entry.kind === 'vote' ? 'timeline.vote' : 'timeline.speech', {
      seat: actor.seat,
      name: actor.displayName,
    })
  const data = entry.data !== undefined && entry.data !== null
    && typeof entry.data === 'object' && !Array.isArray(entry.data)
    ? entry.data as Record<string, unknown>
    : undefined
  const speech = entry.kind === 'speech' && typeof data?.text === 'string' ? data.text : undefined
  return (
    <li className={entry.kind === 'speech' ? styles.timelineSpeech : styles.timelineEvent}>
      <span className={styles.timelineMeta}>
        {actorLabel !== '' ? actorLabel : t('timeline.event', { day: entry.day, phase: entry.phaseId })}
      </span>
      {entry.kind === 'speech' && <p>{speech ?? t('timeline.pass')}</p>}
    </li>
  )
}

function selectedTargetOf(selected: Record<string, string | null>): string | null {
  for (const value of Object.values(selected)) {
    if (value !== null) return value
  }
  return null
}

/** Latest private notice that names one player, so a known seat opens current information. */
function latestNoticeIndexForTarget(
  notices: Array<{ kind: string; data: import('@deepseek-ai/dsh-session/types').JsonValue }>,
  playerId: string,
): number {
  for (let index = notices.length - 1; index >= 0; index -= 1) {
    const notice = notices[index]
    if (notice !== undefined && noticeTargetId(notice) === playerId) return index
  }
  return -1
}

/** Resolve the player a notice speaks about, when its data names one id. */
function noticeTargetId(notice: { kind: string; data: import('@deepseek-ai/dsh-session/types').JsonValue }): string | null {
  if (notice.data === null || typeof notice.data !== 'object' || Array.isArray(notice.data)) return null
  const target = (notice.data as Record<string, unknown>).target
  return typeof target === 'string' ? target : null
}

/** Short label one notice gets in the findings list. */
function noticeLabel(
  notice: { kind: string; data: import('@deepseek-ai/dsh-session/types').JsonValue },
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string,
): string {
  if (notice.kind === 'seer-inspect') return t('finding.seer')
  if (notice.kind === 'wolf-kill-result') return t('finding.wolfKill')
  return notice.kind
}

/** Render one JSON scalar safely; structured payloads fall back to JSON text. */
function findingValue(value: import('@deepseek-ai/dsh-session/types').JsonValue): string {
  if (value === null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Localize built-in factions while preserving configured extension ids. */
function findingFaction(
  faction: string,
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string,
): string {
  if (faction === 'wolf') return t('finding.factionWolf')
  if (faction === 'village') return t('finding.factionVillage')
  return faction
}

/** Private finding detail: one notice at a time with list-driven switching. */
function FindingDetail(input: {
  notices: Array<{ kind: string; data: import('@deepseek-ai/dsh-session/types').JsonValue }>
  players: WerewolfHumanViewV1['players']
  finding: number
  onBack: () => void
  onPick: (index: number) => void
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string
}): React.JSX.Element {
  const { notices, players, finding, onBack, onPick, t } = input
  const notice = notices[Math.min(finding, notices.length - 1)]
  if (notice === undefined) return <></>
  const targetId = noticeTargetId(notice)
  const data = notice.data !== null && typeof notice.data === 'object' && !Array.isArray(notice.data)
    ? notice.data as Record<string, import('@deepseek-ai/dsh-session/types').JsonValue>
    : {}
  const { faction, day, ...rest } = data
  const victim = notice.kind === 'wolf-kill-result' ? data.victim : undefined
  delete rest.target
  if (notice.kind === 'wolf-kill-result') delete rest.victim
  const extraEntries = Object.entries(rest)
  return (
    <div className={styles.finding} data-testid="werewolf-finding">
      <header className={styles.findingHeader}>
        <div>
          <p className={styles.findingScope}>{t('finding.scope')}</p>
          <h3>{t('finding.title')}</h3>
        </div>
        <span className={styles.findingCount}>{finding + 1} / {notices.length}</span>
      </header>
      <div className={styles.findingLead}>
        <span>{t('finding.type')}</span>
        <strong>{noticeLabel(notice, t)}</strong>
      </div>
      <dl className={styles.findingFacts}>
        {targetId !== null && (
          <div className={styles.findingFact}>
            <dt>{t('finding.target')}</dt>
            <dd>{findingPlayer(targetId, players, t)}</dd>
          </div>
        )}
        {typeof faction === 'string' && (
          <div className={`${styles.findingFact} ${styles.findingResult}`}>
            <dt>{t('finding.faction')}</dt>
            <dd>{findingFaction(faction, t)}</dd>
          </div>
        )}
        {(typeof victim === 'string' || victim === null) && (
          <div className={`${styles.findingFact} ${styles.findingResult}`}>
            <dt>{t('finding.victim')}</dt>
            <dd>{victim === null ? t('finding.noVictim') : findingPlayer(victim, players, t)}</dd>
          </div>
        )}
        {typeof day === 'number' && (
          <div className={styles.findingFact}>
            <dt>{t('finding.when')}</dt>
            <dd>{t('finding.day', { day })}</dd>
          </div>
        )}
        {extraEntries.map(([key, value]) => (
          <FindingFact key={key} label={key} value={findingValue(value)} />
        ))}
      </dl>
      {notices.length > 1 && (
        <ul className={styles.findingNav}>
          {notices.map((entry, index) => (
            <li key={index}>
              <button
                type="button"
                aria-current={index === finding}
                className={index === finding ? styles.findingCurrent : styles.findingLink}
                onClick={() => { onPick(index) }}
              >
                {noticeLabel(entry, t)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.findingBack} onClick={onBack}>{t('finding.back')}</button>
    </div>
  )
}

/** Resolve an authorized notice player id to its seat label without exposing any role. */
function findingPlayer(
  playerId: string,
  players: WerewolfHumanViewV1['players'],
  t: (key: WerewolfKey, params?: Record<string, string | number>) => string,
): string {
  const player = players.find(candidate => candidate.playerId === playerId)
  return player === undefined ? playerId : `${t('table.seat', { seat: player.seat })}·${player.displayName}`
}

/** Pair one extra notice key with its readable value. */
function FindingFact(input: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.findingFact}>
      <dt>{input.label}</dt>
      <dd>{input.value}</dd>
    </div>
  )
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
      <header className={styles.actionHeader}>
        <div>
          <p className={styles.actionKicker}>
            {spec.kind === 'text' ? t('speech.audience') : t('action.hint')}
          </p>
          <h3>{spec.kind === 'text' ? t('speech.title') : t('action.title')}</h3>
        </div>
      </header>
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
        <fieldset key={field.id} className={styles.actionField}>
          <legend className={field.id === 'value' ? styles.srOnly : undefined}>{field.id}</legend>
          {field.spec.kind === 'text'
            ? (
              <label className={styles.speechComposer}>
                <span className={styles.srOnly}>{t('speech.placeholder')}</span>
                <textarea
                  value={drafts[field.id] ?? ''}
                  maxLength={field.spec.maxChars}
                  placeholder={t('speech.placeholder')}
                  onChange={(event) =>{  onDraft(field.id, event.target.value) }}
                  aria-describedby={`${field.id}-remaining`}
                />
                <span className={styles.speechCounter} id={`${field.id}-remaining`}>
                  {t('speech.remaining', { count: Math.max(0, field.spec.maxChars - (drafts[field.id]?.length ?? 0)) })}
                </span>
              </label>
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
      <div className={`${styles.actions} ${styles.actionButtons}`}>
        <button className={styles.primaryAction} type="submit" disabled={busy || !canSubmit}>
          {spec.kind === 'text' ? t('speech.speak') : spec.kind === 'player-target' ? t('vote.confirm') : t('action.submit')}
        </button>
        {allowSkip && (
          <button
            type="button"
            className={styles.secondaryAction}
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
