// The decision behind bringing a failed plugin back. What matters is not the
// happy restart — it is the two ways a supervisor makes things worse: never
// giving up, and giving up on something that had already recovered.
import { describe, expect, it } from 'vitest'
import { createSupervisor, DEFAULT_SUPERVISOR } from '../src/supervisor.ts'

const ENTRY = 'feishu'

describe('createSupervisor', () => {
  it('restarts the first fault immediately and backs off after that', () => {
    const supervisor = createSupervisor({ budget: 3, windowMs: 600_000, backoffMs: [0, 5_000, 60_000] })

    expect(supervisor.onDown(ENTRY, 0)).toMatchObject({ restart: true, delayMs: 0 })
    expect(supervisor.onDown(ENTRY, 1_000)).toMatchObject({ restart: true, delayMs: 5_000 })
    expect(supervisor.onDown(ENTRY, 2_000)).toMatchObject({ restart: true, delayMs: 60_000 })
  })

  // A plugin that throws on activation throws every time. An unbounded
  // supervisor is an infinite loop with a log.
  it('stops once the budget is spent, and says so', () => {
    const supervisor = createSupervisor({ budget: 2, windowMs: 600_000, backoffMs: [0] })
    supervisor.onDown(ENTRY, 0)
    supervisor.onDown(ENTRY, 1_000)

    const decision = supervisor.onDown(ENTRY, 2_000)

    expect(decision.restart).toBe(false)
    expect(decision.reason).toContain('leaving it off')
  })

  // Two faults an hour apart is not a crash loop, and treating it as one would
  // leave a plugin down over a fault it already recovered from.
  it('frees budget once the restarts fall out of the window', () => {
    const supervisor = createSupervisor({ budget: 2, windowMs: 10_000, backoffMs: [0] })
    supervisor.onDown(ENTRY, 0)
    supervisor.onDown(ENTRY, 1_000)
    expect(supervisor.onDown(ENTRY, 2_000).restart).toBe(false)

    expect(supervisor.onDown(ENTRY, 20_000).restart).toBe(true)
  })

  it('counts each entry on its own', () => {
    const supervisor = createSupervisor({ budget: 1, windowMs: 600_000, backoffMs: [0] })
    supervisor.onDown('a', 0)

    expect(supervisor.onDown('a', 1_000).restart).toBe(false)
    expect(supervisor.onDown('b', 1_000).restart).toBe(true)
  })

  // Running again means the streak is over: the next fault gets the whole
  // budget, not the remainder of one the plugin already came back from.
  it('forgets an entry that recovered', () => {
    const supervisor = createSupervisor({ budget: 1, windowMs: 600_000, backoffMs: [0] })
    supervisor.onDown(ENTRY, 0)
    expect(supervisor.onDown(ENTRY, 1_000).restart).toBe(false)

    supervisor.forget(ENTRY)

    expect(supervisor.onDown(ENTRY, 2_000).restart).toBe(true)
  })

  it('repeats the last backoff rather than running off the end of the table', () => {
    const supervisor = createSupervisor({ budget: 4, windowMs: 600_000, backoffMs: [0, 1_000] })
    supervisor.onDown(ENTRY, 0)
    supervisor.onDown(ENTRY, 1)

    expect(supervisor.onDown(ENTRY, 2).delayMs).toBe(1_000)
    expect(supervisor.onDown(ENTRY, 3).delayMs).toBe(1_000)
  })

  it('ships the same numbers the desktop runtime policy uses', () => {
    expect(DEFAULT_SUPERVISOR).toEqual({ budget: 3, windowMs: 600_000, backoffMs: [0, 5_000, 60_000] })
  })
})
