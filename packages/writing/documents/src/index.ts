/**
 * Document capability seam for writing mode.
 * @module @deepseek-ai/dsh-documents
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  DocumentEdit,
  DocumentDirectoryListing,
  DocumentLocator,
  DocumentOutlineResult,
  DocumentReadResult,
  DocumentSearchResult,
} from './types.ts'

export { DocumentError } from './error.ts'
export type { DocumentErrorCode } from './error.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    documents: Documents
  }
}

/** Document service (`ctx.documents`) shared by host providers and consumers. */
export abstract class Documents extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'documents')
  }

  /**
   * List one workspace-relative directory level for a document browser.
   * @param request - session and optional workspace-relative directory path; an absent path lists the root.
   * @returns direct child directories and files, with a truncation marker.
   */
  @Remote('list')
  list(request: {
    sessionId: SessionId
    path?: string
  }): Promise<DocumentDirectoryListing> {
    void request
    return Promise.reject(new Error('documents.list is not implemented by this service definition'))
  }

  /**
   * Resolve and read a whole document or a located slice.
   * @param request - session, document path, and optional locator slice.
   * @returns the resolved content with format, current version, and truncation flag.
   */
  @Remote('read')
  read(request: {
    sessionId: SessionId
    path: string
    locator?: DocumentLocator
  }): Promise<DocumentReadResult> {
    void request
    return Promise.reject(new Error('documents.read is not implemented by this service definition'))
  }

  /**
   * Read the structural outline of a document.
   * @param request - session and document path.
   * @returns the outline entries with format and current version.
   */
  @Remote('outline')
  outline(request: {
    sessionId: SessionId
    path: string
  }): Promise<DocumentOutlineResult> {
    void request
    return Promise.reject(new Error('documents.outline is not implemented by this service definition'))
  }

  /**
   * Search workspace documents by content keywords.
   * @param request - session, query, and optional hit limit.
   * @returns the search hits, with a warning when the scan stopped early.
   */
  @Remote('search')
  search(request: {
    sessionId: SessionId
    query: string
    limit?: number
  }): Promise<DocumentSearchResult> {
    void request
    return Promise.reject(new Error('documents.search is not implemented by this service definition'))
  }

  /**
   * Create a new supported text document.
   * @param request - session, document path, and initial content.
   * @returns the created path and its first version.
   */
  @Remote('create')
  create(request: {
    sessionId: SessionId
    path: string
    content: string
  }): Promise<{ path: string; version: string }> {
    void request
    return Promise.reject(new Error('documents.create is not implemented by this service definition'))
  }

  /**
   * Apply one version-guarded document mutation and emit documents/changed.
   * @param request - session, path, guarded base version, and the edit.
   * @returns the document's new version.
   */
  @Remote('apply')
  apply(request: {
    sessionId: SessionId
    path: string
    baseVersion: string
    edit: DocumentEdit
  }): Promise<{ version: string }> {
    void request
    return Promise.reject(new Error('documents.apply is not implemented by this service definition'))
  }
}

export default Documents
