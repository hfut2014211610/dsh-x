/**
 * The write half of the plugin surface: turning a configured plugin on and off
 * from a trusted client.
 *
 * `dsh-host-plugin-inventory` projects what the Loader currently holds, and it
 * is read-only by design — a snapshot needs no authority over the tree. But a
 * settings page that can only report state leaves every actual change on the
 * command line, which is where the connectors page ended up: it could say a
 * channel was not installed and then hand the reader a command to type.
 *
 * This service is separate rather than an extra method on the inventory for two
 * reasons. The inventory is an upstream package and this fork keeps its edits
 * to upstream files down to what cannot live anywhere else. And the split is
 * the honest one anyway: reading the tree and rewriting it are different
 * authorities, and a deployment that wants the first without the second can
 * mount one and not the other.
 * @module @deepseek-ai/dsh-host-plugin-control
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { PluginControlOutcome } from './types.ts'
export type * from './types.ts'

/** Remote service that turns configured plugin entries on and off. */
export class PluginControlGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginControl')
  }

  /**
   * Enable or disable one configured entry.
   *
   * The Loader owns both the running tree and the profile it was read from, so
   * one `update` is the whole operation: the fiber starts or stops and the
   * change is written back, which is what makes it survive a restart. Anything
   * this service kept alongside that would be a second truth to synchronize.
   *
   * An id the tree does not hold reports that rather than throwing. The caller
   * is a settings page acting on a snapshot it read some moments ago, and an
   * entry removed in between is an ordinary race, not a fault.
   * @param request - the entry to act on and the state to put it in.
   * @returns whether the entry was found, and the state it is in now.
   */
  @Remote('setEnabled')
  async setEnabled(request: { entryId: PluginEntryId; enabled: boolean }): Promise<PluginControlOutcome> {
    const entry = [...this.ctx.loader.entries()].find(candidate => candidate.id === request.entryId)
    if (entry === undefined) return { found: false, enabled: false }
    // `disabled` is the Loader's own field, and its absence means enabled;
    // writing the negation keeps that vocabulary rather than inventing one.
    await this.ctx.loader.update(entry.id, { ...entry.options, disabled: !request.enabled })
    return { found: true, enabled: request.enabled }
  }
}

export default PluginControlGateway
