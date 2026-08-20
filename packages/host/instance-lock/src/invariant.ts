/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-instance-lock`.
 * @module @deepseek-ai/dsh-host-instance-lock/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-instance-lock'

/** Cordis companion plugin name. */
export const name = 'host-instance-lock-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * The relation this package owns — at most one live runtime per harness home —
 * is a fact about other processes, and nothing inside this one can observe it.
 * The claim file is the only local evidence, and a probe of it would answer
 * for whoever wrote it last rather than for the set of runtimes actually
 * running. The write/refuse/release cycle is covered by the package's own
 * tests, where the process table is a seam.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
