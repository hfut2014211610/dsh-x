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
import type { FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { PluginControlOutcome } from './types.ts'
import { createSupervisor, DEFAULT_SUPERVISOR, type Supervisor } from './supervisor.ts'
export type * from './types.ts'
export {
  createSupervisor, DEFAULT_SUPERVISOR,
  type RestartDecision, type Supervisor, type SupervisorOptions,
} from './supervisor.ts'

/**
 * Runtime mirror of the one FiberState this package reads.
 *
 * FiberState is a cross-package const enum: importing it as a value inlines a
 * number at compile time and leaves nothing for a bundler to resolve. The
 * inventory package mirrors it the same way for the same reason.
 */
const FIBER_FAILED = 3 as FiberState.FAILED

/** How often the supervisor looks for an entry that is on but not running. */
const DEFAULT_SCAN_MS = 15_000

/** Plugin config: whether to supervise, and how often to look. */
export interface Config {
  /**
   * Bring a switched-on entry back when its fiber has failed.
   *
   * On by default. A channel whose plugin faulted stops answering with no
   * outward sign, and the previous answer was for a person to notice that
   * messages had stopped and go toggle it.
   */
  supervise?: boolean
  /** Seconds between scans; the fault is not urgent, only unattended. */
  scanIntervalMs?: number
}

/** Remote service that turns configured plugin entries on and off. */
export class PluginControlGateway extends TypertRemoteService {
  static inject = ['loader']

  private readonly supervisor: Supervisor = createSupervisor(DEFAULT_SUPERVISOR)
  /** Entries with a restart already scheduled, so one scan does not stack another. */
  private readonly pending = new Set<string>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginControl')
    if (config.supervise === false) return
    const every = config.scanIntervalMs ?? DEFAULT_SCAN_MS
    const timer = setInterval(() => { this.sweep() }, every)
    // The Node timer would hold the process open on its own; a supervisor is
    // not a reason for dsh to keep running.
    timer.unref()
    ctx.effect(() => () => { clearInterval(timer) })
  }

  /**
   * Look for entries that are switched on and not running, and act on them.
   *
   * A person who switches an entry off is not someone the supervisor argues
   * with, which is why only `enabled` entries are candidates: the enablement
   * is the intent, and the failed fiber is the deviation from it.
   */
  private sweep(): void {
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      const id = entry.id
      if (entry.options.disabled === true || entry.fiber?.state !== FIBER_FAILED) {
        // Running again, or switched off on purpose. Either way its streak is
        // over — a fault next week should get the full budget, not the
        // remainder of one it recovered from.
        this.supervisor.forget(id)
        this.pending.delete(id)
        continue
      }
      if (this.pending.has(id)) continue
      const decision = this.supervisor.onDown(id, Date.now())
      this.ctx.logger.info(`plugin-control: ${entry.options.name} is enabled but failed — ${decision.reason}`)
      if (!decision.restart) continue
      this.pending.add(id)
      const restart = (): void => {
        this.pending.delete(id)
        void this.restart(entry.id as PluginEntryId)
      }
      if (decision.delayMs === 0) restart()
      else setTimeout(restart, decision.delayMs).unref()
    }
  }

  /**
   * The off-and-on a person would have done by hand.
   *
   * Off first: the Loader only re-runs a plugin's apply on the transition into
   * enabled, so writing `enabled` over an entry that already reads as enabled
   * changes nothing at all.
   * @param entryId - the entry to bring back.
   */
  private async restart(entryId: PluginEntryId): Promise<void> {
    await this.setEnabled({ entryId, enabled: false })
    const outcome = await this.setEnabled({ entryId, enabled: true })
    if (outcome.failure !== undefined) {
      this.ctx.logger.info(`plugin-control: ${String(entryId)} did not come back — ${outcome.failure}`)
    }
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
    try {
      // `disabled` is the Loader's own field, and its absence means enabled;
      // writing the negation keeps that vocabulary rather than inventing one.
      await this.ctx.loader.update(entry.id, { ...entry.options, disabled: !request.enabled })
    } catch (error: unknown) {
      // Switching an entry on runs its apply, and a plugin that cannot reach
      // what it needs throws from there. That is an answer, not a broken
      // request: the Loader leaves the entry disabled, so report the state it
      // is actually in and why, rather than failing the call and leaving the
      // caller to guess whether anything happened.
      return {
        found: true,
        enabled: this.isEnabled(request.entryId),
        failure: error instanceof Error ? error.message : String(error),
      }
    }
    return { found: true, enabled: request.enabled }
  }

  /**
   * Whether the tree currently holds that entry as enabled.
   * @param entryId - the entry to read.
   * @returns its enablement now; false once the entry is gone.
   */
  private isEnabled(entryId: PluginEntryId): boolean {
    const entry = [...this.ctx.loader.entries()].find(candidate => candidate.id === entryId)
    return entry !== undefined && entry.options.disabled !== true
  }
}

export default PluginControlGateway
