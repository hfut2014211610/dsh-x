/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-model-tuning`.
 * @module @deepseek-ai/dsh-model-tuning/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-tuning'

/** Cordis companion plugin name. */
export const name = 'model-tuning-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the relation this package owns — a declared field
 * reaches the request it
 * matched — is a property of one request's config, observable only while that
 * request is being assembled. The teardown stream this seam watches carries
 * no requests, so there is nothing here to probe. The waterfall's precedence
 * and its pass-through of undeclared fields are covered by the package's own
 * tests instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
