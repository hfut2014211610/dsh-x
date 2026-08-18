# @deepseek-ai/dsh-documents-local

English | [中文](README.zh.md)

Local workspace document provider for writing mode. It implements `ctx.documents` over `ctx.fs`, enforcing workspace containment, bounded directory browsing, text/markdown/code reading, simple outline extraction, content search, creation, and version-guarded edits.

## Config

| Key | Default | Meaning |
|---|---|---|
| `root` | required | Workspace root for resolving relative paths and containment. |
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
