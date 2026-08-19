// The watch that catches a runtime which stopped answering without exiting.
// The timer is a seam, so these run the schedule by hand rather than waiting.
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_HEALTH_OPTIONS, startHealthWatch, type HealthDeps } from '../src/health.ts'

const OPTIONS = { intervalMs: 1_000, missesBeforeFault: 3 }

/** A timer seam that runs the pending callback on demand instead of on a clock. */
function manualTimer(
  probe: HealthDeps['probe'] = async () => true,
): HealthDeps & { run: () => Promise<void>; pending: () => boolean; cleared: () => number } {
  let queued: (() => void) | undefined
  let clears = 0
  return {
    probe,
    setTimer: (fn) => { queued = fn; return Symbol('timer') },
    clearTimer: () => { clears += 1; queued = undefined },
    run: async () => {
      const fn = queued
      queued = undefined
      fn?.()
      // The tick awaits the probe; let those microtasks settle.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
    pending: () => queued !== undefined,
    cleared: () => clears,
  }
}

describe('startHealthWatch', () => {
  it('keeps probing and never faults while the runtime answers', async () => {
    const timer = manualTimer()
    const onFault = vi.fn()
    startHealthWatch(timer, OPTIONS, onFault)

    for (let probe = 0; probe < 10; probe += 1) await timer.run()

    expect(onFault).not.toHaveBeenCalled()
    expect(timer.pending()).toBe(true)
  })

  // A laptop resuming from sleep or a machine under load drops one probe. That
  // is not a fault, and reporting it would restart a healthy runtime.
  it('tolerates misses below the threshold and forgets them once one answers', async () => {
    const answers = [false, false, true, false, false]
    let index = 0
    const watch = manualTimer(async () => answers[index++] ?? true)
    const onFault = vi.fn()
    startHealthWatch(watch, OPTIONS, onFault)

    for (let probe = 0; probe < answers.length; probe += 1) await watch.run()

    expect(onFault).not.toHaveBeenCalled()
  })

  it('faults once the misses run out and says how many were missed', async () => {
    const watch = manualTimer(async () => false)
    const onFault = vi.fn()
    startHealthWatch(watch, OPTIONS, onFault)

    await watch.run()
    await watch.run()
    expect(onFault).not.toHaveBeenCalled()
    await watch.run()

    expect(onFault).toHaveBeenCalledTimes(1)
    expect(onFault.mock.calls[0]?.[0]).toContain('3 consecutive')
  })

  // The fault triggers a reconnect, and a watch that kept probing through it
  // would fault again against a runtime that is already being replaced.
  it('stops itself before reporting, so one watch faults at most once', async () => {
    const watch = manualTimer(async () => false)
    const onFault = vi.fn()
    startHealthWatch(watch, OPTIONS, onFault)

    for (let probe = 0; probe < 6; probe += 1) await watch.run()

    expect(onFault).toHaveBeenCalledTimes(1)
    expect(watch.pending()).toBe(false)
  })

  // A probe in flight when the watch stops is answering about a runtime nobody
  // is watching any more — a quit, or a reconnect that already replaced it.
  it('reports nothing when a probe settles after the watch was stopped', async () => {
    let release: ((answered: boolean) => void) | undefined
    const watch = manualTimer(() => new Promise<boolean>((resolve) => { release = resolve }))
    const onFault = vi.fn()
    const stop = startHealthWatch(watch, { intervalMs: 1_000, missesBeforeFault: 1 }, onFault)

    await watch.run()
    stop()
    release?.(false)
    await Promise.resolve()
    await Promise.resolve()

    expect(onFault).not.toHaveBeenCalled()
  })

  it('clears the pending timer once, however often stop is called', () => {
    const watch = manualTimer()
    const stop = startHealthWatch(watch, OPTIONS, vi.fn())

    stop()
    stop()
    stop()

    expect(watch.cleared()).toBe(1)
  })

  it('ships an interval and a miss tolerance that survive one dropped probe', () => {
    expect(DEFAULT_HEALTH_OPTIONS.missesBeforeFault).toBeGreaterThan(1)
    expect(DEFAULT_HEALTH_OPTIONS.intervalMs).toBeGreaterThan(0)
  })
})
