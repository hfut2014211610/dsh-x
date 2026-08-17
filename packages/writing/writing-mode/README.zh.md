# @deepseek-ai/dsh-writing-mode

[English](README.md) | 中文

写作模式 system-prompt section。它注册 `writing:policy` 提示词 section，要求所有文档修改都必须经过 `document_edit`。

## Model Experience

Indirectly, through the system-prompt renderer, which owns the assembled model-visible text.

#### KV Cache effect

No direct invalidation; the named renderer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **没有独立运行时行为** — 本包只贡献提示词 section。
