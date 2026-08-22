/** Package-owned game Host invariants. @module @deepseek-ai/dsh-game/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { isGameCommandReceipt } from './events.ts'

/** Cordis companion plugin name. */
export const name = 'game-invariant'
/** Required services for the invariant companion. */
export const inject = ['invariants']

/** Validate receipt identity, revision, and uniqueness inside one Host. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const validate = (session: import('@deepseek-ai/dsh-session').Session, candidate?: import('@deepseek-ai/dsh-session').SessionEvent): void => {
    const events = candidate === undefined || session.events[candidate.seq] === candidate
      ? session.events
      : [...session.events, candidate]
    const receipts = events.filter(isGameCommandReceipt).map(event => event.data)
    if (receipts.length === 0) return
    const first = receipts[0]
    /* v8 ignore next -- the non-empty length check above proves index zero exists */
    if (first === undefined) return
    if (first.method !== 'start') fail(`game Host ${session.id} first receipt must be start`)
    const keys = new Map<string, string>()
    for (const receipt of receipts) {
      if (receipt.gameId !== first.gameId || receipt.module.id !== first.module.id || receipt.module.version !== first.module.version) {
        fail(`game Host ${session.id} mixes game or module identities`)
      }
      if (!Number.isSafeInteger(receipt.gameRevision) || receipt.gameRevision < 1) {
        fail(`game Host ${session.id} receipt revision must be a positive safe integer`)
      }
      if (!/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) fail(`game Host ${session.id} receipt digest must be lowercase SHA-256 hex`)
      if (receipt.principalId.length === 0 || receipt.participantId.length === 0) fail(`game Host ${session.id} receipt binding ids must be non-empty`)
      const key = `${receipt.method}\u0000${receipt.requestId}`
      const digest = keys.get(key)
      if (digest !== undefined) fail(`game Host ${session.id} repeats receipt key ${JSON.stringify(key)}`)
      keys.set(key, receipt.payloadDigest)
    }
  }
  for (const session of ctx.sessions.list()) validate(session)
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [import('@deepseek-ai/dsh-session').Session, import('@deepseek-ai/dsh-session').SessionEvent]
    if (isGameCommandReceipt(event)) validate(session, event)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the game Host invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-game', install))
