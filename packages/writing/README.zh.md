---
description: "面向文档编写与修订的写作模式包：documents 能力 seam、本地 provider、模型工具与写作策略段。"
kind: "package-group"
---

# Writing

[English](README.md) | 中文

面向文档编写与修订的写作模式包。

## 概述

写作组给会话提供文档编写与修订能力：带共享词汇与 `documents/changed` 事件的能力 seam、基于 `ctx.fs` 的本地 workspace provider、面向模型的 `document_*` 工具，以及 `writing:policy` system-prompt 段。要词汇挂 seam，要本地文件挂 provider，要模型访问挂工具，要写作模式指令挂策略段。各包的保证与配置见各自 README。

| 包 | 路径 | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-documents` | `packages/writing/documents/` | 文档能力 seam：共享词汇、服务定义、`documents/changed` 事件 |
| `@deepseek-ai/dsh-documents-local` | `packages/writing/documents-local/` | 基于 `ctx.fs` 的本地 workspace provider |
| `@deepseek-ai/dsh-tool-documents` | `packages/writing/tool-documents/` | 面向模型的 `document_*` 工具 |
| `@deepseek-ai/dsh-writing-mode` | `packages/writing/writing-mode/` | `writing:policy` system-prompt section |
