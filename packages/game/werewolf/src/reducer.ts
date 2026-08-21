/**
 * The event fold: `applyWerewolfEvent` advances one game state by one
 * werewolf event and `reduceWerewolfGame` folds a whole log. Replay applies
 * only recorded effects — role and phase definitions never re-run here. The
 * fold trusts the log; structural validation belongs to the package
 * invariant. Inputs are never mutated; every state transition returns a
 * detached object.
 * @module @deepseek-ai/dsh-werewolf/reducer
 */

import { initialWerewolfBotContext } from './bot-context.ts'
import type {
  WerewolfActionActorV1,
  WerewolfGameStateV1,
  WerewolfOpenPhaseV1,
  WerewolfPlayerRuntimeV1,
  WerewolfPriorResolutionV1,
  WerewolfResolutionV1,
  WerewolfTimelineEntryV1,
} from './types.ts'
import type { WerewolfPlayerId } from './brand.ts'
import { isWerewolfEvent, type WerewolfEvent } from './events.ts'

/** Idempotency-key method names, mirroring the stage-3 mutation surface. */
const REQUEST_METHODS = {
  'werewolf/game-started': 'start',
  'werewolf/human-action': 'submitAction',
  'werewolf/game-resumed': 'resume',
  'werewolf/game-ended': 'abortGame',
} as const

function copyPlayers(players: readonly WerewolfPlayerRuntimeV1[]): WerewolfPlayerRuntimeV1[] {
  return players.map(player => ({ ...player }))
}

function applyResolution(
  players: WerewolfPlayerRuntimeV1[],
  day: number,
  phaseId: string,
  resolution: WerewolfResolutionV1,
  timeline: WerewolfTimelineEntryV1[],
  timelineIdBase: number,
): void {
  const find = (playerId: WerewolfPlayerId): WerewolfPlayerRuntimeV1 | undefined =>
    players.find(player => player.playerId === playerId)
  const prevented = new Set(resolution.prevented.map(entry => entry.playerId))
  for (const replacement of resolution.resourceReplacements) {
    const player = find(replacement.playerId)
    if (player === undefined) continue
    player.resources = { ...player.resources, [replacement.resourceId]: replacement.remaining }
  }
  for (const replacement of resolution.roleStateReplacements) {
    const player = find(replacement.playerId)
    if (player === undefined) continue
    player.roleState = replacement.roleState
  }
  for (const elimination of resolution.eliminations) {
    const player = find(elimination.playerId)
    if (player === undefined || prevented.has(elimination.playerId) || !player.alive) continue
    player.alive = false
    player.deathDay = day
    player.deathCause = elimination.cause
  }
  for (const notice of resolution.privateNotices) {
    const player = find(notice.toPlayerId)
    if (player === undefined) continue
    player.notices = [...player.notices, { toPlayerId: notice.toPlayerId, kind: notice.kind, data: notice.data }]
  }
  resolution.announcements.forEach((announcement, index) => {
    timeline.push({
      id: `${timelineIdBase}:${index}`,
      day,
      phaseId,
      kind: announcement.kind === 'result' ? 'announcement' : announcement.kind,
      key: announcement.key,
      ...(announcement.data === undefined ? {} : { data: announcement.data }),
    })
  })
  resolution.votes.forEach((vote, index) => {
    timeline.push({
      id: `${timelineIdBase}:v${index}`,
      day,
      phaseId,
      kind: 'vote',
      actorId: vote.voterId,
      key: 'vote.cast',
      data: { voterId: vote.voterId, targetId: vote.targetId },
    })
  })
}

/**
 * Build the open-phase record one `werewolf/phase-opened` payload describes.
 *
 * @param data - the opened (awaiting) payload.
 * @returns the detached open phase with no settled actors.
 */
export function werewolfOpenPhaseFromOpened(data: WerewolfEvent<'werewolf/phase-opened'>['data']): WerewolfOpenPhaseV1 {
  return {
    phaseInstanceId: data.phaseInstanceId,
    phaseId: data.phaseId,
    phaseVersion: data.phaseVersion,
    segment: data.segment,
    day: data.day,
    occurrence: data.occurrence,
    plan: data.plan ?? { mode: 'parallel-private', actors: [] },
    settled: [],
  }
}

function speechEntry(
  actorId: WerewolfPlayerId,
  day: number,
  phaseId: string,
  text: string,
  revision: number,
  index: number,
): WerewolfTimelineEntryV1 {
  return {
    id: `${revision}:${index}`,
    day,
    phaseId,
    kind: 'speech',
    actorId,
    key: 'speech',
    data: { text },
  }
}

function actorSpec(openPhase: WerewolfOpenPhaseV1, playerId: WerewolfPlayerId): WerewolfActionActorV1 | undefined {
  return openPhase.plan.actors.find(actor => actor.playerId === playerId)
}

function isOpenTextAction(openPhase: WerewolfOpenPhaseV1, playerId: WerewolfPlayerId, action: unknown): action is { value: string } {
  const actor = actorSpec(openPhase, playerId)
  if (actor === undefined || actor.spec.kind !== 'text') return false
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return false
  const value = (action as { value?: unknown }).value
  return typeof value === 'string' && value.length > 0
}

/**
 * Advance one game state by one werewolf event. Events of other types are
 * returned unchanged (the session log interleaves foreign events).
 *
 * @param state - the folded state so far, or `undefined` before any game.
 * @param event - one session event.
 * @returns the next detached state; the input state when the event is not a
 *   werewolf event.
 */
export function applyWerewolfEvent(
  state: WerewolfGameStateV1 | undefined,
  event: { type: string; data: unknown },
): WerewolfGameStateV1 | undefined {
  if (!isWerewolfEvent(event)) return state
  if (event.type === 'werewolf/game-started') {
    const data = event.data
    const rosterOrder = [...data.roster].sort((a, b) => a.seat - b.seat)
    const rosterIds = rosterOrder.map(entry => entry.playerId)
    const contexts: Record<string, WerewolfGameStateV1['contexts'][string]> = {}
    for (const { playerId, profile } of data.botProfiles) {
      contexts[playerId] = initialWerewolfBotContext(data.gameId, playerId, profile, rosterIds)
    }
    const idempotencyKeys = new Map<string, string>()
    if (data.request !== undefined) {
      idempotencyKeys.set(`${REQUEST_METHODS['werewolf/game-started']}\u0000${data.request.requestId}`, data.request.digest)
    }
    return {
      gameId: data.gameId,
      status: 'running',
      revision: data.gameRevision,
      day: 1,
      retryEpoch: 0,
      ruleSet: data.ruleSet,
      ruleSetDigest: data.ruleSetDigest,
      definitionVersions: data.definitionVersions,
      humanPlayerId: data.humanPlayerId,
      players: rosterOrder.map(entry => ({
        playerId: entry.playerId,
        seat: entry.seat,
        displayName: entry.displayName,
        human: entry.human,
        roleId: entry.roleId,
        roleVersion: entry.roleVersion,
        faction: entry.faction,
        alive: true,
        roleState: entry.roleState,
        resources: { ...entry.resources },
        notices: [],
      })),
      botProfiles: Object.fromEntries(data.botProfiles.map(({ playerId, profile }) => [playerId, profile])),
      contexts,
      seed: data.seed,
      rngState: data.rngState,
      segment: data.ruleSet.cycle.setup !== undefined && data.ruleSet.cycle.setup.length > 0 ? 'setup' : 'night',
      cursorIndex: 0,
      occurrence: 0,
      positionConsumed: false,
      openPhase: null,
      sameDayResolutions: [],
      timeline: [],
      attempts: {},
      result: null,
      pauseReason: null,
      idempotencyKeys,
    }
  }
  if (state === undefined) return undefined
  if (event.type === 'werewolf/phase-opened') {
    const data = event.data
    const next: WerewolfGameStateV1 = {
      ...state,
      revision: data.gameRevision,
      day: data.day,
      segment: data.segment,
      cursorIndex: data.cursorIndex,
      occurrence: data.occurrence,
      rngState: data.rngState,
      ...(data.day === state.day ? {} : { sameDayResolutions: [] }),
    }
    if (data.outcome === 'skipped') {
      next.positionConsumed = true
      next.openPhase = null
      if (data.skipReason !== undefined) {
        next.timeline = [...next.timeline, {
          id: `${data.gameRevision}:0`,
          day: data.day,
          phaseId: data.phaseId,
          kind: 'system',
          key: 'phase.skipped',
          data: { reason: data.skipReason },
        }]
      }
    } else {
      next.positionConsumed = false
      next.openPhase = werewolfOpenPhaseFromOpened(data)
    }
    return next
  }
  if (event.type === 'werewolf/human-action') {
    const data = event.data
    const openPhase = state.openPhase
    const next: WerewolfGameStateV1 = {
      ...state,
      revision: data.gameRevision,
      openPhase: openPhase === null ? null : {
        ...openPhase,
        settled: [...openPhase.settled, { playerId: data.playerId, humanActionId: data.humanActionId }],
      },
    }
    if (openPhase !== null && isOpenTextAction(openPhase, data.playerId, data.action)) {
      next.timeline = [...next.timeline, speechEntry(
        data.playerId,
        openPhase.day,
        openPhase.phaseId,
        data.action.value,
        data.gameRevision,
        next.timeline.length,
      )]
    }
    if (data.request !== undefined) {
      const keys = new Map(state.idempotencyKeys)
      keys.set(`${REQUEST_METHODS['werewolf/human-action']}\u0000${data.request.requestId}`, data.request.digest)
      next.idempotencyKeys = keys
    }
    return next
  }
  if (event.type === 'werewolf/bot-attempt-failed') {
    const data = event.data
    return {
      ...state,
      attempts: { ...state.attempts, [data.decisionId]: data.attempt },
    }
  }
  if (event.type === 'werewolf/bot-decision') {
    const data = event.data
    const openPhase = state.openPhase
    const contexts = { ...state.contexts }
    const settled = openPhase === null ? [] : [...openPhase.settled]
    const timeline = [...state.timeline]
    for (const entry of data.entries) {
      contexts[entry.playerId] = entry.contextAfter
      settled.push({ playerId: entry.playerId, decisionId: entry.decisionId })
      if (entry.publicSpeech !== undefined && entry.publicSpeech.length > 0 && openPhase !== null) {
        timeline.push(speechEntry(
          entry.playerId,
          openPhase.day,
          openPhase.phaseId,
          entry.publicSpeech,
          data.gameRevision,
          timeline.length,
        ))
      }
    }
    return {
      ...state,
      revision: data.gameRevision,
      contexts,
      timeline,
      openPhase: openPhase === null ? null : { ...openPhase, settled },
    }
  }
  if (event.type === 'werewolf/phase-resolved') {
    const data = event.data
    const openPhase = state.openPhase
    const players = copyPlayers(state.players)
    const timeline = [...state.timeline]
    applyResolution(players, openPhase?.day ?? state.day, openPhase?.phaseId ?? '', data.resolution, timeline, data.gameRevision)
    const prior: WerewolfPriorResolutionV1 = {
      phaseId: openPhase?.phaseId ?? '',
      phaseVersion: openPhase?.phaseVersion ?? 0,
      day: openPhase?.day ?? state.day,
      segment: openPhase?.segment ?? state.segment ?? 'night',
      resolution: data.resolution,
    }
    return {
      ...state,
      revision: data.gameRevision,
      players,
      timeline,
      openPhase: null,
      positionConsumed: true,
      sameDayResolutions: [...state.sameDayResolutions, prior],
      rngState: data.rngState,
    }
  }
  if (event.type === 'werewolf/game-paused') {
    const data = event.data
    return {
      ...state,
      status: 'paused',
      revision: data.gameRevision,
      pauseReason: data.reason,
    }
  }
  if (event.type === 'werewolf/game-resumed') {
    const data = event.data
    const next: WerewolfGameStateV1 = {
      ...state,
      status: 'running',
      revision: data.gameRevision,
      retryEpoch: data.retryEpoch,
      pauseReason: null,
    }
    if (data.request !== undefined) {
      const keys = new Map(state.idempotencyKeys)
      keys.set(`${REQUEST_METHODS['werewolf/game-resumed']}\u0000${data.request.requestId}`, data.request.digest)
      next.idempotencyKeys = keys
    }
    return next
  }
  const data = event.data
  const next: WerewolfGameStateV1 = {
    ...state,
    status: 'ended',
    revision: data.gameRevision,
    result: data.result,
  }
  if (data.request !== undefined) {
    const keys = new Map(state.idempotencyKeys)
    keys.set(`${REQUEST_METHODS['werewolf/game-ended']}\u0000${data.request.requestId}`, data.request.digest)
    next.idempotencyKeys = keys
  }
  return next
}

/**
 * Fold a whole session log (or any prefix) into the latest game state.
 *
 * @param events - any iterable of session events; non-werewolf events are
 *   ignored and a later `werewolf/game-started` resets the fold.
 * @returns the latest game's state, or `undefined` when no werewolf event
 *   appears.
 */
export function reduceWerewolfGame(
  events: Iterable<{ type: string; data: unknown }>,
): WerewolfGameStateV1 | undefined {
  let state: WerewolfGameStateV1 | undefined
  for (const event of events) {
    state = applyWerewolfEvent(state, event)
  }
  return state
}
