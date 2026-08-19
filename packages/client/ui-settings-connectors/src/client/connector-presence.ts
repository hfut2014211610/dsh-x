/**
 * Whether a connector's plugin is in this profile, and whether it is running.
 *
 * The settings scope cannot answer that. A namespace is served only while its
 * plugin is loaded, so a channel that is merely switched off looks exactly like
 * one that was never installed — which is why the card used to answer both with
 * the same "not in this deployment" line and a command to type. The plugin tree
 * is where the difference lives, so that is what this reads.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'

/** Loader-tree identity of one entry, as the inventory spells it. */
type PluginEntryId = PluginInventorySnapshot['entries'][number]['entryId']

/** Where a connector's plugin stands in the profile. */
export type ConnectorPresence =
  /** The tree has not been read yet. */
  | 'unknown'
  /** No entry in this profile imports the channel's module. */
  | 'missing'
  /** Configured, switched off. */
  | 'disabled'
  /** Configured and running. */
  | 'enabled'

/** The presence half of a connector card's state. */
export interface ConnectorPresenceState {
  presence: ConnectorPresence
  /** A switch is in flight; the control locks rather than queueing gestures. */
  busy: boolean
  /** The last read or switch failed. */
  failed: boolean
}

/** The plugin-tree calls a connector card needs. */
export interface ConnectorPluginFace {
  /** Read the configured plugin entries. */
  list: () => Promise<PluginInventorySnapshot>
  /** Switch one entry on or off, and report whether the entry was still there. */
  setEnabled: (entryId: PluginEntryId, enabled: boolean) => Promise<{ found: boolean }>
}

/**
 * Tracks one connector's plugin entry and switches it.
 *
 * Every outcome is re-read from the tree rather than assumed from the request:
 * a switch that reports success can still land on an entry a concurrent profile
 * edit has moved, and the card must show what is, not what was asked for.
 */
export class ConnectorPresenceController {
  /** uSES-safe state source the card reads through its bound selector. */
  readonly store: SnapshotStore<ConnectorPresenceState> = createSnapshotStore<ConnectorPresenceState>({
    presence: 'unknown', busy: false, failed: false,
  })

  private entryId: PluginEntryId | undefined
  private generation = 0

  /**
   * @param moduleName - the module specifier the channel's Loader entry imports.
   * @param plugins - the plugin-tree calls, injected so a card can be rendered
   * without a host.
   */
  constructor(
    private readonly moduleName: string,
    private readonly plugins: ConnectorPluginFace,
  ) {}

  /**
   * Re-read the plugin tree.
   * @returns after the latest read settles; an earlier read in flight is dropped.
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    try {
      const snapshot = await this.plugins.list()
      if (generation !== this.generation) return
      const entry = snapshot.entries.find(candidate => candidate.moduleName === this.moduleName)
      this.entryId = entry?.entryId
      this.store.update((state) => {
        state.presence = entry === undefined ? 'missing' : entry.enabled ? 'enabled' : 'disabled'
        state.failed = false
      })
    } catch {
      if (generation !== this.generation) return
      // An unreadable tree is not an absent plugin: saying "not installed"
      // because a call failed would hand the reader a command they do not need.
      this.store.update((state) => {
        state.presence = 'unknown'
        state.failed = true
      })
    }
  }

  /**
   * Switch the channel's plugin on or off.
   * @param enabled - the state to put the entry in.
   * @returns after the switch and the re-read that confirms it.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    const entryId = this.entryId
    if (entryId === undefined || this.store.getSnapshot().busy) return
    this.store.update((state) => {
      state.busy = true
      state.failed = false
    })
    let failed = false
    try {
      await this.plugins.setEnabled(entryId, enabled)
    } catch {
      failed = true
    }
    this.store.update((state) => { state.busy = false })
    // The re-read runs either way: a failed switch may still have taken, and a
    // successful one is only believed once the tree says so.
    await this.refresh()
    if (failed) this.store.update((state) => { state.failed = true })
  }
}
