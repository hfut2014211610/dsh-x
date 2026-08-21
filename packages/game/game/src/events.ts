/** Common durable game-host events. @module @deepseek-ai/dsh-game/events */

import type { GameCommandReceiptV1 } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Atomic command receipt and principal-to-participant binding. */
    'game/command-receipt': GameCommandReceiptV1
  }
}

/**
 * Whether an event is the common command receipt.
 * @param event - candidate Session event.
 * @returns whether the event carries a game command receipt.
 */
export function isGameCommandReceipt<T extends { type: string }>(event: T): event is T & { type: 'game/command-receipt'; data: GameCommandReceiptV1 } {
  return event.type === 'game/command-receipt'
}
