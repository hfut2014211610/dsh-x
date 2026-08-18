# @deepseek-ai/dsh-documents

[English](README.md) | 中文

面向写作模式的文档能力 seam。本包拥有共享的 locator/edit 词汇、`Documents` 服务定义（`ctx.documents`）、结构化文档错误，以及 `documents/changed` 事件声明。

## 服务 API（`ctx.documents`）

- `list({ sessionId, path? })` — 列出工作区相对目录的一个层级，供文档浏览器使用。
- `read({ sessionId, path, locator? })` — 读取整个文档或定位后的切片。
- `outline({ sessionId, path })` — 返回标题/块/工作表结构。
- `search({ sessionId, query, limit? })` — 工作区内容搜索。
- `create({ sessionId, path, content })` — 新建受支持的文本文档。
- `apply({ sessionId, path, baseVersion, edit })` — 带版本守卫的修改。

## 事件

每次成功修改都会发出 `documents/changed`。

## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **本包不包含结构化格式适配器** — `.docx`/`.xlsx` 支持位于 `dsh-documents-local` 及后续阶段。
