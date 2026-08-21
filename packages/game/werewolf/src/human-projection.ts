/** Human-authorized Werewolf views and terminal replay projection. */

import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { serializeWerewolfActionSpec } from './projection.ts'
import type { WerewolfCompiledRuleSetV1, WerewolfGameResultV1, WerewolfGameStateV1, WerewolfTimelineEntryV1 } from './types.ts'

/** One rule set selectable by the local game UI. */
export interface WerewolfRuleSetOptionV1 {
  id: string
  revision: number
  displayName: string
  playerCount: number
}

/** Current human action form, derived only from the authoritative open plan. */
export interface WerewolfHumanActionFormV1 {
  phaseInstanceId: string
  phaseId: string
  day: number
  actionKind: string
  spec: ReturnType<typeof serializeWerewolfActionSpec>
}

/** The complete view authorized for the bound human participant. */
export interface WerewolfHumanViewV1 {
  version: 1
  gameId: string
  gameRevision: number
  status: WerewolfGameStateV1['status']
  day: number
  ruleSet: WerewolfRuleSetOptionV1
  availableRuleSets: WerewolfRuleSetOptionV1[]
  players: Array<{
    playerId: string
    seat: number
    displayName: string
    alive: boolean
    human: boolean
    deathDay?: number
    deathCause?: string
    revealedRole?: { id: string; name: string; faction: string }
  }>
  self: {
    playerId: string
    seat: number
    role: { id: string; name: string; faction: string }
    resources: Record<string, number>
    teammates: Array<{ playerId: string; seat: number; alive: boolean }>
    notices: Array<{ kind: string; data: JsonValue }>
  }
  phase: null | {
    phaseInstanceId: string
    phaseId: string
    segment: 'setup' | 'night' | 'day'
    day: number
    mode: 'parallel-private' | 'seat-order-public'
  }
  actionForm: WerewolfHumanActionFormV1 | null
  timeline: WerewolfTimelineEntryV1[]
  pauseReason: WerewolfGameStateV1['pauseReason']
  result: WerewolfGameResultV1 | null
}

/** Terminal replay made of authorized state checkpoints rather than raw secret events. */
export interface WerewolfReplayV1 {
  version: 1
  gameId: string
  finalRevision: number
  checkpoints: Array<{ eventType: string; gameRevision: number; view: WerewolfHumanViewV1 }>
}

/**
 * Every registered rule set as a lobby-selectable option, sorted by id then
 * revision.
 *
 * @param runtime - rule registry to list.
 * @returns the detached rule-set options.
 */
export function listWerewolfRuleSetOptions(runtime: WerewolfRuleSetSource): WerewolfRuleSetOptionV1[] {
  return [...runtime.listRuleSets().values()]
    .map(rule => ({ id: rule.id, revision: rule.revision, displayName: rule.displayName, playerCount: rule.playerCount }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision)
}

/** Minimal rule-registry face the projections read; WerewolfRuntime satisfies it structurally. */
export interface WerewolfRuleSetSource {
  /** Registered rule-set inputs keyed `${id}@${revision}`. */
  listRuleSets(): ReadonlyMap<string, { id: string; revision: number; displayName: string; playerCount: number }>
}

function ruleOptions(runtime: WerewolfRuleSetSource): WerewolfRuleSetOptionV1[] {
  return listWerewolfRuleSetOptions(runtime)
}

/**
 * Build a human view without serializing another seat's role state or notices.
 * @param runtime - rule registry used for display metadata.
 * @param state - current folded game state.
 * @param rules - compiled immutable rules for this game.
 * @returns authorized view for the bound human seat.
 */
export function projectWerewolfHumanView(
  runtime: WerewolfRuleSetSource,
  state: WerewolfGameStateV1,
  rules: WerewolfCompiledRuleSetV1,
): WerewolfHumanViewV1 {
  const self = state.players.find(player => player.playerId === state.humanPlayerId)
  if (self === undefined) throw new Error(`werewolf game ${state.gameId} has no human player`)
  const ownRole = rules.roles.get(`${self.roleId}@${self.roleVersion}`)
  if (ownRole === undefined) throw new Error(`werewolf role ${self.roleId}@${self.roleVersion} is unavailable`)
  const roleFor = (roleId: string, roleVersion: number) => rules.roles.get(`${roleId}@${roleVersion}`)
  const open = state.openPhase
  let actionForm: WerewolfHumanActionFormV1 | null = null
  if (open !== null) {
    const actor = open.plan.actors.find(candidate => candidate.playerId === self.playerId)
    const settled = open.settled.some(candidate => candidate.playerId === self.playerId)
    const firstRemaining = open.plan.actors.find(candidate => !open.settled.some(entry => entry.playerId === candidate.playerId))
    if (actor !== undefined && !settled
      && (open.plan.mode === 'parallel-private' || firstRemaining?.playerId === self.playerId)) {
      actionForm = {
        phaseInstanceId: open.phaseInstanceId,
        phaseId: open.phaseId,
        day: open.day,
        actionKind: actor.actionKind,
        spec: serializeWerewolfActionSpec(actor.spec),
      }
    }
  }
  const availableRuleSets = ruleOptions(runtime)
  return {
    version: 1,
    gameId: state.gameId,
    gameRevision: state.revision,
    status: state.status,
    day: state.day,
    ruleSet: {
      id: state.ruleSet.id,
      revision: state.ruleSet.revision,
      displayName: state.ruleSet.displayName,
      playerCount: state.ruleSet.playerCount,
    },
    availableRuleSets,
    players: state.players.map((player) => {
      const revealed = state.status === 'ended' ? roleFor(player.roleId, player.roleVersion) : undefined
      return {
        playerId: player.playerId,
        seat: player.seat,
        displayName: player.displayName,
        alive: player.alive,
        human: player.human,
        ...(player.deathDay === undefined ? {} : { deathDay: player.deathDay }),
        ...(player.deathCause === undefined ? {} : { deathCause: player.deathCause }),
        ...(revealed === undefined ? {} : { revealedRole: { id: player.roleId, name: revealed.publicName, faction: revealed.faction } }),
      }
    }),
    self: {
      playerId: self.playerId,
      seat: self.seat,
      role: { id: ownRole.id, name: ownRole.publicName, faction: ownRole.faction },
      resources: { ...self.resources },
      teammates: ownRole.seesFactionTeammates === true
        ? state.players.filter(player => player.playerId !== self.playerId && player.faction === self.faction)
          .map(player => ({ playerId: player.playerId, seat: player.seat, alive: player.alive }))
        : [],
      notices: self.notices.map(notice => ({ kind: notice.kind, data: structuredClone(notice.data) })),
    },
    phase: open === null ? null : {
      phaseInstanceId: open.phaseInstanceId,
      phaseId: open.phaseId,
      segment: open.segment,
      day: open.day,
      mode: open.plan.mode,
    },
    actionForm,
    timeline: state.timeline.map(entry => structuredClone(entry)),
    pauseReason: state.pauseReason,
    result: state.result === null ? null : structuredClone(state.result),
  }
}
