# @deepseek-ai/dsh-tool-documents

[English](README.md) | 中文

面向模型的写作文档工具：`document_search`、`document_read`、`document_outline`、`document_create` 和 `document_edit`。本包在 `ctx.tools` 注册五个 `document_*` 工具，并在 `ctx.systemPrompt` 注册写作指导 section。

## Model Experience

Indirectly, through the generated tool catalog and system-prompt renderer, which own the model-visible schemas and guidance text.

#### KV Cache effect

No direct invalidation; the named renderers own any request-prefix changes.

## Known Limitations and Deferred Work

- **结构化格式通过提取文本往返支持** — 复杂格式保真不在范围内。
