/** Package-owned invariant companion for `@deepseek-ai/dsh-model-hub`. @module @deepseek-ai/dsh-model-hub/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-hub'

/** Cordis companion plugin name. */
export const name = 'model-hub-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the settings transaction validates each model-hub
 * document and synchronously reconciles its complete owned route set before
 * publishing the update, leaving no independent event/data relation to scan.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
