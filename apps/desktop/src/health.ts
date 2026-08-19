/**
 * The liveness watch over a connected runtime.
 *
 * Process exit is the fault the shell already sees, and it is the easier one.
 * A runtime that stops answering without exiting — an event loop wedged on a
 * native call, a hung sqlite write, a socket that accepts and never replies —
 * leaves the window showing a UI whose every request now hangs, and nothing in
 * the exit path ever fires. From the user's side that is indistinguishable
 * from the app being broken, so the shell has to ask.
 *
 * It asks with the same `host.describe` handshake that admitted the runtime in
 * the first place, so a pass means the RPC surface is actually answering
 * rather than merely that a socket accepted. A single miss is not a fault:
 * a laptop resuming from sleep, a GC pause, or a machine under load will drop
 * one. Only a run of consecutive misses is reported, and any pass clears the
 * run — the watch reports a runtime that stopped answering, never one that
 * answered slowly.
 * @module @deepseek-ai/dsh-desktop-shell/health
 */

/** Environment collaborators; every one is a seam the tests replace. */
export interface HealthDeps {
  /** One handshake attempt: true when the runtime answered. */
  probe: () => Promise<boolean>
  /** Schedules the next probe; returns a handle {@link HealthDeps.clearTimer} accepts. */
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/** Tunables for one watch. */
export interface HealthOptions {
  /** Gap between probes. */
  intervalMs: number
  /** Consecutive misses that make a fault. */
  missesBeforeFault: number
}

/** The shipped watch: a probe every fifteen seconds, three misses to fault. */
export const DEFAULT_HEALTH_OPTIONS: HealthOptions = {
  intervalMs: 15_000,
  missesBeforeFault: 3,
}

/**
 * Watch one connected runtime until the returned function stops it.
 *
 * `onFault` fires at most once per watch: the first fault is what triggers the
 * reconnect, and the watch stops itself before reporting so a slow reconnect
 * cannot be interrupted by the probe that outlived it.
 * @param deps - environment collaborators.
 * @param options - interval and miss tolerance.
 * @param onFault - receives a reason line once the misses run out.
 * @returns the stop function; safe to call more than once.
 */
export function startHealthWatch(
  deps: HealthDeps,
  options: HealthOptions,
  onFault: (reason: string) => void,
): () => void {
  let misses = 0
  let stopped = false
  let handle: unknown
  // Read through a call, not directly: `stopped` is set by a caller that runs
  // while a probe is in flight, and control-flow narrowing assumes exactly
  // that cannot happen — it would read the second check below as dead.
  const isStopped = (): boolean => stopped

  const stop = (): void => {
    if (isStopped()) return
    stopped = true
    if (handle !== undefined) deps.clearTimer(handle)
  }

  const schedule = (): void => {
    if (isStopped()) return
    handle = deps.setTimer(() => { void tick() }, options.intervalMs)
  }

  const tick = async (): Promise<void> => {
    if (isStopped()) return
    const answered = await deps.probe()
    // The watch may have been stopped while the probe was in flight — a quit,
    // or a reconnect that already replaced this runtime. Its answer is then
    // about a runtime nobody is watching any more.
    if (isStopped()) return
    if (answered) {
      misses = 0
      schedule()
      return
    }
    misses += 1
    if (misses < options.missesBeforeFault) {
      schedule()
      return
    }
    stop()
    onFault(`the runtime stopped answering (${String(misses)} consecutive health probes missed)`)
  }

  schedule()
  return stop
}
