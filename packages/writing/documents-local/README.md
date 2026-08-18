# @deepseek-ai/dsh-documents-local

English | [中文](README.zh.md)

Local workspace document provider for writing mode. It implements `ctx.documents` over `ctx.fs`, resolving every request against the attached session's `header.cwd` and enforcing containment within that workspace. An unknown session or one without a project cwd rejects with `DOCUMENT_IO_ERROR`; bounded directory browsing, text/markdown/code reading, simple outline extraction, content search, creation, and version-guarded edits all use the same session-owned root.

A text edit addresses a `line` or `paragraph` range and nothing else. The bounds are validated as integers before the range is checked, because the locator arrives from model-authored tool JSON where the schema accepts any locator object: against a missing `start`/`end` every range comparison is false, the offsets would resolve to the whole document, and a replace would silently overwrite the entire file with its replacement text — a successful call that destroys the document, past a version guard that cannot see it. A locator without integer bounds is rejected with `DOCUMENT_LOCATOR_UNSUPPORTED`.

Every mutation carries the sandbox policy of its CALLING session, resolved through `ctx.sandboxPolicy` with that session. Without it the policy service falls back to the deployment's configured root, which the Web bundle derives from the runtime's `process.cwd()` — the same directory as the workspace only when a developer happens to launch the server from inside it. In a packaged app that directory is the installation, so `workspace-write` denied every document write in the workspace the person had actually opened.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxReadChars` | `200000` | Maximum characters returned by `read` before truncation. |
| `maxOutlineItems` | `1000` | Maximum outline entries returned by `outline`. |
| `maxSearchFiles` | `50000` | Maximum files scanned by one `search` query. |
| `maxBrowseEntries` | `2000` | Maximum direct children returned by one `list` call. |

## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Structured formats use extracted-text round-trips** — `.docx`/`.xlsx` read, outline, search, and basic text replacement are supported; advanced formatting preservation is out of scope.
- **Search is a simple substring scan** — BM25/CJK bigram ranking is planned.
- **No string-anchored locator** — a caller that knows only the surrounding text must read the document and compute a line range itself, which costs one extra round trip per edit.
