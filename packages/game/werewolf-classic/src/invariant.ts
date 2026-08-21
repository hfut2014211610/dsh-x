/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-werewolf-classic`.
 * @module @deepseek-ai/dsh-werewolf-classic/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-werewolf-classic'

/** Cordis companion plugin name. */
export const name = 'werewolf-classic-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the classic definitions are pure same-process
 * functions whose outputs the Werewolf core detaches, validates, and applies
 * in a fixed order. This package owns no durable event stream and no mutable
 * state whose relationships a live probe could observe; the core package's
 * companion owns the game-event invariants, and these definitions' behavior
 * is pinned by this package's own tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
