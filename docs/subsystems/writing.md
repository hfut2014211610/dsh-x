# Writing mode

English | [中文](writing.zh.md)

The writing subsystem gives document-oriented sessions a reduced toolset and a browser editor surface. It is composed of three host packages (`dsh-documents`, `dsh-documents-local`, `dsh-tool-documents`), one prompt package (`dsh-writing-mode`), and one client plugin (`dsh-client-ui-writing`).

## Document vocabulary

Documents resolve relative paths against the session workspace through `ctx.fs`. The version string is the opaque `FsVersion` returned by `ctx.fs`; clients must not interpret it.

```ts
import type { SessionId } from '@deepseek-ai/dsh-session'

type DocumentFormat = 'text' | 'markdown' | 'code' | 'docx' | 'xlsx'

type DocumentDirectoryEntry = {
  name: string
  path: string
  kind: 'directory' | 'file'
  format?: DocumentFormat
}

type DocumentDirectoryListing = {
  path: string
  entries: readonly DocumentDirectoryEntry[]
  truncated: boolean
}

type DocumentLocator =
  | { unit: 'line'; start: number; end: number }
  | { unit: 'paragraph'; start: number; end: number }
  | { unit: 'heading'; id: string }
  | { unit: 'block'; id: string }
  | { unit: 'cell'; sheet: string; range: string }

type DocumentEdit =
  | { kind: 'replace'; locator: DocumentLocator; text: string }
  | { kind: 'insert'; at: DocumentLocator; where: 'before' | 'after'; text: string }
  | { kind: 'delete'; locator: DocumentLocator }

type DocumentPatch =
  | { op: 'splice'; start: number; deleteCount: number; text: string }
  | { op: 'replace'; locator: DocumentLocator; text: string }

type DocumentChange = {
  sessionId: SessionId
  path: string
  baseVersion: string
  version: string
  patches: DocumentPatch[] | null
}
```

`patches` is `null` when the change is too large or not text-shaped; clients re-open the document instead of applying a local patch.

## Service

`ctx.documents` is the document capability seam.

- `list({ sessionId, path? })` — list one workspace-relative directory level for document browsing.
- `read({ sessionId, path, locator? })` — read a whole document or located slice.
- `outline({ sessionId, path })` — return headings/blocks/sheets.
- `search({ sessionId, query, limit? })` — workspace content search.
- `create({ sessionId, path, content })` — create a supported text document.
- `apply({ sessionId, path, baseVersion, edit })` — version-guarded mutation.

Every successful mutation emits `documents/changed`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocuments--documents-abstract-seam"></a>

### `ctx.documents` — `Documents` (abstract seam)

Document service (`ctx.documents`) shared by host providers and consumers.

```ts cordis-catalog
/**
 * List one workspace-relative directory level for a document browser.
 * @param request - session and optional workspace-relative directory path; an absent path lists the root.
 * @returns direct child directories and files, with a truncation marker.
 */
@Remote('list') list(request: { sessionId: SessionId path?: string }): Promise<DocumentDirectoryListing>

/**
 * Resolve and read a whole document or a located slice.
 * @param request - session, document path, and optional locator slice.
 * @returns the resolved content with format, current version, and truncation flag.
 */
@Remote('read') async read(request: { sessionId: SessionId path: string locator?: DocumentLocator }): Promise<DocumentReadResult>

/**
 * Read the structural outline of a document.
 * @param request - session and document path.
 * @returns the outline entries with format and current version.
 */
@Remote('outline') async outline(request: { sessionId: SessionId path: string }): Promise<DocumentOutlineResult>

/**
 * Search workspace documents by content keywords.
 * @param request - session, query, and optional hit limit.
 * @returns the search hits, with a warning when the scan stopped early.
 */
@Remote('search') async search(request: { sessionId: SessionId query: string limit?: number }): Promise<DocumentSearchResult>

/**
 * Create a new supported text document.
 * @param request - session, document path, and initial content.
 * @returns the created path and its first version.
 */
@Remote('create') async create(request: { sessionId: SessionId path: string content: string }): Promise<{ path: string; version: string }>

/**
 * Apply one version-guarded document mutation and emit documents/changed.
 * @param request - session, path, guarded base version, and the edit.
 * @returns the document's new version.
 */
@Remote('apply') async apply(request: { sessionId: SessionId path: string baseVersion: string edit: DocumentEdit }): Promise<{ version: string }>
```

Types: [SessionId](core.md)

Source: [`packages/writing/documents/src/index.ts:29`](../../packages/writing/documents/src/index.ts)

<a id="documents-events"></a>

### `documents/*` events

<a id="documentschanged--emit"></a>

#### `documents/changed` — emit

A document mutation committed through the documents service.

```ts cordis-catalog
/**
 * A document mutation committed through the documents service.
 * @param change - path, versions, and optional text patches.
 * @mode emit
 */
'documents/changed'(change: DocumentChange): void
```

Source: [`packages/writing/documents/src/types.ts:107`](../../packages/writing/documents/src/types.ts)
<!-- END GENERATED cordis-surface -->

## Model plane

The `writing` agent preset contributes only the persona, `writing-mode`, and `tool-documents` rows. It exposes five tools:

- `document_search`
- `document_read`
- `document_outline`
- `document_create`
- `document_edit`

All document modifications must go through `document_edit` with a version returned by a prior read.

## Browser UI

`dsh-client-ui-writing` registers the `writing` `conversation.view`, declares it as the preferred view for sessions whose `agentPreset` is `writing`, and declares Chat as its companion view. `ui-conversation` renders the active view and companion together, hides the mutually exclusive tab strip, and positions its existing Chat transcript and composer in the companion column; ordinary sessions keep the single-view layout.

The writing view contains a focused source editor with file, outline, and workspace-search panels. The file panel calls `documents.list` for the workspace root when it opens, loads child directories on expansion, and preserves the tree while the user switches documents. Markdown documents open in a rendered preview that shares the editor's live draft, so switching modes does not save or discard changes. Manual saves call `documents.apply` with the version from the last read. A `documents/changed` event reloads clean editor state; if local text is dirty, the event produces a conflict notice and preserves the draft. The `@doc` input source inserts the current workspace-relative path into the ordinary composer. Structured `.docx`/`.xlsx` files support extracted-text read, outline, search, and basic text replacement round-trips.
