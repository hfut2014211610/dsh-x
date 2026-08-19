/**
 * How the shell answers a runtime fault: restart, and how long to wait first,
 * or stop and hand the user the failure.
 *
 * One blanket retry cannot separate the two faults that matter. A runtime that
 * dies once an hour — a transient port grab, an OOM under load — should come
 * back without the user ever seeing a screen, and the old single-restart
 * budget spent itself on the first one and left the second unattended. A
 * runtime that dies immediately on every launch is a crash loop, and retrying
 * it faster only burns the machine while hiding the log tail that says why.
 *
 * The budget is therefore a rolling window rather than a lifetime count: fault
 * timestamps older than the window are forgotten, so hours of healthy service
 * restore the full budget without anything having to declare recovery. Within
 * the window the backoff grows, because a fault that recurs immediately is the
 * one whose cause needs time to clear.
 * @module @deepseek-ai/dsh-desktop-shell/restart-policy
 */

/** Tunables for one policy. */
export interface RestartPolicyOptions {
  /** Restarts allowed inside the rolling window. */
  budget: number
  /** How long a fault is remembered; older faults free their budget. */
  windowMs: number
  /** Wait before the nth restart of the current streak; the last entry repeats. */
  backoffMs: readonly number[]
}

/** What to do about one fault; reached through {@link RestartPolicy.onFault}. */
interface RestartDecision {
  restart: boolean
  /** How long to wait before restarting; 0 when giving up. */
  delayMs: number
  /** Human-readable reason for the connection log. */
  reason: string
}

/** The shipped policy: three restarts per ten minutes, backing off to a minute. */
export const DEFAULT_RESTART_POLICY: RestartPolicyOptions = {
  budget: 3,
  windowMs: 600_000,
  backoffMs: [0, 5_000, 30_000],
}

/** A live policy; one per shell, reset when the user retries by hand. */
export interface RestartPolicy {
  /** Record a fault and decide what to do about it. */
  onFault: (now: number) => RestartDecision
  /** Forget the recorded faults, restoring the full budget. */
  reset: () => void
}

/**
 * Create one restart policy.
 * @param options - budget, window, and backoff.
 * @returns the policy.
 */
export function createRestartPolicy(options: RestartPolicyOptions = DEFAULT_RESTART_POLICY): RestartPolicy {
  let faults: number[] = []
  return {
    onFault: (now) => {
      faults = [...faults.filter(at => now - at < options.windowMs), now]
      const used = faults.length
      if (used > options.budget) {
        return {
          restart: false,
          delayMs: 0,
          reason: `the runtime faulted ${String(used)} times in ${String(Math.round(options.windowMs / 60_000))} minutes`,
        }
      }
      // backoffMs is indexed by the restart this fault triggers (1-based), and
      // its last entry is the ceiling a longer streak keeps paying.
      const delayMs = options.backoffMs[used - 1] ?? options.backoffMs.at(-1) ?? 0
      return {
        restart: true,
        delayMs,
        reason: `restarting the runtime (attempt ${String(used)} of ${String(options.budget)})`,
      }
    },
    reset: () => { faults = [] },
  }
}
