/**
 * The bot observation projection: one decision's authorized view of the
 * game. Every field is derived from the folded state and the opened plan —
 * private knowledge comes from the actor's registered role projector with
 * teammates supplied only when the compiled role is entitled, the public
 * state carries only public roster facts and a bounded recent timeline, and
 * the legal action serializes the closed spec vocabulary. Nothing here reads
 * or serializes another role's private state.
 * @module @deepseek-ai/dsh-werewolf/projection
 */

import { isDeepStrictEqual } from 'node:util'
import { WerewolfError } from './error.ts'
import type {
  WerewolfActionSpecJsonV1,
  WerewolfSingleActionSpecJsonV1,
  WerewolfActionSpecV1,
  WerewolfBotContextV1,
  WerewolfBotPromptV1,
  WerewolfCompiledRuleSetV1,
  WerewolfGameStateV1,
  WerewolfSingleActionSpecV1,
} from './types.ts'
import type { WerewolfBotActionRequest } from './types.ts'

/** Bounds the projection applies; resolved from plugin configuration. */
export interface WerewolfProjectionLimitsV1 {
  /** How many trailing public timeline entries the prompt carries. */
  publicTimelineEntries: number
  /** Exclude public entries already delivered to this fixed Bot session. */
  afterGameRevision?: number
}

export type { WerewolfActionSpecJsonV1, WerewolfSingleActionSpecJsonV1 } from './types.ts'

/**
 * Serialize one closed action spec to its prompt JSON view.
 *
 * @param spec - the spec from the opened plan.
 * @returns the detached JSON view.
 */
export function serializeWerewolfActionSpec(spec: WerewolfActionSpecV1): WerewolfActionSpecJsonV1 {
  if (spec.kind === 'compound') {
    return {
      kind: 'compound',
      fields: spec.fields.map(field => ({ id: field.id, spec: serializeSingleActionSpec(field.spec) })),
      allowSkip: spec.allowSkip,
    }
  }
  return serializeSingleActionSpec(spec)
}

function serializeSingleActionSpec(spec: WerewolfSingleActionSpecV1): WerewolfSingleActionSpecJsonV1 {
  if (spec.kind === 'player-target') {
    return { kind: 'player-target', targets: spec.targets.map(target => target), allowSkip: spec.allowSkip }
  }
  if (spec.kind === 'choice') {
    return { kind: 'choice', options: [...spec.options], allowSkip: spec.allowSkip }
  }
  return { kind: 'text', maxChars: spec.maxChars, allowSkip: spec.allowSkip }
}

/**
 * Project one bot decision's authorized observation.
 *
 * @param state - the folded game state the decision starts from.
 * @param rules - the compiled rule set (role projectors and entitlements).
 * @param request - the pending bot decision.
 * @param limits - configured projection bounds.
 * @returns the complete prompt payload for the one-shot child.
 */
export function projectWerewolfBotObservation(
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
  request: WerewolfBotActionRequest,
  limits: WerewolfProjectionLimitsV1,
): WerewolfBotPromptV1 {
  if (rules.digest !== state.ruleSetDigest) {
    throw new WerewolfError('WEREWOLF_STALE_REVISION', 'werewolf projection: compiled rules do not match the active game')
  }
  if (request.gameId !== state.gameId || request.sourceGameRevision !== state.revision) {
    throw new WerewolfError('WEREWOLF_STALE_REVISION', 'werewolf projection: request answers a stale game revision')
  }
  const openPhase = state.openPhase
  if (openPhase === null) {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', 'werewolf projection: no phase is open')
  }
  if (request.phaseInstanceId !== openPhase.phaseInstanceId
    || request.phaseId !== openPhase.phaseId
    || request.day !== openPhase.day) {
    throw new WerewolfError('WEREWOLF_STALE_REVISION', 'werewolf projection: request answers a different phase')
  }
  const player = state.players.find(entry => entry.playerId === request.playerId)
  if (player === undefined) {
    throw new Error(`werewolf projection: player ${request.playerId} is not seated`)
  }
  const role = rules.roles.get(`${player.roleId}@${player.roleVersion}`)
  if (role === undefined) {
    throw new Error(`werewolf projection: role ${player.roleId}@${player.roleVersion} did not compile`)
  }
  const actor = openPhase.plan.actors.find(entry => entry.playerId === request.playerId)
  const settled = openPhase.settled.some(entry => entry.playerId === request.playerId)
  if (actor === undefined || player.human || settled) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `werewolf projection: player ${request.playerId} has no pending bot decision`)
  }
  if (openPhase.plan.mode === 'seat-order-public') {
    const settledIds = new Set(openPhase.settled.map(entry => entry.playerId))
    const first = openPhase.plan.actors.find(entry => !settledIds.has(entry.playerId))
    if (first?.playerId !== request.playerId) {
      throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', `werewolf projection: player ${request.playerId} is not the next public actor`)
    }
  }
  if (request.actionKind !== actor.actionKind
    || !isDeepStrictEqual(request.spec, actor.spec)
    || !isDeepStrictEqual(request.context, actor.context)) {
    throw new WerewolfError('WEREWOLF_STALE_REVISION', 'werewolf projection: request does not match the active action plan')
  }
  const currentContext = state.contexts[request.playerId]
  if (currentContext === undefined) {
    throw new WerewolfError('WEREWOLF_NO_ACTIVE_GAME', `werewolf projection: player ${request.playerId} has no bot context`)
  }
  if (!isDeepStrictEqual(request.priorContext, currentContext)) {
    throw new WerewolfError('WEREWOLF_STALE_REVISION', 'werewolf projection: request carries stale or foreign bot context')
  }
  const teammates = role.seesFactionTeammates === true
    ? state.players
      .filter(entry => entry.faction === player.faction && entry.playerId !== player.playerId)
      .map(entry => ({ playerId: entry.playerId, seat: entry.seat, alive: entry.alive }))
    : []
  const privateKnowledge = role.projectPrivateKnowledge({
    self: {
      playerId: player.playerId,
      seat: player.seat,
      alive: player.alive,
      roleState: structuredClone(player.roleState),
      resources: { ...player.resources },
      notices: player.notices.map(notice => ({
        toPlayerId: notice.toPlayerId,
        kind: notice.kind,
        data: structuredClone(notice.data),
      })),
    },
    teammates,
    day: state.day,
  })
  // Timeline entry ids are `<gameRevision>:<ordinal>` (reducer.ts); parse the numeric prefix.
  const timeline = state.timeline
    .filter(entry => limits.afterGameRevision === undefined
      || Number(entry.id.split(':', 1)[0]) > limits.afterGameRevision)
    .slice(-Math.max(1, limits.publicTimelineEntries))
    .map(entry => ({
      day: entry.day,
      phaseId: entry.phaseId,
      kind: entry.kind,
      ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
      key: entry.key,
      ...(entry.data === undefined ? {} : { data: structuredClone(entry.data) }),
    }))
  const priorContext = cloneContext(currentContext)
  return {
    version: 1,
    decisionId: request.decisionId,
    gameRevision: state.revision,
    contextRevision: priorContext.revision,
    phase: {
      id: openPhase.phaseId,
      day: openPhase.day,
      actionKind: actor.actionKind,
    },
    self: {
      playerId: player.playerId,
      seat: player.seat,
      alive: player.alive,
      role: {
        id: role.id,
        version: role.version,
        faction: role.faction,
        publicName: role.publicName,
      },
    },
    privateKnowledge: structuredClone(privateKnowledge),
    publicState: {
      day: state.day,
      phaseId: openPhase.phaseId,
      mode: openPhase.plan.mode,
      roster: state.players.map(entry => ({
        playerId: entry.playerId,
        seat: entry.seat,
        name: entry.displayName,
        alive: entry.alive,
        human: entry.human,
      })),
      timeline,
    },
    legalAction: {
      actionKind: actor.actionKind,
      spec: serializeWerewolfActionSpec(actor.spec),
      ...(actor.context === undefined ? {} : { context: structuredClone(actor.context) }),
    },
    priorContext,
  }
}

/** Detach a continuity context so the prompt cannot alias live state. */
function cloneContext(context: WerewolfBotContextV1): WerewolfBotContextV1 {
  return structuredClone(context)
}
