import { describe, expect, it } from 'vitest'
import {
  applyWerewolfBotContextDelta,
  BOT_PROFILE_CATALOG,
  initialWerewolfBotContext,
  normalizeWerewolfText,
  validateWerewolfBotContextDelta,
} from '../src/bot-context.ts'
import type { WerewolfBotContextV1, WerewolfContextLimitsV1 } from '../src/types.ts'
import { WerewolfGameId, WerewolfPlayerId } from '../src/brand.ts'

const limits = (): WerewolfContextLimitsV1 => ({
  memorySummaryChars: 8,
  beliefBasisChars: 8,
  commitmentChars: 8,
  strategyChars: 8,
  maxCommitments: 2,
})

const p1 = WerewolfPlayerId('p1')
const p2 = WerewolfPlayerId('p2')
const p3 = WerewolfPlayerId('p3')
const P = [p1, p2, p3]
const gameId = WerewolfGameId('g1')

function context(): WerewolfBotContextV1 {
  const base = initialWerewolfBotContext(gameId, p1, BOT_PROFILE_CATALOG[0] as never, P)
  return applyWerewolfBotContextDelta(base, {
    addCommitments: [{ text: 'Vote seat 2 tomorrow' }],
  }, { decisionId: 'd1' as never, phaseId: 'day.discussion', actionKind: 'speech' })
}

describe('BOT_PROFILE_CATALOG', () => {
  it('ships a non-empty deck of valid, distinct personalities', () => {
    expect(BOT_PROFILE_CATALOG.length).toBeGreaterThan(1)
    const ids = new Set(BOT_PROFILE_CATALOG.map(profile => profile.personalityId))
    expect(ids.size).toBe(BOT_PROFILE_CATALOG.length)
    for (const profile of BOT_PROFILE_CATALOG) {
      expect(['cautious', 'balanced', 'aggressive']).toContain(profile.riskStyle)
      expect(profile.speakingStyle.length).toBeGreaterThan(0)
    }
  })
})

describe('normalizeWerewolfText', () => {
  it('trims ends and collapses whitespace runs', () => {
    expect(normalizeWerewolfText('  a \t b \n c  ')).toBe('a b c')
    expect(normalizeWerewolfText('plain')).toBe('plain')
  })
})

describe('initialWerewolfBotContext', () => {
  it('starts every other roster member as an unknown belief at revision 0', () => {
    const ctx = initialWerewolfBotContext(gameId, p1, BOT_PROFILE_CATALOG[0] as never, P)
    expect(ctx.revision).toBe(0)
    expect(ctx.beliefs.map(belief => belief.playerId)).toEqual([p2, p3])
    expect(ctx.beliefs.every(belief => belief.tendency === 'unknown' && belief.confidence === 'low')).toBe(true)
    expect(ctx.commitments).toEqual([])
    expect(ctx.strategy.priorityTargets).toEqual([])
    expect(ctx.memorySummary.length).toBeGreaterThan(0)
    expect(ctx.lastDecision).toBeUndefined()
  })
})

describe('validateWerewolfBotContextDelta', () => {
  it('accepts each optional section and returns a detached delta', () => {
    const delta = validateWerewolfBotContextDelta({
      beliefUpdates: [{ playerId: p2, tendency: 'wolf', confidence: 'high', basis: 'voted' }],
      addCommitments: [{ text: 'watch s3' }],
      settleCommitments: [],
      strategy: { objective: 'hunt', intendedClaim: 'villager', priorityTargets: [p3] },
      memorySummary: 'day one',
    }, context(), P, limits())
    expect(delta.beliefUpdates).toHaveLength(1)
    expect(delta.strategy?.priorityTargets).toEqual([p3])
    expect(validateWerewolfBotContextDelta({}, context(), P, limits())).toEqual({})
  })

  it('rejects non-object deltas and unknown keys', () => {
    const ctx = context()
    expect(() => validateWerewolfBotContextDelta('x', ctx, P, limits())).toThrow(/must be an object/)
    expect(() => validateWerewolfBotContextDelta({ mood: 'calm' }, ctx, P, limits())).toThrow(/unknown key/)
  })

  it('rejects malformed belief updates', () => {
    const ctx = context()
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: 'x' }, ctx, P, limits())).toThrow(/beliefUpdates/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: ['x'] }, ctx, P, limits())).toThrow(/must be an object/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: p2 }] }, ctx, P, limits())).toThrow(/tendency/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: p2, tendency: 'suspicious', confidence: 'low', basis: 'x' }] }, ctx, P, limits())).toThrow(/tendency/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: p2, tendency: 'wolf', confidence: 'surely', basis: 'x' }] }, ctx, P, limits())).toThrow(/confidence/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: p2, tendency: 'wolf', confidence: 'low', basis: 'x', note: 'y' }] }, ctx, P, limits())).toThrow(/unknown key/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: p2, tendency: 'wolf', confidence: 'low', basis: 'way too long basis' }] }, ctx, P, limits())).toThrow(/beliefBasisChars|characters/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: p1, tendency: 'wolf', confidence: 'low', basis: 'me' }] }, ctx, P, limits())).toThrow(/actor itself/)
    expect(() => validateWerewolfBotContextDelta({ beliefUpdates: [{ playerId: WerewolfPlayerId('stranger'), tendency: 'wolf', confidence: 'low', basis: 'x' }] }, ctx, P, limits())).toThrow(/non-roster/)
    expect(() => validateWerewolfBotContextDelta({
      beliefUpdates: [
        { playerId: p2, tendency: 'wolf', confidence: 'low', basis: 'a' },
        { playerId: p2, tendency: 'wolf', confidence: 'low', basis: 'b' },
      ],
    }, ctx, P, limits())).toThrow(/more than once/)
  })

  it('rejects malformed commitment additions and budget overflows', () => {
    const ctx = context()
    expect(() => validateWerewolfBotContextDelta({ addCommitments: {} }, ctx, P, limits())).toThrow(/addCommitments/)
    expect(() => validateWerewolfBotContextDelta({ addCommitments: [42] }, ctx, P, limits())).toThrow(/must be an object/)
    expect(() => validateWerewolfBotContextDelta({ addCommitments: [{ text: 'ok', extra: 1 }] }, ctx, P, limits())).toThrow(/unknown key/)
    expect(() => validateWerewolfBotContextDelta({ addCommitments: [{ text: '  ' }] }, ctx, P, limits())).toThrow(/must not be empty/)
    expect(() => validateWerewolfBotContextDelta({ addCommitments: [{ text: 'a'.repeat(20) }] }, ctx, P, limits())).toThrow(/characters/)
    expect(() => validateWerewolfBotContextDelta({ addCommitments: [{ text: 'one' }, { text: 'two' }] }, ctx, P, limits())).toThrow(/commitment budget/)
  })

  it('rejects settlement of unknown, settled, or duplicated commitments', () => {
    const ctx = context()
    expect(() => validateWerewolfBotContextDelta({ settleCommitments: 'x' }, ctx, P, limits())).toThrow(/settleCommitments/)
    expect(() => validateWerewolfBotContextDelta({ settleCommitments: [{}] }, ctx, P, limits())).toThrow(/id/)
    expect(() => validateWerewolfBotContextDelta({ settleCommitments: [{ id: 'd1:0', status: 'wobbled' }] }, ctx, P, limits())).toThrow(/fulfilled or abandoned/)
    expect(() => validateWerewolfBotContextDelta({ settleCommitments: [{ id: 'missing', status: 'fulfilled' }] }, ctx, P, limits())).toThrow(/not active/)
    expect(() => validateWerewolfBotContextDelta({
      settleCommitments: [{ id: 'd1:0', status: 'fulfilled' }, { id: 'd1:0', status: 'abandoned' }],
    }, ctx, P, limits())).toThrow(/twice/)
    const settled = applyWerewolfBotContextDelta(ctx, {
      settleCommitments: [{ id: 'd1:0', status: 'fulfilled' }],
    }, { decisionId: 'd2' as never, phaseId: 'p', actionKind: 'a' })
    expect(() => validateWerewolfBotContextDelta({ settleCommitments: [{ id: 'd1:0', status: 'fulfilled' }] }, settled, P, limits())).toThrow(/not active/)
  })

  it('rejects malformed strategies and memory summaries', () => {
    const ctx = context()
    expect(() => validateWerewolfBotContextDelta({ strategy: 'x' }, ctx, P, limits())).toThrow(/strategy/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: 'x', priorityTargets: [], bogus: 1 } }, ctx, P, limits())).toThrow(/unknown key/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: '   ', priorityTargets: [] } }, ctx, P, limits())).toThrow(/must not be empty/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: 'a'.repeat(20), priorityTargets: [] } }, ctx, P, limits())).toThrow(/characters/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: 'o', priorityTargets: 'p2' } }, ctx, P, limits())).toThrow(/priorityTargets/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: 'o', priorityTargets: [WerewolfPlayerId('ghost')] } }, ctx, P, limits())).toThrow(/non-roster/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: 'o', priorityTargets: [p2, p2] } }, ctx, P, limits())).toThrow(/twice/)
    expect(() => validateWerewolfBotContextDelta({ strategy: { objective: 'o', intendedClaim: 'a'.repeat(20), priorityTargets: [] } }, ctx, P, limits())).toThrow(/intendedClaim/)
    expect(() => validateWerewolfBotContextDelta({ memorySummary: 42 }, ctx, P, limits())).toThrow(/memorySummary/)
    expect(() => validateWerewolfBotContextDelta({ memorySummary: 'a'.repeat(20) }, ctx, P, limits())).toThrow(/memorySummary/)
  })
})

describe('applyWerewolfBotContextDelta', () => {
  it('applies a full delta into the next checkpoint', () => {
    const next = applyWerewolfBotContextDelta(context(), {
      beliefUpdates: [{ playerId: p2, tendency: 'wolf', confidence: 'high', basis: 'silent' }],
      addCommitments: [{ text: 'push seat 3' }],
      settleCommitments: [{ id: 'd1:0', status: 'abandoned' }],
      strategy: { objective: 'survive', priorityTargets: [p2] },
      memorySummary: 'day 2 plan',
    }, { decisionId: 'd9' as never, phaseId: 'day.vote', actionKind: 'vote' })
    expect(next.revision).toBe(context().revision + 1)
    expect(next.beliefs.find(belief => belief.playerId === p2)?.tendency).toBe('wolf')
    expect(next.beliefs.find(belief => belief.playerId === p3)?.tendency).toBe('unknown')
    expect(next.commitments).toEqual([
      { id: 'd1:0', text: 'Vote seat 2 tomorrow', status: 'abandoned' },
      { id: 'd9:0', text: 'push seat 3', status: 'active' },
    ])
    expect(next.strategy.objective).toBe('survive')
    expect(next.memorySummary).toBe('day 2 plan')
    expect(next.lastDecision).toEqual({ decisionId: 'd9' as never, phaseId: 'day.vote', actionKind: 'vote' })
  })

  it('keeps prior sections when the delta omits them and detaches inputs', () => {
    const before = context()
    const delta = { memorySummary: 'kept rest' }
    const next = applyWerewolfBotContextDelta(before, delta, { decisionId: 'd3' as never, phaseId: 'p', actionKind: 'a' })
    expect(next.strategy.objective).toBe(before.strategy.objective)
    expect(next.memorySummary).toBe('kept rest')
    expect(next.commitments).toHaveLength(before.commitments.length)
    delta.memorySummary = 'mutated'
    next.beliefs[0]!.basis = 'mutated'
    expect(next.memorySummary).toBe('kept rest')
    expect(before.beliefs[0]!.basis).not.toBe('mutated')
  })
})
