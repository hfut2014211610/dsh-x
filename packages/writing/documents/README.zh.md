---
description: "文档能力 seam：共享 locator/edit 词汇、Documents 服务定义与 documents/changed 事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-documents

[English](README.md) | 中文

面向写作模式的文档能力 seam。本包拥有共享的 locator/edit 词汇、`Documents` 服务定义（`ctx.documents`）、结构化文档错误，以及 `documents/changed` 事件声明。

## 概述

本包定义写作模式背后的文档能力 seam：共享 locator/edit 词汇，`Documents` 服务定义（list/read/outline/search/create 加带版本守卫的 apply），结构化文档错误，以及每次成功修改后发出的 `documents/changed` 事件。provider 实现该 seam，模型工具消费它。适合文档后端或消费方需要讲同一种词汇的场景。

## 目录

- [服务 API（`ctx.documents`）](#service-api)
- [事件](#events)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="service-api"></a>
## 服务 API（`ctx.documents`）

- `list({ sessionId, path? })` — 列出工作区相对目录的一个层级，供文档浏览器使用。
- `read({ sessionId, path, locator? })` — 读取整个文档或定位后的切片。
- `outline({ sessionId, path })` — 返回标题/块/工作表结构。
- `search({ sessionId, query, limit? })` — 工作区内容搜索。
- `create({ sessionId, path, content })` — 新建受支持的文本文档。
- `apply({ sessionId, path, baseVersion, edit })` — 带版本守卫的修改。

<a id="events"></a>
## 事件

每次成功修改都会发出 `documents/changed`。

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **本包不包含结构化格式适配器** — `.docx`/`.xlsx` 支持位于 `dsh-documents-local` 及后续阶段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包只有词汇与声明：没有 provider，没有工具。`apply` 按约定带版本守卫；provider 负责执行守卫，并在每次成功修改后发出 `documents/changed`。

</details>
