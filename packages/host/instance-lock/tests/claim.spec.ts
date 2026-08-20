// Whether a second runtime may have this harness home. The interesting cases
// are the two that would make the guard worse than no guard: obeying a claim
// left by a machine that lost power, and refusing to start against ourselves.
import { describe, expect, it } from 'vitest'
import { decideClaim, formatClaim, parseClaim, type InstanceClaim } from '../src/claim.ts'

const HELD: InstanceClaim = { pid: 4242, profile: 'web', startedAt: '2026-08-20T02:00:00.000Z' }
const alive = (): boolean => true
const dead = (): boolean => false

describe('decideClaim', () => {
  it('takes a home nobody has claimed', () => {
    expect(decideClaim(undefined, 1, alive)).toMatchObject({ kind: 'take' })
  })

  it('refuses a home a live runtime holds, and names what holds it', () => {
    const verdict = decideClaim(HELD, 1, alive)

    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.held).toEqual(HELD)
    // The refusal has to be actionable: a person reading it needs to know
    // which process to stop.
    expect(verdict.reason).toContain('4242')
    expect(verdict.reason).toContain('web')
  })

  // A claim outlives the machine that wrote it. Obeying one left by a power
  // cut would mean the harness never starts again — worse than the collision.
  it('takes over a claim whose process is gone', () => {
    const verdict = decideClaim(HELD, 1, dead)

    expect(verdict.kind).toBe('take')
    expect(verdict.reason).toContain('no longer running')
  })

  // A reload re-runs apply in the same process. Refusing to start against our
  // own claim would make the guard fire on every reload.
  it('takes a claim this very process already wrote', () => {
    expect(decideClaim(HELD, HELD.pid, alive)).toMatchObject({ kind: 'take' })
  })
})

describe('the claim file', () => {
  it('round-trips', () => {
    expect(parseClaim(formatClaim(HELD))).toEqual(HELD)
  })

  // Refusing to start over a damaged note would be the guard causing exactly
  // the outage it exists to prevent.
  it('reads anything that is not a claim as no claim', () => {
    expect(parseClaim(undefined)).toBeUndefined()
    expect(parseClaim('{ not json')).toBeUndefined()
    expect(parseClaim('[]')).toBeUndefined()
    expect(parseClaim('null')).toBeUndefined()
    expect(parseClaim(JSON.stringify({ pid: 'x', profile: 'web', startedAt: 'now' }))).toBeUndefined()
    expect(parseClaim(JSON.stringify({ pid: 0, profile: 'web', startedAt: 'now' }))).toBeUndefined()
    expect(parseClaim(JSON.stringify({ pid: 7 }))).toBeUndefined()
  })

  it('writes a file a person can read', () => {
    const text = formatClaim(HELD)

    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "profile": "web"')
  })
})
