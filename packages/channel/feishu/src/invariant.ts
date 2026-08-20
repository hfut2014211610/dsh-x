/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-feishu`.
 * @module @deepseek-ai/dsh-feishu/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-feishu'

/** Cordis companion plugin name. */
export const name = 'feishu-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the relations worth holding this channel to are all
 * on the other side of a
 * socket: one consumer per event key, one reply sent as the app that received
 * the message, one card patched by the app that sent it. None of them is
 * observable from the teardown stream this seam watches, and a probe here
 * would answer about this process's own view rather than about the bridge.
 * They are covered by the package's own tests, where the bridge is a seam.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
