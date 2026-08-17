/**
 * Client-safe document vocabulary for writing mode. Types here carry no host
 * dependencies so both the host service and the browser can share them.
 * @module @deepseek-ai/dsh-documents/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Supported document formats. */
export type DocumentFormat = 'text' | 'markdown' | 'code' | 'docx' | 'xlsx'

/**
 * A located span or structural unit inside one document.
 * Line and paragraph numbers are 1-based inclusive ranges.
 */
export type DocumentLocator =
  | { unit: 'line'; start: number; end: number }
  | { unit: 'paragraph'; start: number; end: number }
  | { unit: 'heading'; id: string }
  | { unit: 'block'; id: string }
  | { unit: 'cell'; sheet: string; range: string }

/** One version-guarded document mutation. */
export type DocumentEdit =
  | { kind: 'replace'; locator: DocumentLocator; text: string }
  | { kind: 'insert'; at: DocumentLocator; where: 'before' | 'after'; text: string }
  | { kind: 'delete'; locator: DocumentLocator }

/** A small text-shaped patch applied by clients without reopening the file. */
export type DocumentPatch =
  | { op: 'splice'; start: number; deleteCount: number; text: string }
  | { op: 'replace'; locator: DocumentLocator; text: string }

/** Change event emitted after every successful document mutation. */
export interface DocumentChange {
  readonly sessionId: SessionId
  readonly path: string
  readonly baseVersion: string
  readonly version: string
  readonly patches: DocumentPatch[] | null
}

/** Structured result of a document read. */
export interface DocumentReadResult {
  readonly path: string
  readonly format: DocumentFormat
  readonly version: string
  readonly content: string
  readonly truncated: boolean
}

/** One outline entry. */
export interface DocumentOutlineEntry {
  readonly id: string
  readonly kind: 'heading' | 'block' | 'sheet'
  readonly title: string
  readonly locator: DocumentLocator
}

/** Structured result of a document outline read. */
export interface DocumentOutlineResult {
  readonly path: string
  readonly format: DocumentFormat
  readonly version: string
  readonly entries: readonly DocumentOutlineEntry[]
}

/** One search hit. */
export interface DocumentSearchHit {
  readonly path: string
  readonly title: string
  readonly snippet: string
  readonly score: number
  readonly truncated: boolean
}

/** Structured result of a workspace document search. */
export interface DocumentSearchResult {
  readonly hits: readonly DocumentSearchHit[]
  readonly warning?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A document mutation committed through the documents service.
     * @param change - path, versions, and optional text patches.
     * @mode emit
     */
    'documents/changed'(change: DocumentChange): void
  }
}
