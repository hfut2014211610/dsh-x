# @deepseek-ai/dsh-documents

English | [中文](README.zh.md)

Document capability seam for writing mode. This package owns the shared locator/edit vocabulary, the `Documents` service definition (`ctx.documents`), structured document errors, and the `documents/changed` event declaration.

## Service API (`ctx.documents`)

- `list({ sessionId, path? })` — list one workspace-relative directory level for document browsing.
- `read({ sessionId, path, locator? })` — read a whole document or located slice.
- `outline({ sessionId, path })` — return headings/blocks/sheets.
- `search({ sessionId, query, limit? })` — workspace content search.
- `create({ sessionId, path, content })` — create a supported text document.
- `apply({ sessionId, path, baseVersion, edit })` — version-guarded mutation.

## Events

`documents/changed` is emitted after every successful mutation.

## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No structured format adapters in this package** — `.docx`/`.xlsx` support lives in `dsh-documents-local` and later phases.
