// The policy that separates a transient fault from a crash loop. Time is a
// parameter here, which is the whole point: the window is what lets hours of
// healthy service restore the budget without anything declaring recovery.
import { describe, expect, it } from 'vitest'
import { createRestartPolicy, DEFAULT_RESTART_POLICY } from '../src/restart-policy.ts'

const OPTIONS = { budget: 3, windowMs: 600_000, backoffMs: [0, 5_000, 30_000] }

describe('createRestartPolicy', () => {
  it('restarts immediately on the first fault and backs off as the streak grows', () => {
    const policy = createRestartPolicy(OPTIONS)

    expect(policy.onFault(0)).toMatchObject({ restart: true, delayMs: 0 })
    expect(policy.onFault(1_000)).toMatchObject({ restart: true, delayMs: 5_000 })
    expect(policy.onFault(2_000)).toMatchObject({ restart: true, delayMs: 30_000 })
  })

  it('stops once the budget is spent and says how tight the loop was', () => {
    const policy = createRestartPolicy(OPTIONS)
    policy.onFault(0)
    policy.onFault(1_000)
    policy.onFault(2_000)

    const decision = policy.onFault(3_000)
    expect(decision.restart).toBe(false)
    expect(decision.delayMs).toBe(0)
    expect(decision.reason).toContain('4 times in 10 minutes')
  })

  // A runtime that dies once an hour is not a crash loop, and the user should
  // never see a screen for it. Faults older than the window are forgotten, so
  // the budget is restored by time passing rather than by a recovery signal
  // nothing is in a position to send.
  it('forgets faults older than the window, so a rare fault always restarts', () => {
    const policy = createRestartPolicy(OPTIONS)
    for (let fault = 0; fault < 10; fault += 1) {
      const decision = policy.onFault(fault * 3_600_000)
      expect(decision.restart).toBe(true)
      expect(decision.delayMs).toBe(0)
    }
  })

  // Partial expiry: two faults still inside the window keep their cost, so the
  // third one pays the third backoff rather than starting over.
  it('charges only the faults still inside the window', () => {
    const policy = createRestartPolicy(OPTIONS)
    policy.onFault(0)
    policy.onFault(500_000)
    policy.onFault(550_000)

    // The first has aged out by now; the other two have not.
    expect(policy.onFault(700_000)).toMatchObject({ restart: true, delayMs: 30_000 })
  })

  it('restores the full budget when the user retries by hand', () => {
    const policy = createRestartPolicy(OPTIONS)
    policy.onFault(0)
    policy.onFault(1_000)
    policy.onFault(2_000)
    expect(policy.onFault(3_000).restart).toBe(false)

    policy.reset()
    expect(policy.onFault(4_000)).toMatchObject({ restart: true, delayMs: 0 })
  })

  // A streak longer than the backoff table must keep paying its last entry
  // rather than falling back to no wait at all.
  it('holds the last backoff for a streak longer than the table', () => {
    const policy = createRestartPolicy({ budget: 5, windowMs: 600_000, backoffMs: [0, 5_000] })
    policy.onFault(0)
    policy.onFault(1)
    expect(policy.onFault(2)).toMatchObject({ restart: true, delayMs: 5_000 })
    expect(policy.onFault(3)).toMatchObject({ restart: true, delayMs: 5_000 })
  })

  it('ships a policy that restarts more than once', () => {
    expect(DEFAULT_RESTART_POLICY.budget).toBeGreaterThan(1)
    expect(DEFAULT_RESTART_POLICY.backoffMs[0]).toBe(0)
  })
})
