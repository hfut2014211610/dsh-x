# 写作模式

[English](writing.md) | 中文

写作子系统为文档类会话提供精简工具集和浏览器编辑器界面。它由三个宿主包（`dsh-documents`、`dsh-documents-local`、`dsh-tool-documents`）、一个提示词包（`dsh-writing-mode`）和一个客户端插件（`dsh-client-ui-writing`）组成。

## 文档词汇

文档通过 `ctx.fs` 将会话工作目录中的相对路径解析为真实文件。版本字符串是 `ctx.fs` 返回的不透明 `FsVersion`，客户端不得解读。

```ts
import type { SessionId } from '@deepseek-ai/dsh-session'

type DocumentFormat = 'text' | 'markdown' | 'code' | 'docx' | 'xlsx'

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

当修改过大或不是文本形态时，`patches` 为 `null`；客户端应重新打开文档，而不是应用本地补丁。

## 服务

`ctx.documents` 是文档能力 seam。

- `read({ sessionId, path, locator? })` — 读取整个文档或定位后的切片。
- `outline({ sessionId, path })` — 返回标题/块/工作表结构。
- `search({ sessionId, query, limit? })` — 工作区内容搜索。
- `create({ sessionId, path, content })` — 新建受支持的文本文档。
- `apply({ sessionId, path, baseVersion, edit })` — 带版本守卫的修改。

每次成功修改都会发出 `documents/changed`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocuments--documents-abstract-seam"></a>

### `ctx.documents` — `Documents` (abstract seam)

Document service (`ctx.documents`) shared by host providers and consumers.

```ts cordis-catalog
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

Source: [`packages/writing/documents/src/index.ts:28`](../../packages/writing/documents/src/index.ts)

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

Source: [`packages/writing/documents/src/types.ts:90`](../../packages/writing/documents/src/types.ts)
<!-- END GENERATED cordis-surface -->

## 模型面

`writing` agent preset 只包含 persona、`writing-mode` 和 `tool-documents` 三行。它暴露五个工具：

- `document_search`
- `document_read`
- `document_outline`
- `document_create`
- `document_edit`

所有文档修改都必须通过 `document_edit`，并携带此前读取返回的版本。

## 浏览器 UI

`dsh-client-ui-writing` 注册一个 id 为 `writing` 的 `conversation.view` 条目，并为 `agentPreset` 为 `writing` 的会话声明默认视图；用户显式选择的 tab 仍然优先。完整编辑器、树/大纲侧栏、搜索浮窗和 `@doc` 引用源正在实现中。结构化 `.docx`/`.xlsx` 文件支持提取文本的读取、大纲、搜索和基础文本替换往返。
