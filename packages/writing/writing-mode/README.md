# @deepseek-ai/dsh-writing-mode

English | [中文](README.zh.md)

Writing-mode system-prompt section. It registers the `writing:policy` prompt section that requires all document changes to go through `document_edit`.

## Model Experience

Indirectly, through the system-prompt renderer, which owns the assembled model-visible text.

#### KV Cache effect

No direct invalidation; the named renderer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No independent runtime behavior** — this package only contributes a prompt section.
