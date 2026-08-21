/**
 * Durable werewolf-event invariants. The companion validates every werewolf
 * event on live append and on session load: version and game identity,
 * contiguous state-changing revisions, one start and at most one terminal
 * event per game, legal pause/resume and phase transitions, unique action
 * ids, actor eligibility, bot-context revision continuity with recomputed
 * `contextAfter` snapshots, resolution reference validity, resource
 * underflow, victory evidence shape, and monotone cursor positions.
 * @module @deepseek-ai/dsh-werewolf/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { applyWerewolfBotContextDelta, initialWerewolfBotContext, validateWerewolfBotContextDelta } from './bot-context.ts'
import { werewolfOpenPhaseFromOpened } from './reducer.ts'
import type { WerewolfBotContextV1, WerewolfOpenPhaseV1 } from './types.ts'
import type { WerewolfPlayerId } from './brand.ts'
import { WEREWOLF_STATE_CHANGING_EVENTS, isWerewolfEvent } from './events.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-werewolf'

/** Cordis companion plugin name. */
export const name = 'werewolf-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Structural delta bound only: deployment character limits belong to the
 * runtime Config, not to the log validator.
 */
const STRUCTURAL_LIMITS = {
  memorySummaryChars: 65536,
  beliefBasisChars: 65536,
  commitmentChars: 65536,
  strategyChars: 65536,
  maxCommitments: 4096,
}

/** Segment order used for the monotone cursor check. */
const SEGMENT_ORDER: Readonly<Record<'setup' | 'night' | 'day', number>> = { setup: 0, night: 1, day: 2 }

/** What the fold needs beyond the reducer's state: checkpoints and ids. */
interface GameFold {
  gameId: string
  started: boolean
  ended: boolean
  paused: boolean
  revision: number
  roster: ReadonlySet<string>
  contexts: Map<string, WerewolfBotContextV1>
  openPhase: WerewolfOpenPhaseV1 | null
  seenIds: Set<string>
  lastPosition: { day: number; segment: number; index: number; occurrence: number } | null
}

function newFold(): GameFold {
  return {
    gameId: '',
    started: false,
    ended: false,
    paused: false,
    revision: 0,
    roster: new Set(),
    contexts: new Map(),
    openPhase: null,
    seenIds: new Set(),
    lastPosition: null,
  }
}

function requireUniqueId(fold: GameFold, id: string, what: string, fail: InvariantFailure): boolean {
  if (fold.seenIds.has(id)) {
    fail(`werewolf ${what} ${JSON.stringify(id)} appears twice in one game`)
    return false
  }
  fold.seenIds.add(id)
  return true
}

function checkMonotonePosition(
  fold: GameFold,
  day: number,
  segment: 'setup' | 'night' | 'day',
  index: number,
  occurrence: number,
  fail: InvariantFailure,
): void {
  const position = { day, segment: SEGMENT_ORDER[segment], index, occurrence }
  const last = fold.lastPosition
  if (last !== null) {
    if (day !== last.day && day !== last.day + 1) {
      fail(`werewolf/phase-opened jumps from day ${last.day} to day ${day}`)
    }
    const same = day === last.day && position.segment === last.segment && position.index === last.index
    if (same ? occurrence !== last.occurrence + 1
      : day < last.day
        || (day === last.day && (position.segment < last.segment
          || (position.segment === last.segment && position.index <= last.index)))) {
      fail(`werewolf/phase-opened position (day ${day}, ${segment} ${index}, occurrence ${occurrence}) does not advance monotonically`)
    }
  }
  fold.lastPosition = position
}

/** Validate one werewolf event against the fold; throws nothing, `fail`s instead. */
function validateEvent(event: SessionEvent, fold: GameFold, fail: InvariantFailure): void {
  if (!isWerewolfEvent(event)) return
  const header = event.data as { version: number; gameId: string; gameRevision: number }
  if (header.version !== 1) {
    fail(`werewolf event ${event.type} carries version ${String(header.version)}, not 1`)
    return
  }
  if (fold.started && header.gameId !== fold.gameId) {
    fail(`werewolf event ${event.type} switches game mid-log`)
    return
  }
  if (event.type !== 'werewolf/game-started' && !fold.started) {
    fail(`werewolf event ${event.type} appears before any werewolf/game-started`)
    return
  }
  if (fold.ended) {
    fail(`werewolf event ${event.type} follows the terminal game-ended event`)
    return
  }
  if (WEREWOLF_STATE_CHANGING_EVENTS.has(event.type)) {
    if (header.gameRevision !== fold.revision + 1) {
      fail(`${event.type} carries revision ${String(header.gameRevision)}; the log is at ${String(fold.revision)} and state-changing revisions must be contiguous`)
      return
    }
  } else if (header.gameRevision !== fold.revision) {
    fail(`werewolf/bot-attempt-failed carries revision ${String(header.gameRevision)}; it must equal the current revision ${String(fold.revision)}`)
    return
  }
  switch (event.type) {
    case 'werewolf/game-started': {
      const data = event.data
      fold.started = true
      fold.gameId = data.gameId
      fold.roster = new Set(data.roster.map(entry => entry.playerId))
      for (const { playerId, profile } of data.botProfiles) {
        fold.contexts.set(
          playerId,
          initialWerewolfBotContext(data.gameId, playerId, profile, data.roster.map(entry => entry.playerId)),
        )
      }
      if (data.request !== undefined) {
        requireUniqueId(fold, `request:${data.request.requestId}`, 'mutation request', fail)
      }
      break
    }
    case 'werewolf/phase-opened': {
      const data = event.data
      if (fold.openPhase !== null) {
        fail('werewolf/phase-opened opens a new phase while another is open')
      }
      if (fold.paused) {
        fail('werewolf/phase-opened opens while the game is paused')
      }
      requireUniqueId(fold, `phase:${data.phaseInstanceId}`, 'phase instance id', fail)
      checkMonotonePosition(fold, data.day, data.segment, data.cursorIndex, data.occurrence, fail)
      if (data.outcome === 'awaiting') {
        fold.openPhase = werewolfOpenPhaseFromOpened(data)
      }
      break
    }
    case 'werewolf/human-action': {
      const data = event.data
      const openPhase = fold.openPhase
      if (openPhase === null) {
        fail('werewolf/human-action lands with no open phase')
        break
      }
      /* v8 ignore next -- requireUniqueId reports duplicates through fail, which is typed to never return, so the break is unreachable */
      if (!requireUniqueId(fold, `human:${data.humanActionId}`, 'human action id', fail)) break
      const actor = openPhase.plan.actors.find(candidate => candidate.playerId === data.playerId)
      if (actor === undefined) {
        fail(`werewolf/human-action names player ${data.playerId} who is not an actor of the open phase`)
        break
      }
      if (openPhase.settled.some(entry => entry.playerId === data.playerId)) {
        fail(`werewolf/human-action settles player ${data.playerId} twice in one phase`)
        break
      }
      if (openPhase.plan.mode === 'seat-order-public' && openPhase.settled.length > 0) {
        const next = openPhase.plan.actors.find(candidate => !openPhase.settled.some(entry => entry.playerId === candidate.playerId))
        if (next !== undefined && next.playerId !== data.playerId) {
          fail('werewolf/human-action skips an earlier actor in a seat-order-public phase')
        }
      }
      if (data.phaseInstanceId !== openPhase.phaseInstanceId) {
        fail('werewolf/human-action targets a different phase instance')
      }
      if (data.request !== undefined) {
        requireUniqueId(fold, `request:${data.request.requestId}`, 'mutation request', fail)
      }
      openPhase.settled = [...openPhase.settled, { playerId: data.playerId, humanActionId: data.humanActionId }]
      break
    }
    case 'werewolf/bot-attempt-failed': {
      const data = event.data
      requireUniqueId(fold, `attempt:${data.decisionId}:${data.attempt}`, 'attempt record', fail)
      break
    }
    case 'werewolf/bot-decision': {
      const data = event.data
      const openPhase = fold.openPhase
      if (openPhase === null) {
        fail('werewolf/bot-decision lands with no open phase')
        break
      }
      if (data.phaseInstanceId !== openPhase.phaseInstanceId) {
        fail('werewolf/bot-decision targets a different phase instance')
        break
      }
      if (data.mode !== openPhase.plan.mode) {
        fail('werewolf/bot-decision mode disagrees with the opened plan')
        break
      }
      const seats = new Map(openPhase.plan.actors.map(actor => [actor.playerId as string, actor.seat]))
      for (const entry of data.entries) {
        /* v8 ignore next -- fail never returns, so this continue is unreachable */
        if (!requireUniqueId(fold, `decision:${entry.decisionId}`, 'decision id', fail)) continue
        const context = fold.contexts.get(entry.playerId)
        if (context === undefined) {
          fail(`werewolf/bot-decision names player ${entry.playerId} with no bot context`)
          continue
        }
        if (entry.actorContextRevision !== context.revision) {
          fail(`decision ${entry.decisionId} starts from context revision ${String(entry.actorContextRevision)}; the actor's checkpoint is ${String(context.revision)}`)
          continue
        }
        const actionKind = openPhase.plan.actors.find(actor => actor.playerId === entry.playerId)?.actionKind ?? ''
        const recomputed = applyWerewolfBotContextDelta(context, entry.contextDelta, {
          decisionId: entry.decisionId,
          phaseId: openPhase.phaseId,
          actionKind,
        })
        if (JSON.stringify(recomputed) !== JSON.stringify(entry.contextAfter)) {
          fail(`decision ${entry.decisionId} carries a contextAfter that disagrees with its checkpoint plus delta`)
          continue
        }
        try {
          validateWerewolfBotContextDelta(
            entry.contextDelta,
            context,
            [...fold.roster] as WerewolfPlayerId[],
            STRUCTURAL_LIMITS,
          )
        } catch (error) {
          fail(`decision ${entry.decisionId} carries an invalid context delta: ${(error as Error).message}`)
          continue
        }
        fold.contexts.set(entry.playerId, entry.contextAfter)
        openPhase.settled = [...openPhase.settled, { playerId: entry.playerId, decisionId: entry.decisionId }]
      }
      const ordered = [...data.entries].sort((a, b) => (seats.get(a.playerId) ?? 0) - (seats.get(b.playerId) ?? 0))
      if (data.entries.some((entry, index) => entry !== ordered[index])) {
        fail('werewolf/bot-decision entries are not ordered by seat')
      }
      break
    }
    case 'werewolf/phase-resolved': {
      const data = event.data
      for (const record of [
        ...data.resolution.eliminations.map(entry => entry.playerId),
        ...data.resolution.prevented.map(entry => entry.playerId),
        ...data.resolution.resourceReplacements.map(entry => entry.playerId),
        ...data.resolution.roleStateReplacements.map(entry => entry.playerId),
        ...data.resolution.privateNotices.map(entry => entry.toPlayerId),
      ]) {
        if (!fold.roster.has(record)) {
          fail(`werewolf/phase-resolved references non-roster player ${record}`)
        }
      }
      for (const replacement of data.resolution.resourceReplacements) {
        if (!Number.isSafeInteger(replacement.remaining) || replacement.remaining < 0) {
          fail(`werewolf/phase-resolved sets resource ${JSON.stringify(replacement.resourceId)} to ${String(replacement.remaining)}`)
        }
      }
      const openPhase = fold.openPhase
      if (openPhase === null) {
        fail('werewolf/phase-resolved lands with no open phase')
        break
      }
      if (data.phaseInstanceId !== openPhase.phaseInstanceId) {
        fail('werewolf/phase-resolved targets a different phase instance')
        break
      }
      const settledIds = new Set(openPhase.settled.map(entry => entry.playerId as string))
      const expected = openPhase.plan.actors.filter(actor => settledIds.has(actor.playerId))
      if (expected.length !== openPhase.plan.actors.length) {
        fail('werewolf/phase-resolved resolves a phase with unsettled actors')
        break
      }
      const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
        left.size === right.size && [...right].every(id => left.has(id))
      const resolvedDecisions = new Set((data.decisionIds))
      const settledDecisions = new Set(
        openPhase.settled.flatMap(entry => entry.decisionId === undefined ? [] : [entry.decisionId as string]),
      )
      if (!sameSet(resolvedDecisions, settledDecisions)) {
        fail('werewolf/phase-resolved decision ids disagree with the settled decisions')
      }
      const resolvedHuman = new Set(data.humanActionIds)
      const settledHuman = new Set(
        openPhase.settled.flatMap(entry => entry.humanActionId === undefined ? [] : [entry.humanActionId as string]),
      )
      if (!sameSet(resolvedHuman, settledHuman)) {
        fail('werewolf/phase-resolved human action ids disagree with the settled human actions')
      }
      fold.openPhase = null
      break
    }
    case 'werewolf/game-paused': {
      if (fold.paused) {
        fail('werewolf/game-paused pauses an already-paused game')
      }
      fold.paused = true
      break
    }
    case 'werewolf/game-resumed': {
      const data = event.data
      if (!fold.paused) {
        fail('werewolf/game-resumed resumes a running game')
      }
      fold.paused = false
      if (data.request !== undefined) {
        requireUniqueId(fold, `request:${data.request.requestId}`, 'mutation request', fail)
      }
      break
    }
    case 'werewolf/game-ended': {
      const data = event.data
      if (data.result.evidence.length === 0) {
        fail('werewolf/game-ended records a result without evidence')
      }
      for (const entry of data.result.evidence) {
        if (entry.source === 'condition') {
          if (entry.conditionId === undefined || entry.conditionVersion === undefined || entry.priority === undefined) {
            fail('werewolf/game-ended condition evidence lacks condition id, version, or priority')
          }
        } else if (entry.conditionId !== undefined || entry.conditionVersion !== undefined || entry.priority !== undefined) {
          fail(`werewolf/game-ended ${entry.source} evidence must not carry condition fields`)
        }
      }
      fold.ended = true
      if (data.request !== undefined) {
        requireUniqueId(fold, `request:${data.request.requestId}`, 'mutation request', fail)
      }
      break
    }
    default:
      break
  }
  if (WEREWOLF_STATE_CHANGING_EVENTS.has(event.type)) {
    fold.revision = (event as { data: { gameRevision: number } }).data.gameRevision
  }
}

/** Install validation for loaded and newly appended werewolf events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const folds = new WeakMap<Session, GameFold>()
  const foldOf = (session: Session): GameFold => {
    let fold = folds.get(session)
    if (fold === undefined) {
      fold = newFold()
      folds.set(session, fold)
    }
    return fold
  }
  const seed = (session: Session): void => {
    const fold = foldOf(session)
    for (const event of session.events) validateEvent(event, fold, fail)
  }
  ctx.sessions.list().forEach(seed)
  ctx.on('session/created', seed, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(event, foldOf(session), fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the werewolf invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
