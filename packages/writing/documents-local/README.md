---
description: "Local workspace document provider: session-rooted reads, search, creation, and version-guarded edits over ctx.fs."
kind: "package-reference"
---

# @deepseek-ai/dsh-documents-local

English | [中文](README.zh.md)

Local workspace document provider for writing mode. It implements `ctx.documents` over `ctx.fs`, resolving every request against the attached session's `header.cwd` and enforcing containment within that workspace. An unknown session or one without a project cwd rejects with `DOCUMENT_IO_ERROR`; bounded directory browsing, text/markdown/code reading, simple outline extraction, content search, creation, and version-guarded edits all use the same session-owned root.

A text edit addresses a `line` or `paragraph` range and nothing else. The bounds are validated as integers before the range is checked, because the locator arrives from model-authored tool JSON where the schema accepts any locator object: against a missing `start`/`end` every range comparison is false, the offsets would resolve to the whole document, and a replace would silently overwrite the entire file with its replacement text — a successful call that destroys the document, past a version guard that cannot see it. A locator without integer bounds is rejected with `DOCUMENT_LOCATOR_UNSUPPORTED`.

Every mutation carries the sandbox policy of its CALLING session, resolved through `ctx.sandboxPolicy` with that session. Without it the policy service falls back to the deployment's configured root, which the Web bundle derives from the runtime's `process.cwd()` — the same directory as the workspace only when a developer happens to launch the server from inside it. In a packaged app that directory is the installation, so `workspace-write` denied every document write in the workspace the person had actually opened.

## Summary

This package is the local document provider behind writing mode: it implements `ctx.documents` over `ctx.fs`, rooted at the attached session's workspace with containment enforced, offering bounded browsing, reading, outline, search, creation, and version-guarded line/paragraph edits. Locators are integer-validated before range checks so a missing bound can never resolve to the whole file, and every mutation carries its calling session's sandbox policy. Use it when sessions must read and revise workspace documents through the documents seam.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="config"></a>
## Config

| Key | Default | Meaning |
|---|---|---|
| `maxReadChars` | `200000` | Maximum characters returned by `read` before truncation. |
| `maxOutlineItems` | `1000` | Maximum outline entries returned by `outline`. |
| `maxSearchFiles` | `50000` | Maximum files scanned by one `search` query. |
| `maxBrowseEntries` | `2000` | Maximum direct children returned by one `list` call. |

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Structured formats use extracted-text round-trips** — `.docx`/`.xlsx` read, outline, search, and basic text replacement are supported; advanced formatting preservation is out of scope.
- **Search is a simple substring scan** — BM25/CJK bigram ranking is planned.
- **No string-anchored locator** — a caller that knows only the surrounding text must read the document and compute a line range itself, which costs one extra round trip per edit.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Validate locator bounds as integers before the range check: model-authored JSON can omit `start`/`end`, and without the integer gate every comparison is false and the offsets resolve to the whole file. Mutations resolve the sandbox policy through the calling session, never the deployment root.

</details>
