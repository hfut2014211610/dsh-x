import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'

/**
 * What one enable/disable attempt did.
 *
 * `found: false` is not an error: the caller acts on a snapshot it read some
 * moments ago, and an entry removed in between is a race the page can simply
 * re-read past.
 *
 * Neither is a plugin that refuses to start. Switching one on runs its apply,
 * and a channel whose bridge is unreachable throws from there — which is a
 * fact about the plugin, not a fault in the request. The Loader leaves such an
 * entry disabled, so `enabled` reports what the tree holds now and `failure`
 * carries the reason a supervisor or a settings page can show.
 */
export interface PluginControlOutcome {
  readonly found: boolean
  /** The state the entry is in now — not necessarily the one requested. */
  readonly enabled: boolean
  /** Why the entry did not reach the requested state, when it did not. */
  readonly failure?: string
}

/** One enable/disable request. */
export interface PluginControlRequest {
  readonly entryId: PluginEntryId
  readonly enabled: boolean
}
