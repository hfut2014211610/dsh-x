# @deepseek-ai/dsh-tool-documents

English | [中文](README.zh.md)

Model-facing document tools for writing mode: `document_search`, `document_read`, `document_outline`, `document_create`, and `document_edit`. The package registers the five `document_*` tools on `ctx.tools` and the writing guidance section on `ctx.systemPrompt`.

## Model Experience

Indirectly, through the generated tool catalog and system-prompt renderer, which own the model-visible schemas and guidance text.

#### KV Cache effect

No direct invalidation; the named renderers own any request-prefix changes.

## Known Limitations and Deferred Work

- **Structured formats are supported through extracted-text round-trips** — advanced formatting preservation is out of scope.
