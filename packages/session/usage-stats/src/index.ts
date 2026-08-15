/**
 * Function plugin registering the `usageStats` projection unit: per-request
 * model token usage — provider-reported buckets, the dispatched provider and
 * model, and the model wall time — folded from the durable session log and
 * served through the session-projection seam (registry snapshot, change feed,
 * and every projection carrier: history tail pages, `session/projection` push
 * frames, session list rows). The browser usage panel (dsh-client-ui-settings-usage)
 * renders the session-list rows; other carriers reach it unchanged. The
 * plugin owns only the fold; delivery is the seam's.
 *
 * @module @deepseek-ai/dsh-usage-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import { usageStatsProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'usage-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `usageStats` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(usageStatsProjectionDefinition)
}
