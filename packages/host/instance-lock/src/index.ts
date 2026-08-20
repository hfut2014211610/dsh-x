/**
 * One runtime per harness home.
 *
 * Everything a runtime owns under `$DSH_HOME` is written as though it is the
 * only one: the settings document takes a writer lock per write, but the
 * session directory has a single sequence per log and no lock at all. Two
 * runtimes there do not fight over a file — they interleave numbering, which
 * is how an 18,000-event conversation once became unreadable.
 *
 * The guard is deliberately the blunt one. Making session ownership visible
 * across processes is the thorough answer and a much larger one; refusing to
 * start a second runtime against a home that already has one removes the
 * situation instead of managing it. A one-shot command that never boots this
 * row — `dsh plugin`, `dsh --dump-config` — is unaffected, because it is not
 * a runtime and writes no sessions.
 *
 * Refusing means `ctx.appExit`, the launcher's bounded exit, not a thrown
 * apply: a plugin that throws leaves its entry failed and lets the rest of the
 * tree come up, which is the one outcome a guard must not have.
 * @module @deepseek-ai/dsh-host-instance-lock
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-cmdline'
import { decideClaim, formatClaim, parseClaim, type InstanceClaim } from './claim.ts'

export * from './claim.ts'

/** Cordis plugin name. */
export const name = 'host-instance-lock'

/** Plugin config: which home to guard, under what name, and whether to guard at all. */
export interface Config {
  /** Harness home; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** The profile name a refusal reports, so the message names something real. */
  profile?: string
  /**
   * Refuse to start when another live runtime holds the home.
   *
   * On by default. Off is for a deployment that genuinely wants two runtimes
   * on one home and accepts what that does to a shared session log.
   */
  enforce?: boolean
}

/** The file one runtime writes to say it has this home. */
export const CLAIM_FILE = 'instance.json'

/**
 * Claim the harness home for this runtime, or refuse to run.
 * @param ctx - the host context; `appExit` is the launcher's bounded exit.
 * @param config - home, profile name, and whether to enforce.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enforce === false) return
  const path = join(resolveDshHome(config.dshHome), CLAIM_FILE)
  const mine: InstanceClaim = {
    pid: process.pid,
    profile: config.profile ?? 'unknown',
    startedAt: new Date().toISOString(),
  }
  let existing: string | undefined
  try {
    existing = readFileSync(path, 'utf8')
  } catch {
    // No claim, or one this process cannot read. Either way there is nothing
    // to obey; see parseClaim on why a damaged note is not worth refusing over.
    existing = undefined
  }
  const verdict = decideClaim(parseClaim(existing), process.pid, pidAlive)
  if (verdict.kind === 'refuse') {
    ctx.logger.error(`instance-lock: ${verdict.reason}`)
    ctx.logger.error('instance-lock: two runtimes on one harness home interleave the session log; stop the other one first.')
    // The launcher disposes the tree and then exits; a throw here would leave
    // this entry failed and everything else running.
    ctx.appExit?.(1)
    return
  }
  try {
    writeFileSync(path, formatClaim(mine), 'utf8')
  } catch (error) {
    // A home this runtime cannot write is a home it also cannot corrupt a
    // session in, so this is a note rather than a refusal.
    ctx.logger.warn(`instance-lock: could not record the claim: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  ctx.effect(() => () => {
    // Only ever drop a claim that is still ours: a runtime that took over a
    // stale claim and then exited must not delete a third one written since.
    try {
      if (parseClaim(readFileSync(path, 'utf8'))?.pid === process.pid) rmSync(path, { force: true })
    } catch {
      // Already gone, or unreadable. Both leave a claim the next start treats
      // as stale, which is the same outcome as removing it.
    }
  })
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  dshHome: z.string(),
  profile: z.string(),
  enforce: z.boolean().default(true),
})

/**
 * Whether a pid still names a live process.
 *
 * `process.kill(pid, 0)` delivers no signal and only reports. ESRCH means
 * nobody owns that pid. EPERM means somebody does and it is not us — which
 * still counts as held: another user's runtime is a runtime, and taking the
 * home from it would be exactly the collision this prevents.
 * @param pid - the process to ask about.
 * @returns whether it is alive.
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'EPERM'
  }
}
