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
import {
  applyWerewolfBotContextDelta,
  initialWerewolfBotContext,
  normalizeWerewolfText,
  validateWerewolfBotContextDelta,
} from './bot-context.ts'
import { validateWerewolfAction } from './engine.ts'
import { werewolfOpenPhaseFromOpened } from './reducer.ts'
import type { WerewolfActionSpecV1, WerewolfBotContextV1, WerewolfOpenPhaseV1 } from './types.ts'
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
  rosterSeats: ReadonlyMap<string, number>
  humanPlayerId: string
  speechMaxChars: number
  contexts: Map<string, WerewolfBotContextV1>
  openPhase: WerewolfOpenPhaseV1 | null
  seenIds: Set<string>
  retryEpoch: number
  attempts: Map<string, number>
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
    rosterSeats: new Map(),
    humanPlayerId: '',
    speechMaxChars: 0,
    contexts: new Map(),
    openPhase: null,
    seenIds: new Set(),
    retryEpoch: 0,
    attempts: new Map(),
    lastPosition: null,
  }
}

/** Copy the committed fold before validating a candidate append. */
function cloneFold(fold: GameFold): GameFold {
  return {
    ...fold,
    roster: new Set(fold.roster),
    rosterSeats: new Map(fold.rosterSeats),
    contexts: new Map(fold.contexts),
    openPhase: fold.openPhase === null
      ? null
      : { ...fold.openPhase, settled: [...fold.openPhase.settled] },
    seenIds: new Set(fold.seenIds),
    attempts: new Map(fold.attempts),
    lastPosition: fold.lastPosition === null ? null : { ...fold.lastPosition },
  }
}

/** Reset a completed-game fold before validating the next game start. */
function resetFold(fold: GameFold): void {
  Object.assign(fold, newFold())
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...right].every(id => left.has(id))
}

function playerTargets(spec: WerewolfActionSpecV1): readonly WerewolfPlayerId[] {
  if (spec.kind === 'player-target') return spec.targets
  if (spec.kind !== 'compound') return []
  return spec.fields.flatMap(field => field.spec.kind === 'player-target' ? field.spec.targets : [])
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
  if (event.type === 'werewolf/game-started' && fold.started) {
    if (!fold.ended) {
      fail('werewolf/game-started starts a second game before the active game ended')
      return
    }
    resetFold(fold)
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
      const rosterIds = data.roster.map(entry => entry.playerId as string)
      fold.roster = new Set(rosterIds)
      fold.rosterSeats = new Map(data.roster.map(entry => [entry.playerId as string, entry.seat]))
      if (fold.roster.size !== rosterIds.length) {
        fail('werewolf/game-started repeats a roster player id')
      }
      const seats = new Set(data.roster.map(entry => entry.seat))
      if (seats.size !== data.roster.length) {
        fail('werewolf/game-started repeats a roster seat')
      }
      const humans = data.roster.filter(entry => entry.human)
      if (humans.length !== 1 || humans[0]?.playerId !== data.humanPlayerId) {
        fail('werewolf/game-started humanPlayerId must name the only human roster row')
      }
      fold.humanPlayerId = data.humanPlayerId
      fold.speechMaxChars = data.ruleSet.policies.speechMaxChars
      const botIds = new Set(data.botProfiles.map(entry => entry.playerId as string))
      const expectedBotIds = new Set(data.roster.filter(entry => !entry.human).map(entry => entry.playerId as string))
      if (botIds.size !== data.botProfiles.length || !sameSet(botIds, expectedBotIds)) {
        fail('werewolf/game-started bot profiles must cover every non-human player exactly once')
      }
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
        if (data.plan === undefined) {
          fail('werewolf/phase-opened awaiting outcome lacks an action plan')
        }
        const plan = data.plan
        const actorIds = new Set(plan.actors.map(actor => actor.playerId as string))
        if (actorIds.size !== plan.actors.length) {
          fail('werewolf/phase-opened repeats an action-plan actor')
        }
        for (const actor of plan.actors) {
          if (!fold.roster.has(actor.playerId)) {
            fail(`werewolf/phase-opened names non-roster actor ${actor.playerId}`)
          }
          if (fold.rosterSeats.get(actor.playerId) !== actor.seat) {
            fail(`werewolf/phase-opened gives actor ${actor.playerId} the wrong seat`)
          }
          for (const target of playerTargets(actor.spec)) {
            if (!fold.roster.has(target)) {
              fail(`werewolf/phase-opened gives actor ${actor.playerId} non-roster target ${target}`)
            }
          }
        }
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
      if (fold.paused) {
        fail('werewolf/human-action lands while the game is paused')
      }
      if (data.playerId !== fold.humanPlayerId) {
        fail(`werewolf/human-action names player ${data.playerId}, not the human player`)
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
      if (openPhase.plan.mode === 'seat-order-public') {
        const next = openPhase.plan.actors.find(candidate => !openPhase.settled.some(entry => entry.playerId === candidate.playerId))
        if (next !== undefined && next.playerId !== data.playerId) {
          fail('werewolf/human-action skips an earlier actor in a seat-order-public phase')
        }
      }
      if (data.phaseInstanceId !== openPhase.phaseInstanceId) {
        fail('werewolf/human-action targets a different phase instance')
      }
      const actionError = validateWerewolfAction(actor, data.action)
      if (actionError !== undefined) {
        fail(`werewolf/human-action is illegal: ${actionError}`)
      }
      if (data.request !== undefined) {
        requireUniqueId(fold, `request:${data.request.requestId}`, 'mutation request', fail)
      }
      openPhase.settled = [...openPhase.settled, { playerId: data.playerId, humanActionId: data.humanActionId }]
      break
    }
    case 'werewolf/bot-attempt-failed': {
      const data = event.data
      const openPhase = fold.openPhase
      if (fold.paused) {
        fail('werewolf/bot-attempt-failed lands while the game is paused')
      }
      if (openPhase === null || data.phaseInstanceId !== openPhase.phaseInstanceId) {
        fail('werewolf/bot-attempt-failed targets no current open phase')
      }
      if (!fold.contexts.has(data.playerId)
        || openPhase.plan.actors.every(actor => actor.playerId !== data.playerId)
        || openPhase.settled.some(entry => entry.playerId === data.playerId)) {
        fail(`werewolf/bot-attempt-failed names player ${data.playerId} who is not a bot actor`)
      }
      const remaining = openPhase.plan.actors.filter(actor =>
        !openPhase.settled.some(entry => entry.playerId === actor.playerId))
      if (openPhase.plan.mode === 'seat-order-public' && remaining[0]?.playerId !== data.playerId) {
        fail('werewolf/bot-attempt-failed does not target the next seat-order-public actor')
      }
      if (openPhase.plan.mode === 'parallel-private'
        && remaining.some(actor => actor.playerId === fold.humanPlayerId)) {
        fail('werewolf/bot-attempt-failed occurs before the parallel human action')
      }
      if (data.retryEpoch !== fold.retryEpoch) {
        fail(`werewolf/bot-attempt-failed carries retry epoch ${String(data.retryEpoch)}; expected ${String(fold.retryEpoch)}`)
      }
      const attemptKey = `${data.decisionId}\u0000${data.retryEpoch}`
      const expectedAttempt = (fold.attempts.get(attemptKey) ?? 0) + 1
      if (data.attempt !== expectedAttempt) {
        fail(`werewolf/bot-attempt-failed carries attempt ${String(data.attempt)}; expected ${String(expectedAttempt)}`)
      }
      requireUniqueId(fold, `attempt:${data.decisionId}:${data.retryEpoch}:${data.attempt}`, 'attempt record', fail)
      fold.attempts.set(attemptKey, data.attempt)
      break
    }
    case 'werewolf/bot-decision': {
      const data = event.data
      const openPhase = fold.openPhase
      if (openPhase === null) {
        fail('werewolf/bot-decision lands with no open phase')
        break
      }
      if (fold.paused) {
        fail('werewolf/bot-decision lands while the game is paused')
      }
      if (data.sourceGameRevision !== fold.revision) {
        fail(`werewolf/bot-decision source revision ${String(data.sourceGameRevision)} does not match ${String(fold.revision)}`)
      }
      if (data.phaseInstanceId !== openPhase.phaseInstanceId) {
        fail('werewolf/bot-decision targets a different phase instance')
        break
      }
      if (data.mode !== openPhase.plan.mode) {
        fail('werewolf/bot-decision mode disagrees with the opened plan')
        break
      }
      const remaining = openPhase.plan.actors.filter(actor =>
        !openPhase.settled.some(entry => entry.playerId === actor.playerId))
      const seats = new Map(openPhase.plan.actors.map(actor => [actor.playerId as string, actor.seat]))
      for (const entry of data.entries) {
        /* v8 ignore next -- fail never returns, so this continue is unreachable */
        if (!requireUniqueId(fold, `decision:${entry.decisionId}`, 'decision id', fail)) continue
        if (entry.phaseInstanceId !== openPhase.phaseInstanceId) {
          fail(`decision ${entry.decisionId} targets a different phase instance`)
        }
        const actor = openPhase.plan.actors.find(candidate => candidate.playerId === entry.playerId)
        if (actor === undefined || openPhase.settled.some(settled => settled.playerId === entry.playerId)) {
          fail(`werewolf/bot-decision names player ${entry.playerId} who is not a pending actor`)
        }
        if (entry.publicSpeech !== undefined) {
          if (actor.spec.kind !== 'text') {
            fail(`decision ${entry.decisionId} carries public speech outside a text phase`)
          }
          const normalizedSpeech = normalizeWerewolfText(entry.publicSpeech)
          if (normalizedSpeech.length === 0) {
            fail(`decision ${entry.decisionId} carries empty public speech`)
          }
          if (normalizedSpeech !== entry.publicSpeech) {
            fail(`decision ${entry.decisionId} carries non-normalized public speech`)
          }
          if (normalizedSpeech.length > fold.speechMaxChars) {
            fail(`decision ${entry.decisionId} public speech exceeds the recorded policy`)
          }
        }
        const context = fold.contexts.get(entry.playerId)
        if (context === undefined) {
          fail(`werewolf/bot-decision names player ${entry.playerId} with no bot context`)
          continue
        }
        if (entry.actorContextRevision !== context.revision) {
          fail(`decision ${entry.decisionId} starts from context revision ${String(entry.actorContextRevision)}; the actor's checkpoint is ${String(context.revision)}`)
          continue
        }
        const actionError = validateWerewolfAction(actor, entry.action)
        if (actionError !== undefined) {
          fail(`decision ${entry.decisionId} carries an illegal action: ${actionError}`)
        }
        const actionKind = actor.actionKind
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
      const ordered = [...data.entries].sort((a, b) =>
        (seats.get(a.playerId) as number) - (seats.get(b.playerId) as number))
      if (data.entries.length === 0) {
        fail('werewolf/bot-decision must contain at least one entry')
      }
      if (data.entries.some((entry, index) => entry !== ordered[index])) {
        fail('werewolf/bot-decision entries are not ordered by seat')
      }
      if (data.mode === 'seat-order-public') {
        const next = remaining[0]
        if (data.entries.length !== 1 || next === undefined || data.entries[0]?.playerId !== next.playerId) {
          fail('werewolf/bot-decision must settle exactly the next seat-order-public actor')
        }
      } else {
        const humanPending = remaining.some(actor => actor.playerId === fold.humanPlayerId)
        if (humanPending) {
          fail('werewolf/bot-decision commits before the parallel human action')
        }
        const expectedBots = new Set(remaining.map(actor => actor.playerId as string))
        const submittedBots = new Set(data.entries.map(entry => entry.playerId as string))
        if (submittedBots.size !== data.entries.length || !sameSet(submittedBots, expectedBots)) {
          fail('werewolf/bot-decision must cover every pending parallel bot exactly once')
        }
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
        ...data.resolution.votes.flatMap(vote => vote.targetId === null
          ? [vote.voterId]
          : [vote.voterId, vote.targetId]),
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
      if (fold.paused) {
        fail('werewolf/phase-resolved lands while the game is paused')
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
      const resolvedDecisions = new Set((data.decisionIds))
      if (resolvedDecisions.size !== data.decisionIds.length) {
        fail('werewolf/phase-resolved repeats a decision id')
      }
      const settledDecisions = new Set(
        openPhase.settled.flatMap(entry => entry.decisionId === undefined ? [] : [entry.decisionId as string]),
      )
      if (!sameSet(resolvedDecisions, settledDecisions)) {
        fail('werewolf/phase-resolved decision ids disagree with the settled decisions')
      }
      const resolvedHuman = new Set(data.humanActionIds)
      if (resolvedHuman.size !== data.humanActionIds.length) {
        fail('werewolf/phase-resolved repeats a human action id')
      }
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
      if (data.retryEpoch !== fold.retryEpoch + 1) {
        fail(`werewolf/game-resumed retry epoch ${String(data.retryEpoch)} does not advance ${String(fold.retryEpoch)}`)
      }
      fold.retryEpoch = data.retryEpoch
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
  }
  if (WEREWOLF_STATE_CHANGING_EVENTS.has(event.type)) {
    fold.revision = (event as { data: { gameRevision: number } }).data.gameRevision
  }
}

/** Install validation for loaded and newly appended werewolf events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const folds = new WeakMap<Session, GameFold>()
  const staged = new WeakMap<SessionEvent, { session: Session; fold: GameFold }>()
  const seed = (session: Session): GameFold => {
    const fold = newFold()
    for (const event of session.events) validateEvent(event, fold, fail)
    folds.set(session, fold)
    return fold
  }
  /* v8 ignore next -- sessions are seeded at install or session/created before their first event dispatch. */
  const foldOf = (session: Session): GameFold => folds.get(session) ?? seed(session)
  ctx.sessions.list().forEach(seed)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const fold = cloneFold(foldOf(session))
    validateEvent(event, fold, fail)
    staged.set(event, { session, fold })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact session/event callback arguments. */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching werewolf validation')
    }
    staged.delete(event)
    folds.set(session, candidate.fold)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the werewolf invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
