# Writing

[English](README.md) | 中文

面向文档编写与修订的写作模式包。

| 包 | 路径 | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-documents` | `packages/writing/documents/` | 文档能力 seam：共享词汇、服务定义、`documents/changed` 事件 |
| `@deepseek-ai/dsh-documents-local` | `packages/writing/documents-local/` | 基于 `ctx.fs` 的本地 workspace provider |
| `@deepseek-ai/dsh-tool-documents` | `packages/writing/tool-documents/` | 面向模型的 `document_*` 工具 |
| `@deepseek-ai/dsh-writing-mode` | `packages/writing/writing-mode/` | `writing:policy` system-prompt section |
