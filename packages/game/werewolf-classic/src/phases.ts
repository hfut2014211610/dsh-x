/**
 * Classic phase definitions at version 1: the three night actions (wolf kill,
 * seer inspection, witch potions) and the three day phases (announcement,
 * discussion, vote). Each phase is a pure function of its open/resolve input
 * and reaches the engine only through declarative resolution records.
 * @module @deepseek-ai/dsh-werewolf-classic/phases
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {
  WerewolfAnnouncementRecordV1,
  WerewolfParticipantFactsV1,
  WerewolfPhaseDefinition,
  WerewolfPhaseOpenInputV1,
  WerewolfPhaseResolveInputV1,
  WerewolfPlayerFactsV1,
  WerewolfPlayerId,
  WerewolfPrivateNoticeRecordV1,
  WerewolfRolePhaseBindingV1,
} from '@deepseek-ai/dsh-werewolf'
import { asOptionsRecord, optionsInvalid, parseNoOptions, rejectUnknownOptions } from './shared.ts'
import type { WitchRoleOptions } from './roles.ts'

/** One accepted action as the engine hands it to `resolve`. */
type AcceptedAction = { playerId: WerewolfPlayerId; action: JsonValue }

/** The mutable record lists a phase fills before returning its resolution. */
interface ResolutionDraft {
  eliminations: Array<{ playerId: WerewolfPlayerId; cause: string }>
  prevented: Array<{ playerId: WerewolfPlayerId; cause: string }>
  resourceReplacements: Array<{ playerId: WerewolfPlayerId; resourceId: string; remaining: number }>
  roleStateReplacements: Array<{ playerId: WerewolfPlayerId; roleState: JsonValue }>
  privateNotices: WerewolfPrivateNoticeRecordV1[]
  announcements: WerewolfAnnouncementRecordV1[]
  votes: Array<{ voterId: WerewolfPlayerId; targetId: WerewolfPlayerId | null }>
}

/**
 * Start an empty resolution draft.
 * @returns the draft whose lists a phase fills before adding its outcome.
 */
function emptyResolution(): ResolutionDraft {
  return {
    eliminations: [],
    prevented: [],
    resourceReplacements: [],
    roleStateReplacements: [],
    privateNotices: [],
    announcements: [],
    votes: [],
  }
}

/**
 * Sort comparison by ascending seat.
 * @param a - one seated entry.
 * @param b - the other seated entry.
 * @returns the seat difference.
 */
function bySeat(a: { seat: number }, b: { seat: number }): number {
  return a.seat - b.seat
}

/**
 * The living participants of the opening phase, in seat order.
 * @param input - the phase open input.
 * @returns living participant facts.
 */
function livingParticipants(input: WerewolfPhaseOpenInputV1): WerewolfParticipantFactsV1[] {
  return input.participants.filter(entry => entry.alive).sort(bySeat)
}

/**
 * The living players, in seat order.
 * @param input - the phase open input.
 * @returns living public player facts.
 */
function livingPlayers(input: WerewolfPhaseOpenInputV1): WerewolfPlayerFactsV1[] {
  return input.players.filter(entry => entry.alive).sort(bySeat)
}

/**
 * The seat of one roster member.
 * @param players - the public roster.
 * @param playerId - the acting player.
 * @returns the actor's seat.
 */
function seatOf(players: ReadonlyArray<WerewolfPlayerFactsV1>, playerId: WerewolfPlayerId): number {
  const facts = players.find(entry => entry.playerId === playerId)
  if (facts === undefined) {
    throw new Error(`werewolf-classic: action actor ${playerId} is not on the roster`)
  }
  return facts.seat
}

/**
 * The accepted actions ordered by actor seat, so resolution output never
 * depends on settle order.
 * @param input - the phase resolve input.
 * @returns the seat-ordered accepted actions.
 */
function actionsBySeat(input: WerewolfPhaseResolveInputV1): AcceptedAction[] {
  return [...input.actions]
    .sort((a, b) => seatOf(input.players, a.playerId) - seatOf(input.players, b.playerId))
}

/**
 * The participant facts of one acting player.
 * @param input - the phase open input carrying the participants.
 * @param playerId - the acting player.
 * @returns the actor's participant facts.
 */
function participantOf(
  input: WerewolfPhaseOpenInputV1,
  playerId: WerewolfPlayerId,
): WerewolfParticipantFactsV1 {
  const participant = input.participants.find(entry => entry.playerId === playerId)
  if (participant === undefined) {
    throw new Error(`werewolf-classic: action actor ${playerId} is not a phase participant`)
  }
  return participant
}

/**
 * The latest recorded outcome of one phase id earlier in the current day.
 * @param input - the phase open input.
 * @param phaseId - the phase whose outcome is wanted.
 * @returns the recorded outcome, or undefined when absent.
 */
function priorOutcome(input: WerewolfPhaseOpenInputV1, phaseId: string): JsonValue | undefined {
  const prior = [...input.sameDayHistory].reverse().find(entry => entry.phaseId === phaseId)
  return prior?.resolution.outcome
}

/**
 * Tonight's wolf-kill victim.
 * @param input - the phase open input.
 * @returns the victim id, or null when no kill outcome named one.
 */
function tonightVictim(input: WerewolfPhaseOpenInputV1): WerewolfPlayerId | null {
  const outcome = priorOutcome(input, 'night.wolf-kill')
  if (outcome === undefined) return null
  return (outcome as { victim: WerewolfPlayerId | null }).victim ?? null
}

/**
 * Read one potion's remaining count; classic witch resources always carry
 * both potion keys.
 * @param resources - the witch's resource counters.
 * @param id - the potion id.
 * @returns the remaining count.
 */
function potionOf(resources: Readonly<Record<string, number>>, id: 'antidote' | 'poison'): number {
  return resources[id] as number
}

/**
 * Parse the one binding kind a night phase accepts, with empty binding
 * options.
 * @param binding - the role's binding to this phase.
 * @param kind - the only supported binding kind.
 * @param phaseId - the phase id diagnostics name.
 * @returns the parsed empty binding.
 */
function parseNightBinding(binding: WerewolfRolePhaseBindingV1, kind: string, phaseId: string): JsonValue {
  if (binding.kind !== kind) {
    optionsInvalid(
      `phase ${phaseId} supports binding kind ${JSON.stringify(kind)}, got ${JSON.stringify(binding.kind)}`,
    )
  }
  const record = asOptionsRecord(binding.options, `${phaseId} binding options`)
  rejectUnknownOptions(record, [], `${phaseId} binding options`)
  return {}
}

/**
 * Reject every role binding; the day phases admit none in version 1.
 * @param binding - the role's binding attempt.
 * @param phaseId - the phase id diagnostics name.
 * @returns never; the call always throws.
 */
function parseNoBindings(binding: WerewolfRolePhaseBindingV1, phaseId: string): never {
  optionsInvalid(`phase ${phaseId} accepts no role bindings (got kind ${JSON.stringify(binding.kind)})`)
}

/** Night wolf kill: every living wolf names one living non-wolf victim; dawn owns the death. */
export const WOLF_KILL_PHASE: WerewolfPhaseDefinition = {
  id: 'night.wolf-kill',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'night.wolf-kill options')
  },
  parseRoleBinding(binding) {
    return parseNightBinding(binding, 'kill', 'night.wolf-kill')
  },
  compile: () => ({
    id: 'night.wolf-kill',
    version: 1,
    open(input) {
      const wolves = livingParticipants(input)
      if (wolves.length === 0) return { kind: 'skip', reason: 'no living wolves' }
      const wolfIds = new Set(wolves.map(wolf => wolf.playerId))
      const targets = livingPlayers(input)
        .filter(entry => !wolfIds.has(entry.playerId))
        .map(entry => entry.playerId)
      if (targets.length === 0) return { kind: 'skip', reason: 'no living non-wolf targets' }
      const spec = { kind: 'player-target' as const, targets, allowSkip: false }
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private',
          actors: wolves.map(wolf => ({
            playerId: wolf.playerId,
            seat: wolf.seat,
            actionKind: 'wolf-kill',
            spec,
          })),
        },
      }
    },
    resolve(input) {
      const actions = actionsBySeat(input)
      const proposed: WerewolfPlayerId[] = []
      for (const entry of actions) {
        const target = (entry.action as { value: WerewolfPlayerId }).value
        if (!proposed.includes(target)) proposed.push(target)
      }
      let victim: WerewolfPlayerId | null = null
      if (proposed.length === 1) {
        // The length check just ran; the index cannot miss.
        victim = proposed[0] as WerewolfPlayerId
      } else if (proposed.length > 1 && input.policies.wolfTie === 'seeded-random') {
        victim = input.rng.pick(proposed)
      }
      const resolution = emptyResolution()
      resolution.votes = actions.map(entry => ({
        voterId: entry.playerId,
        targetId: (entry.action as { value: WerewolfPlayerId }).value,
      }))
      resolution.privateNotices = actions.map(entry => ({
        toPlayerId: entry.playerId,
        kind: 'wolf-kill-result',
        data: { victim },
      }))
      const outcome = { victim, proposed }
      return { ...resolution, outcome }
    },
  }),
}

/** Night seer inspection: each living seer records one check of a living non-self player. */
export const SEER_INSPECT_PHASE: WerewolfPhaseDefinition = {
  id: 'night.seer-inspect',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'night.seer-inspect options')
  },
  parseRoleBinding(binding) {
    return parseNightBinding(binding, 'inspect', 'night.seer-inspect')
  },
  compile: () => ({
    id: 'night.seer-inspect',
    version: 1,
    open(input) {
      const seers = livingParticipants(input)
      if (seers.length === 0) return { kind: 'skip', reason: 'no living seer' }
      const alive = livingPlayers(input)
      if (alive.length <= 1) return { kind: 'skip', reason: 'no living inspection target' }
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private',
          actors: seers.map(seer => ({
            playerId: seer.playerId,
            seat: seer.seat,
            actionKind: 'seer-inspect',
            spec: {
              kind: 'player-target' as const,
              targets: alive.filter(entry => entry.playerId !== seer.playerId).map(entry => entry.playerId),
              allowSkip: false,
            },
          })),
        },
      }
    },
    resolve(input) {
      const resolution = emptyResolution()
      const checks: Array<{ target: WerewolfPlayerId; faction: string; day: number }> = []
      for (const entry of actionsBySeat(input)) {
        const target = (entry.action as { value: WerewolfPlayerId }).value
        const seer = participantOf(input, entry.playerId)
        const priorChecks = (seer.roleState as { checks: JsonValue[] }).checks
        const targetFacts = input.players.find(player => player.playerId === target)
        if (targetFacts === undefined) {
          throw new Error(`werewolf-classic: seer target ${target} is not on the roster`)
        }
        const faction = targetFacts.faction
        resolution.roleStateReplacements.push({
          playerId: entry.playerId,
          roleState: {
            checks: [...priorChecks, { target, faction, day: input.day }],
          },
        })
        resolution.privateNotices.push({
          toPlayerId: entry.playerId,
          kind: 'seer-inspect',
          data: { target, faction },
        })
        checks.push({ target, faction, day: input.day })
      }
      const outcome = { checks }
      return { ...resolution, outcome }
    },
  }),
}

/** Night witch action: antidote tonight's victim and/or poison one living player. */
export const WITCH_PHASE: WerewolfPhaseDefinition = {
  id: 'night.witch',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'night.witch options')
  },
  parseRoleBinding(binding) {
    return parseNightBinding(binding, 'act', 'night.witch')
  },
  compile: () => ({
    id: 'night.witch',
    version: 1,
    open(input) {
      const witches = livingParticipants(input)
      if (witches.length === 0) return { kind: 'skip', reason: 'no living witch' }
      const withPotion = witches.filter(witch =>
        potionOf(witch.resources, 'antidote') > 0 || potionOf(witch.resources, 'poison') > 0)
      if (withPotion.length === 0) return { kind: 'skip', reason: 'witch has no potion left' }
      const victim = tonightVictim(input)
      const alive = livingPlayers(input)
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private',
          actors: withPotion.map((witch) => {
            const options = witch.roleState as unknown as WitchRoleOptions
            const selfSaveAllowed = victim !== witch.playerId
              || (options.selfSave === 'first-night-only' && input.day === 1)
            const antidoteOptions = victim !== null
              && potionOf(witch.resources, 'antidote') > 0
              && selfSaveAllowed
              ? ['use', 'skip']
              : ['skip']
            const poisonTargets = potionOf(witch.resources, 'poison') > 0
              ? alive.filter(entry => entry.playerId !== witch.playerId).map(entry => entry.playerId)
              : []
            return {
              playerId: witch.playerId,
              seat: witch.seat,
              actionKind: 'witch-act',
              spec: {
                kind: 'compound' as const,
                allowSkip: false,
                fields: [
                  { id: 'antidote', spec: { kind: 'choice' as const, options: antidoteOptions, allowSkip: false } },
                  { id: 'poison', spec: { kind: 'player-target' as const, targets: poisonTargets, allowSkip: true } },
                ],
              },
              context: { victim },
            }
          }),
        },
      }
    },
    resolve(input) {
      const victim = tonightVictim(input)
      const resolution = emptyResolution()
      let saved = false
      let poisoned: WerewolfPlayerId | null = null
      for (const entry of actionsBySeat(input)) {
        const action = entry.action as { antidote: 'use' | 'skip'; poison: WerewolfPlayerId | null }
        const witch = participantOf(input, entry.playerId)
        if (action.antidote === 'use') {
          resolution.resourceReplacements.push({
            playerId: entry.playerId,
            resourceId: 'antidote',
            remaining: potionOf(witch.resources, 'antidote') - 1,
          })
          saved = true
        }
        if (action.poison !== null) {
          resolution.resourceReplacements.push({
            playerId: entry.playerId,
            resourceId: 'poison',
            remaining: potionOf(witch.resources, 'poison') - 1,
          })
          poisoned = action.poison
        }
      }
      if (saved && victim !== null) {
        resolution.prevented.push({ playerId: victim, cause: 'witch-antidote' })
      }
      const outcome = { victim, saved, poisoned }
      return { ...resolution, outcome }
    },
  }),
}

/** Day announcement: declare the night's deaths; zero actors, auto-resolving. */
export const ANNOUNCE_PHASE: WerewolfPhaseDefinition = {
  id: 'day.announce',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'day.announce options')
  },
  parseRoleBinding(binding) {
    return parseNoBindings(binding, 'day.announce')
  },
  compile: () => ({
    id: 'day.announce',
    version: 1,
    open: () => ({ kind: 'plan', plan: { mode: 'parallel-private', actors: [] } }),
    resolve(input) {
      const killOutcome = priorOutcome(input, 'night.wolf-kill') as { victim: WerewolfPlayerId | null } | undefined
      const witchOutcome = priorOutcome(input, 'night.witch') as {
        saved: boolean
        poisoned: WerewolfPlayerId | null
      } | undefined
      const victim = killOutcome === undefined ? null : killOutcome.victim
      const saved = witchOutcome?.saved === true
      const poisoned = witchOutcome === undefined ? null : witchOutcome.poisoned
      const deaths: Array<{ playerId: WerewolfPlayerId; cause: string }> = []
      if (victim !== null && !saved) deaths.push({ playerId: victim, cause: 'wolf-kill' })
      if (poisoned !== null && !deaths.some(death => death.playerId === poisoned) && isAlive(input, poisoned)) {
        deaths.push({ playerId: poisoned, cause: 'poison' })
      }
      const resolution = emptyResolution()
      resolution.eliminations = deaths
      resolution.announcements = deaths.length > 0
        ? deaths.map(death => ({
          kind: 'death' as const,
          key: 'announce.death',
          data: { playerId: death.playerId, cause: death.cause },
        }))
        : [{ kind: 'system' as const, key: 'announce.no-death' }]
      const outcome = { deaths }
      return { ...resolution, outcome }
    },
  }),
}

/**
 * Whether one player is alive on the public roster.
 * @param input - the phase open input.
 * @param playerId - the player to check.
 * @returns whether the roster lists the player as alive.
 */
function isAlive(input: WerewolfPhaseOpenInputV1, playerId: WerewolfPlayerId): boolean {
  return input.players.find(entry => entry.playerId === playerId)?.alive === true
}

/** Day discussion: every living player speaks once, in seat order. */
export const DISCUSSION_PHASE: WerewolfPhaseDefinition = {
  id: 'day.discussion',
  version: 1,
  parseOptions(value) {
    return parseNoOptions(value, 'day.discussion options')
  },
  parseRoleBinding(binding) {
    return parseNoBindings(binding, 'day.discussion')
  },
  compile: () => ({
    id: 'day.discussion',
    version: 1,
    open(input) {
      return {
        kind: 'plan',
        plan: {
          mode: 'seat-order-public',
          actors: livingPlayers(input).map(entry => ({
            playerId: entry.playerId,
            seat: entry.seat,
            actionKind: 'speak',
            spec: { kind: 'text' as const, maxChars: input.policies.speechMaxChars, allowSkip: true },
          })),
        },
      }
    },
    resolve(input) {
      const resolution = emptyResolution()
      const outcome = {
        speeches: (input.speeches ?? []).map(speech => ({ playerId: speech.playerId, text: speech.text })),
      }
      return { ...resolution, outcome }
    },
  }),
}

/**
 * The candidate ids one vote occurrence targets: the prior occurrence's tied
 * players, or every living player.
 * @param input - the phase open input.
 * @param aliveIds - every living player id in seat order.
 * @returns the candidate ids for this occurrence.
 */
function voteTargetBase(input: WerewolfPhaseOpenInputV1, aliveIds: readonly WerewolfPlayerId[]): WerewolfPlayerId[] {
  if (input.occurrence === 0) return [...aliveIds]
  const prior = [...input.sameDayHistory].reverse().find(entry => entry.phaseId === 'day.vote')
  const tied = prior?.resolution.voteOutcome?.tiedPlayers
  if (tied === undefined || tied.length === 0) return [...aliveIds]
  return [...tied]
}

/** Day vote: every living player votes; a unique high count eliminates, ties report to the engine. */
export const VOTE_PHASE: WerewolfPhaseDefinition = {
  id: 'day.vote',
  version: 1,
  repeatable: true,
  parseOptions(value) {
    return parseNoOptions(value, 'day.vote options')
  },
  parseRoleBinding(binding) {
    return parseNoBindings(binding, 'day.vote')
  },
  compile: () => ({
    id: 'day.vote',
    version: 1,
    open(input) {
      const alive = livingPlayers(input)
      const aliveIds = alive.map(entry => entry.playerId)
      const aliveSet = new Set(aliveIds.map(id => id as string))
      const base = voteTargetBase(input, aliveIds)
      return {
        kind: 'plan',
        plan: {
          mode: 'parallel-private',
          actors: alive.map(voter => ({
            playerId: voter.playerId,
            seat: voter.seat,
            actionKind: 'vote',
            spec: {
              kind: 'player-target' as const,
              targets: base.filter(id => id !== voter.playerId && aliveSet.has(id as string)),
              allowSkip: true,
            },
          })),
        },
      }
    },
    resolve(input) {
      const resolution = emptyResolution()
      const actions = actionsBySeat(input)
      resolution.votes = actions.map(entry => ({
        voterId: entry.playerId,
        targetId: (entry.action as { value: WerewolfPlayerId | null }).value,
      }))
      const counts = new Map<string, number>()
      for (const vote of resolution.votes) {
        if (vote.targetId === null) continue
        const key = vote.targetId as string
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      let eliminated: WerewolfPlayerId | null = null
      let tiedPlayers: WerewolfPlayerId[] = []
      if (counts.size > 0) {
        let max = 0
        for (const count of counts.values()) max = Math.max(max, count)
        tiedPlayers = livingPlayers(input)
          .filter(entry => counts.get(entry.playerId as string) === max)
          .map(entry => entry.playerId)
        if (tiedPlayers.length === 1) {
          // The length check just ran; the index cannot miss.
          eliminated = tiedPlayers[0] as WerewolfPlayerId
          resolution.eliminations.push({ playerId: eliminated, cause: 'vote' })
          resolution.announcements.push({
            kind: 'vote',
            key: 'vote.eliminated',
            data: { playerId: eliminated },
          })
          tiedPlayers = []
        } else {
          resolution.announcements.push({ kind: 'vote', key: 'vote.tie', data: { tiedPlayers } })
        }
      }
      const outcome = { eliminated, tiedPlayers }
      return { ...resolution, outcome, voteOutcome: { eliminated, tiedPlayers } }
    },
  }),
}
