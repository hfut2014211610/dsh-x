import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as GameInvariant from '../src/invariant.ts'
import { GameId, GameRequestId, ParticipantId, PrincipalId } from '../src/types.ts'
import type { GameCommandReceiptV1 } from '../src/types.ts'

const validReceipt = (overrides: Partial<GameCommandReceiptV1> = {}): GameCommandReceiptV1 => ({
  version: 1,
  gameId: GameId('g1'),
  module: { id: 'test', version: 1 },
  method: 'start',
  requestId: GameRequestId('r1'),
  payloadDigest: 'a'.repeat(64),
  gameRevision: 1,
  principalId: PrincipalId('local'),
  participantId: ParticipantId('human'),
  ...overrides,
})

async function setup(existing?: (session: Session) => void) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('game-invariant'))
  existing?.(session)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(GameInvariant)
  return { ctx, session }
}

function appendReceipt(session: Session, receipt: GameCommandReceiptV1): SessionEvent {
  return session.append('game/command-receipt', receipt)
}

describe('game Host receipt invariants', () => {
  it('accepts valid receipts, non-game dispatch, and late-loaded Hosts', async () => {
    const late = await setup((session) => { appendReceipt(session, validReceipt()) })
    expect(() => { late.ctx.emit('tools/change') }).not.toThrow()

    const fresh = await setup()
    expect(() => fresh.session.append('turn/start', { turn: 1 })).not.toThrow()
    expect(() => appendReceipt(fresh.session, validReceipt())).not.toThrow()
  })

  it('requires start as the first receipt and unique method/request keys', async () => {
    const first = await setup()
    expect(() => appendReceipt(first.session, validReceipt({ method: 'resume' }))).toThrow(/first receipt must be start/)

    const second = await setup()
    appendReceipt(second.session, validReceipt())
    expect(() => appendReceipt(second.session, validReceipt())).toThrow(/repeats receipt key/)
  })

  it('keeps one game and module identity in each Host', async () => {
    for (const overrides of [
      { gameId: GameId('g2'), method: 'resume' as const, requestId: GameRequestId('r2') },
      { module: { id: 'other', version: 1 }, method: 'resume' as const, requestId: GameRequestId('r2') },
      { module: { id: 'test', version: 2 }, method: 'resume' as const, requestId: GameRequestId('r2') },
    ]) {
      const { session } = await setup()
      appendReceipt(session, validReceipt())
      expect(() => appendReceipt(session, validReceipt(overrides))).toThrow(/mixes game or module identities/)
    }
  })

  it('requires a positive safe revision and lowercase SHA-256 digest', async () => {
    for (const gameRevision of [0, 1.5]) {
      const { session } = await setup()
      expect(() => appendReceipt(session, validReceipt({ gameRevision }))).toThrow(/positive safe integer/)
    }
    const { session } = await setup()
    expect(() => appendReceipt(session, validReceipt({ payloadDigest: 'A'.repeat(64) }))).toThrow(/lowercase SHA-256/)
  })

  it('requires both principal and participant bindings', async () => {
    const first = await setup()
    expect(() => appendReceipt(first.session, validReceipt({ principalId: PrincipalId('') }))).toThrow(/binding ids must be non-empty/)
    const second = await setup()
    expect(() => appendReceipt(second.session, validReceipt({ participantId: ParticipantId('') }))).toThrow(/binding ids must be non-empty/)
  })
})
