/**
 * Bot continuity context: the immutable profile catalog, initial context
 * construction, strict delta validation, and delta application. A context is
 * subjective data only — it can never make an illegal action legal or turn a
 * belief into knowledge. Every string passes whitespace normalization and
 * configured limits before it enters a context.
 * @module @deepseek-ai/dsh-werewolf/bot-context
 */

import { WerewolfError } from './error.ts'
import type {
  WerewolfBeliefV1,
  WerewolfBotContextDeltaV1,
  WerewolfBotContextV1,
  WerewolfBotProfileV1,
  WerewolfCommitmentV1,
  WerewolfContextLimitsV1,
} from './types.ts'
import type { WerewolfDecisionId, WerewolfGameId, WerewolfPlayerId } from './brand.ts'

/** The fixed personality deck game start assigns from deterministically. */
export const BOT_PROFILE_CATALOG: readonly WerewolfBotProfileV1[] = [
  { personalityId: 'steady-observer', speakingStyle: 'calm, evidence-first', riskStyle: 'cautious' },
  { personalityId: 'cheerful-mediator', speakingStyle: 'warm, consensus-seeking', riskStyle: 'balanced' },
  { personalityId: 'sharp-debater', speakingStyle: 'direct, logic-forward', riskStyle: 'aggressive' },
  { personalityId: 'quiet-note-taker', speakingStyle: 'terse, factual', riskStyle: 'cautious' },
  { personalityId: 'bold-accuser', speakingStyle: 'loud, pressure-applying', riskStyle: 'aggressive' },
  { personalityId: 'wry-pragmatist', speakingStyle: 'dry, flexible', riskStyle: 'balanced' },
]

const TENDENCIES = ['trusted', 'lean-village', 'unknown', 'lean-wolf', 'wolf'] as const
const CONFIDENCES = ['low', 'medium', 'high'] as const
const DELTA_KEYS = ['beliefUpdates', 'addCommitments', 'settleCommitments', 'strategy', 'memorySummary'] as const

/**
 * Collapse whitespace runs and trim; the one normalization every field takes.
 *
 * @param value - the raw text a bot or human produced.
 * @returns the normalized text.
 */
export function normalizeWerewolfText(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ')
}

function deltaInvalid(message: string): WerewolfError {
  return new WerewolfError('WEREWOLF_INVALID_CONTEXT_DELTA', message)
}

function asDeltaRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw deltaInvalid('context delta must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!(DELTA_KEYS as readonly string[]).includes(key)) {
      throw deltaInvalid(`context delta has unknown key ${JSON.stringify(key)}`)
    }
  }
  return value as Record<string, unknown>
}

function boundedText(value: unknown, maxChars: number, where: string): string {
  if (typeof value !== 'string') throw deltaInvalid(`${where} must be a string`)
  const normalized = normalizeWerewolfText(value)
  if (normalized.length > maxChars) {
    throw deltaInvalid(`${where} exceeds ${maxChars} characters after normalization`)
  }
  return normalized
}

function parseBelief(value: unknown, limits: WerewolfContextLimitsV1, where: string): WerewolfBeliefV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw deltaInvalid(`${where} must be an object`)
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!['playerId', 'tendency', 'confidence', 'basis'].includes(key)) {
      throw deltaInvalid(`${where} has unknown key ${JSON.stringify(key)}`)
    }
  }
  if (typeof record.playerId !== 'string') throw deltaInvalid(`${where}.playerId must be a string`)
  const tendency: unknown = record.tendency
  if (typeof tendency !== 'string' || !(TENDENCIES as readonly string[]).includes(tendency)) {
    throw deltaInvalid(`${where}.tendency must be one of ${TENDENCIES.join(' | ')}`)
  }
  const confidence: unknown = record.confidence
  if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
    throw deltaInvalid(`${where}.confidence must be one of ${CONFIDENCES.join(' | ')}`)
  }
  return {
    playerId: record.playerId as WerewolfPlayerId,
    tendency: tendency as WerewolfBeliefV1['tendency'],
    confidence: confidence as WerewolfBeliefV1['confidence'],
    basis: boundedText(record.basis, limits.beliefBasisChars, `${where}.basis`),
  }
}

/**
 * Strictly validate one bot-authored context delta against the actor's
 * current context, the roster, and the configured limits. Unknown fields,
 * unknown or duplicate player references, unknown or non-active commitment
 * ids, oversized strings, and over-budget arrays reject the whole delta.
 *
 * @param value - the raw model-authored delta.
 * @param context - the actor's current context.
 * @param roster - every current roster member, the actor included.
 * @param limits - configured field and size bounds.
 * @returns the validated, detached delta.
 */
export function validateWerewolfBotContextDelta(
  value: unknown,
  context: WerewolfBotContextV1,
  roster: readonly WerewolfPlayerId[],
  limits: WerewolfContextLimitsV1,
): WerewolfBotContextDeltaV1 {
  const record = asDeltaRecord(value)
  const rosterIds = new Set(roster.map(id => id as string))
  const delta: WerewolfBotContextDeltaV1 = {}
  if (record.beliefUpdates !== undefined) {
    if (!Array.isArray(record.beliefUpdates)) throw deltaInvalid('context delta beliefUpdates must be an array')
    const updates: WerewolfBeliefV1[] = []
    const seen = new Set<string>()
    for (const [index, entry] of record.beliefUpdates.entries()) {
      const belief = parseBelief(entry, limits, `beliefUpdates[${index}]`)
      if (belief.playerId === context.playerId) {
        throw deltaInvalid('beliefUpdates may not target the actor itself')
      }
      if (!rosterIds.has(belief.playerId)) {
        throw deltaInvalid(`beliefUpdates[${index}] names non-roster player`)
      }
      if (seen.has(belief.playerId)) {
        throw deltaInvalid('beliefUpdates names player more than once')
      }
      seen.add(belief.playerId)
      updates.push(belief)
    }
    delta.beliefUpdates = updates
  }
  if (record.addCommitments !== undefined) {
    if (!Array.isArray(record.addCommitments)) throw deltaInvalid('context delta addCommitments must be an array')
    const texts: Array<{ text: string }> = []
    for (const [index, entry] of record.addCommitments.entries()) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw deltaInvalid(`addCommitments[${index}] must be an object`)
      }
      const entryRecord = entry as Record<string, unknown>
      for (const key of Object.keys(entryRecord)) {
        if (key !== 'text') throw deltaInvalid(`addCommitments[${index}] has unknown key ${JSON.stringify(key)}`)
      }
      const text = boundedText(entryRecord.text, limits.commitmentChars, `addCommitments[${index}].text`)
      if (text.length === 0) throw deltaInvalid(`addCommitments[${index}].text must not be empty`)
      texts.push({ text })
    }
    if (context.commitments.length + texts.length > limits.maxCommitments) {
      throw deltaInvalid(`addCommitments would exceed the ${limits.maxCommitments} commitment budget`)
    }
    delta.addCommitments = texts
  }
  if (record.settleCommitments !== undefined) {
    if (!Array.isArray(record.settleCommitments)) throw deltaInvalid('context delta settleCommitments must be an array')
    const active = new Set(context.commitments.filter(entry => entry.status === 'active').map(entry => entry.id))
    const settles: Array<{ id: string; status: 'fulfilled' | 'abandoned' }> = []
    const seen = new Set<string>()
    for (const [index, entry] of record.settleCommitments.entries()) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw deltaInvalid(`settleCommitments[${index}] must be an object`)
      }
      const entryRecord = entry as Record<string, unknown>
      for (const key of Object.keys(entryRecord)) {
        if (key !== 'id' && key !== 'status') {
          throw deltaInvalid(`settleCommitments[${index}] has unknown key ${JSON.stringify(key)}`)
        }
      }
      if (typeof entryRecord.id !== 'string') throw deltaInvalid(`settleCommitments[${index}].id must be a string`)
      if (entryRecord.status !== 'fulfilled' && entryRecord.status !== 'abandoned') {
        throw deltaInvalid(`settleCommitments[${index}].status must be fulfilled or abandoned`)
      }
      if (!active.has(entryRecord.id)) {
        throw deltaInvalid(`settleCommitments[${index}] names a commitment that is not active`)
      }
      if (seen.has(entryRecord.id)) throw deltaInvalid('settleCommitments names one commitment twice')
      seen.add(entryRecord.id)
      settles.push({ id: entryRecord.id, status: entryRecord.status })
    }
    delta.settleCommitments = settles
  }
  if (record.strategy !== undefined) {
    if (typeof record.strategy !== 'object' || record.strategy === null || Array.isArray(record.strategy)) {
      throw deltaInvalid('context delta strategy must be an object')
    }
    const strategy = record.strategy as Record<string, unknown>
    for (const key of Object.keys(strategy)) {
      if (!['objective', 'intendedClaim', 'priorityTargets'].includes(key)) {
        throw deltaInvalid(`strategy has unknown key ${JSON.stringify(key)}`)
      }
    }
    const objective = boundedText(strategy.objective, limits.strategyChars, 'strategy.objective')
    if (objective.length === 0) throw deltaInvalid('strategy.objective must not be empty')
    if (!Array.isArray(strategy.priorityTargets)) throw deltaInvalid('strategy.priorityTargets must be an array')
    const targets: WerewolfPlayerId[] = []
    const seenTargets = new Set<string>()
    for (const [index, target] of strategy.priorityTargets.entries()) {
      if (typeof target !== 'string' || !rosterIds.has(target)) {
        throw deltaInvalid(`strategy.priorityTargets[${index}] names a non-roster player`)
      }
      if (seenTargets.has(target)) throw deltaInvalid('strategy.priorityTargets names one player twice')
      seenTargets.add(target)
      targets.push(target as WerewolfPlayerId)
    }
    delta.strategy = {
      objective,
      ...(strategy.intendedClaim === undefined
        ? {}
        : { intendedClaim: boundedText(strategy.intendedClaim, limits.strategyChars, 'strategy.intendedClaim') }),
      priorityTargets: targets,
    }
  }
  if (record.memorySummary !== undefined) {
    delta.memorySummary = boundedText(record.memorySummary, limits.memorySummaryChars, 'memorySummary')
  }
  return delta
}

/**
 * Build the initial context for one bot seat: every other roster member
 * starts as an unknown low-confidence belief, no commitments, and the
 * profile-derived default strategy.
 *
 * @param gameId - the owning game.
 * @param playerId - the bot's player id.
 * @param profile - the immutable assigned profile.
 * @param roster - every roster member in seat order, this bot included.
 * @returns the detached initial context at revision 0.
 */
export function initialWerewolfBotContext(
  gameId: WerewolfGameId,
  playerId: WerewolfPlayerId,
  profile: WerewolfBotProfileV1,
  roster: readonly WerewolfPlayerId[],
): WerewolfBotContextV1 {
  return {
    version: 1,
    gameId,
    playerId,
    revision: 0,
    profile,
    beliefs: roster
      .filter(id => id !== playerId)
      .map(id => ({
        playerId: id,
        tendency: 'unknown',
        confidence: 'low',
        basis: 'No evidence yet.',
      })),
    commitments: [],
    strategy: {
      objective: `Play to win as seat ${profile.personalityId} style`,
      priorityTargets: [],
    },
    memorySummary: 'The game has just started.',
  }
}

/**
 * Apply one validated delta and produce the next context checkpoint. The
 * caller supplies the decision identity; commitment ids are minted from the
 * decision id and array position, `lastDecision` is set, and the revision
 * increments by one.
 *
 * @param context - the actor's current checkpoint.
 * @param delta - a delta that passed `validateWerewolfBotContextDelta`.
 * @param decision - the decision this delta belongs to.
 * @param decision.phaseId - the phase the decision answered.
 * @param decision.actionKind - the action kind the decision answered.
 * @returns the detached next checkpoint at revision + 1.
 */
export function applyWerewolfBotContextDelta(
  context: WerewolfBotContextV1,
  delta: WerewolfBotContextDeltaV1,
  decision: { decisionId: WerewolfDecisionId; phaseId: string; actionKind: string },
): WerewolfBotContextV1 {
  const beliefs = context.beliefs.map(belief => ({ ...belief }))
  for (const update of delta.beliefUpdates ?? []) {
    const existing = beliefs.find(belief => belief.playerId === update.playerId)
    if (existing === undefined) {
      beliefs.push({ ...update })
    } else {
      existing.tendency = update.tendency
      existing.confidence = update.confidence
      existing.basis = update.basis
    }
  }
  const settleIds = new Set((delta.settleCommitments ?? []).map(entry => entry.id))
  const commitments: WerewolfCommitmentV1[] = context.commitments.map(commitment =>
    settleIds.has(commitment.id)
      ? {
        ...commitment,
        /* v8 ignore next 2 -- settleCommitments exists in this branch, so find matches */
        status: (delta.settleCommitments ?? []).find(entry => entry.id === commitment.id)?.status
          ?? commitment.status,
      }
      : { ...commitment })
  ;(delta.addCommitments ?? []).forEach((entry, index) => {
    commitments.push({ id: `${decision.decisionId}:${index}`, text: entry.text, status: 'active' })
  })
  return {
    version: 1,
    gameId: context.gameId,
    playerId: context.playerId,
    revision: context.revision + 1,
    profile: context.profile,
    beliefs,
    commitments,
    strategy: delta.strategy === undefined
      ? { ...context.strategy, priorityTargets: [...context.strategy.priorityTargets] }
      : { ...delta.strategy, priorityTargets: [...delta.strategy.priorityTargets] },
    memorySummary: delta.memorySummary ?? context.memorySummary,
    lastDecision: {
      decisionId: decision.decisionId,
      phaseId: decision.phaseId,
      actionKind: decision.actionKind,
    },
  }
}
