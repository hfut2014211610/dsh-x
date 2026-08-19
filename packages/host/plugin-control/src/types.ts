import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'

/**
 * What one enable/disable attempt did.
 *
 * `found: false` is not an error: the caller acts on a snapshot it read some
 * moments ago, and an entry removed in between is a race the page can simply
 * re-read past.
 */
export interface PluginControlOutcome {
  readonly found: boolean
  /** The entry's requested state, or false when there was no entry. */
  readonly enabled: boolean
}

/** One enable/disable request. */
export interface PluginControlRequest {
  readonly entryId: PluginEntryId
  readonly enabled: boolean
}
