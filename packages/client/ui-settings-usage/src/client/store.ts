/**
 * Usage settings page store: one snapshot joining the session list with each
 * row's `usageStats` projection value into the panel's view model. The host
 * stays the single fact source — the panel only reads, refreshing on open,
 * on connection reset, and on demand.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge and the session namespace face,
// plus the wire session-list row type.
import type { SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the sessionTitle and usageStats projection-key merges
// into the wire rows' `values` face.
import type {} from '@deepseek-ai/dsh-session-title/client'
import type {} from '@deepseek-ai/dsh-usage-stats/client'
import type { UsageOverview, UsageSessionInput } from './view-model.ts'
import { usageOverviewOf } from './view-model.ts'
import type { UsageRange } from './view-model.ts'

/** Panel snapshot. */
export interface UsageSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** The active statistics window. */
  range: UsageRange
  /** The aggregated view model; empty until the first ready load. */
  overview: UsageOverview
}

/** The session-list row narrowed to the fields the panel reads. */
type SessionListWireItem = SessionSummary

const emptyOverview = (range: UsageRange): UsageOverview =>
  usageOverviewOf([], Date.now(), range)

/**
 * Narrow one wire row to the panel's input: the title rides the row's
 * `title` projection value, and the usage value comes from the row's
 * usage projection block (absent carries as null).
 * @param item - one `session.list` row.
 * @returns the aggregation input.
 */
function usageInputOf(item: SessionListWireItem): UsageSessionInput {
  return {
    sessionId: item.sessionId,
    title: item.projections?.values.title ?? undefined,
    updatedAt: item.updatedAt,
    usage: item.projections?.values.usageStats ?? null,
  }
}

/** The usage settings page controller (one per settings surface). */
export class UsageSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<UsageSettingsState> = createSnapshotStore<UsageSettingsState>({
    status: 'idle', error: null, range: 28, overview: emptyOverview(28),
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /** The last good wire rows; a range switch re-aggregates these offline. */
  private inputs: readonly UsageSessionInput[] = []

  /**
   * @param ctx - the page plugin's context, whose `remote.session` namespace
   * carries the session-list read.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Refresh the whole panel snapshot from one session-list page. A failure
   * keeps the last good overview and surfaces the error.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const response = await this.ctx.remote.session.list({})
      if (!response.ok) throw new Error(response.error.message)
      this.inputs = response.value.items.map(usageInputOf)
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.overview = usageOverviewOf(this.inputs, Date.now(), s.range)
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Switch the statistics window and re-aggregate the last good rows offline —
   * no wire traffic, no status change.
   * @param range - the window to aggregate over.
   */
  setRange(range: UsageRange): void {
    this.store.update((s) => {
      s.range = range
      s.overview = usageOverviewOf(this.inputs, Date.now(), range)
    })
  }
}
