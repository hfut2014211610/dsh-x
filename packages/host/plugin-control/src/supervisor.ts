/**
 * When a plugin whose entry is still switched on stops running, and what to do
 * about it.
 *
 * A plugin that faults leaves its entry enabled and its fiber failed, and
 * nothing brings it back. Until now the only way back was for a person to
 * notice — which for a channel means noticing that messages stopped arriving —
 * and toggle the entry off and on. That toggle is exactly what this does, on
 * the reader's behalf.
 *
 * Restarting is not free of risk: a plugin that throws on activation throws
 * every time, so an unbounded supervisor is an infinite loop with a log. The
 * decision below is therefore a budget in a rolling window with a backoff, the
 * same shape the desktop shell uses for its runtime — and once the budget is
 * spent the entry stays down, which is the honest outcome. Something that
 * cannot start is not something to keep starting.
 *
 * Pure: it holds no timer and touches no Loader. The caller supplies the clock
 * and performs the restart, which is what makes the policy testable without
 * either.
 * @module @deepseek-ai/dsh-host-plugin-control/supervisor
 */

/** Tunables for one supervisor. */
export interface SupervisorOptions {
  /** Restarts allowed per entry inside the rolling window. */
  budget: number
  /** How long a restart is remembered; older ones free their budget. */
  windowMs: number
  /** Wait before the nth restart of the current streak; the last entry repeats. */
  backoffMs: readonly number[]
}

/**
 * The shipped policy: three restarts per ten minutes, backing off to a minute.
 *
 * Deliberately the same numbers as the desktop shell's runtime policy. A
 * plugin and a runtime fail the same way — transiently, or not at all — and
 * two different answers to the same question would be two things to explain.
 */
export const DEFAULT_SUPERVISOR: SupervisorOptions = {
  budget: 3,
  windowMs: 600_000,
  backoffMs: [0, 5_000, 60_000],
}

/** What to do about one entry found down. */
export interface RestartDecision {
  restart: boolean
  /** How long to wait before restarting; 0 when restarting now or giving up. */
  delayMs: number
  /** Why, for the log. */
  reason: string
}

/** A live supervisor; one per gateway. */
export interface Supervisor {
  /** Record that an entry was found down, and decide what to do. */
  onDown: (entryId: string, now: number) => RestartDecision
  /** Forget an entry's history — it is running again, or a person took over. */
  forget: (entryId: string) => void
}

/**
 * Create one supervisor.
 * @param options - budget, window, and backoff.
 * @returns the supervisor.
 */
export function createSupervisor(options: SupervisorOptions = DEFAULT_SUPERVISOR): Supervisor {
  const history = new Map<string, number[]>()
  return {
    onDown: (entryId, now) => {
      // Only restarts inside the window count. An entry that failed twice an
      // hour ago and once now is not in a crash loop, and treating it as one
      // would leave it down for a fault it already recovered from.
      const recent = (history.get(entryId) ?? []).filter(at => now - at < options.windowMs)
      if (recent.length >= options.budget) {
        history.set(entryId, recent)
        return {
          restart: false,
          delayMs: 0,
          reason: `restarted ${String(recent.length)} times in the last ${String(Math.round(options.windowMs / 60_000))} minutes; leaving it off`,
        }
      }
      recent.push(now)
      history.set(entryId, recent)
      const delayMs = options.backoffMs[Math.min(recent.length - 1, options.backoffMs.length - 1)] ?? 0
      return {
        restart: true,
        delayMs,
        reason: delayMs === 0
          ? 'restarting it'
          : `restarting it in ${String(Math.round(delayMs / 1000))}s (attempt ${String(recent.length)})`,
      }
    },
    forget: (entryId) => { history.delete(entryId) },
  }
}
