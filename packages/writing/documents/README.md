---
description: "Document capability seam: shared locator/edit vocabulary, the Documents service definition, and the documents/changed event."
kind: "package-reference"
---

# @deepseek-ai/dsh-documents

English | [中文](README.zh.md)

Document capability seam for writing mode. This package owns the shared locator/edit vocabulary, the `Documents` service definition (`ctx.documents`), structured document errors, and the `documents/changed` event declaration.

## Summary

This package defines the document capability seam behind writing mode: the shared locator/edit vocabulary, the `Documents` service definition with list/read/outline/search/create plus version-guarded apply, structured document errors, and the `documents/changed` event emitted after every mutation. Providers implement the seam; model tools consume it. Use it when a document backend or consumer must speak the same vocabulary.

## Table of Contents

- [Service API (`ctx.documents`)](#service-api)
- [Events](#events)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="service-api"></a>
## Service API (`ctx.documents`)

- `list({ sessionId, path? })` — list one workspace-relative directory level for document browsing.
- `read({ sessionId, path, locator? })` — read a whole document or located slice.
- `outline({ sessionId, path })` — return headings/blocks/sheets.
- `search({ sessionId, query, limit? })` — workspace content search.
- `create({ sessionId, path, content })` — create a supported text document.
- `apply({ sessionId, path, baseVersion, edit })` — version-guarded mutation.

<a id="events"></a>
## Events

`documents/changed` is emitted after every successful mutation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No structured format adapters in this package** — `.docx`/`.xlsx` support lives in `dsh-documents-local` and later phases.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package is vocabulary and declaration only: no provider, no tools. `apply` is version-guarded by contract; providers enforce the guard and emit `documents/changed` after every successful mutation.

</details>
