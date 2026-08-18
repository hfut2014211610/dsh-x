/** Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-model-hub`. @module @deepseek-ai/dsh-client-ui-model-hub/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-model-hub'

/** Cordis companion plugin name. */
export const name = 'client-ui-model-hub-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns only a browser settings projection;
 * the host gateway validates and commits the mutable model-hub document.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
