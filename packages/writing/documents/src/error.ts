/**
 * Structured errors for the documents capability.
 * @module @deepseek-ai/dsh-documents/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable machine-routable document failure codes. */
export type DocumentErrorCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_STALE_VERSION'
  | 'DOCUMENT_LOCATOR_UNSUPPORTED'
  | 'DOCUMENT_EDIT_UNSUPPORTED'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_INVALID_PATH'
  | 'DOCUMENT_IO_ERROR'

/** Typed document error carrying a stable code. */
export class DocumentError extends HarnessError {
  override readonly code: DocumentErrorCode

  constructor(message: string, code: DocumentErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
