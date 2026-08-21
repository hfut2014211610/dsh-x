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

import type {
  WerewolfActionSpecV1,
  WerewolfBotContextV1,
  WerewolfBotPromptV1,
  WerewolfCompiledRuleSetV1,
  WerewolfGameStateV1,
  WerewolfSingleActionSpecV1,
} from './types.ts'
import type { WerewolfBotActionRequest } from './engine.ts'

/** Bounds the projection applies; resolved from plugin configuration. */
export interface WerewolfProjectionLimitsV1 {
  /** How many trailing public timeline entries the prompt carries. */
  publicTimelineEntries: number
}

/** The JSON view of one non-compound action spec, as the prompt serializes it. */
export type WerewolfSingleActionSpecJsonV1 =
  | { kind: 'player-target'; targets: string[]; allowSkip: boolean }
  | { kind: 'choice'; options: string[]; allowSkip: boolean }
  | { kind: 'text'; maxChars: number; allowSkip: boolean }

/** The JSON view of one closed action spec, as the prompt serializes it. */
export type WerewolfActionSpecJsonV1 =
  | WerewolfSingleActionSpecJsonV1
  | { kind: 'compound'; fields: Array<{ id: string; spec: WerewolfSingleActionSpecJsonV1 }>; allowSkip: boolean }

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
  const player = state.players.find(entry => entry.playerId === request.playerId)
  if (player === undefined) {
    throw new Error(`werewolf projection: player ${request.playerId} is not seated`)
  }
  const role = rules.roles.get(`${player.roleId}@${player.roleVersion}`)
  if (role === undefined) {
    throw new Error(`werewolf projection: role ${player.roleId}@${player.roleVersion} did not compile`)
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
  const timeline = state.timeline
    .slice(-Math.max(1, limits.publicTimelineEntries))
    .map(entry => ({
      day: entry.day,
      phaseId: entry.phaseId,
      kind: entry.kind,
      ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
      key: entry.key,
      ...(entry.data === undefined ? {} : { data: structuredClone(entry.data) }),
    }))
  const priorContext = cloneContext(request.priorContext)
  return {
    version: 1,
    decisionId: request.decisionId,
    gameRevision: request.sourceGameRevision,
    contextRevision: priorContext.revision,
    phase: {
      id: request.phaseId,
      day: request.day,
      actionKind: request.actionKind,
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
      phaseId: request.phaseId,
      mode: state.openPhase?.plan.mode ?? 'parallel-private',
      roster: state.players.map(entry => ({
        seat: entry.seat,
        name: entry.displayName,
        alive: entry.alive,
        human: entry.human,
      })),
      timeline,
    },
    legalAction: {
      actionKind: request.actionKind,
      spec: serializeWerewolfActionSpec(request.spec),
      ...(request.context === undefined ? {} : { context: structuredClone(request.context) }),
    },
    priorContext,
  }
}

/** Detach a continuity context so the prompt cannot alias live state. */
function cloneContext(context: WerewolfBotContextV1): WerewolfBotContextV1 {
  return structuredClone(context)
}
