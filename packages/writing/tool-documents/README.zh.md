---
description: "面向模型的文档工具：document_search/read/outline/create/edit，投影携带版本。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-documents

[English](README.md) | 中文

面向模型的写作文档工具：`document_search`、`document_read`、`document_outline`、`document_create` 和 `document_edit`。本包在 `ctx.tools` 注册五个 `document_*` 工具，并在 `ctx.systemPrompt` 注册写作指导 section。

## 概述

本包给模型五个文档工具加写作指导提示段。结果投影携带的不只是正文：读取前缀 `path`、`version` 与仅裁剪时出现的 `truncated`，让带守卫的编辑能说出 `base_version`、行定位始终瞄准整份文档的行；新建与编辑各自报告本次写入产生的 version，紧随其后的编辑无需再读；调用视图声明 `locations` diff 卡片，产出物界面按渲染意图识别。适合模型需要经工具查找、阅读、修订文档的场景。

## 目录

- [结果投影](#result-projections)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="result-projections"></a>
## 结果投影

送达模型的是 `render`，而非经校验的 `output.schema` 值。因此有三处投影携带的不只是正文。`document_read` 在内容前加上 `path`、`version`，以及仅在内容被裁剪时的 `truncated`：version 没有别的来源，只投影正文会让 `document_edit` 的 `base_version` 无从取得、每次带守卫的编辑都以 stale 失败；而按行定位若瞄准被裁剪的内容，命中的会是整份文档的错误行。`document_create` 与 `document_edit` 各自报告本次写入产生的 version，因此紧随其后的编辑无需再读一次。

`document_create` 与 `document_edit` 在各自的调用视图上声明 `locations`——create 是对空的 diff 卡片，定位编辑则是 generic `edit` 卡片（它没有可供对比的原内容）。这正是 [`dsh-client-ui-deliverables`](../../client/ui-deliverables/README.zh.md) 用来列出产出文件的词汇：它按渲染意图识别变更，从不按工具名识别。

<a id="model-experience"></a>
## Model Experience

Indirectly, through the generated tool catalog and system-prompt renderer, which own the model-visible schemas and guidance text.

#### KV Cache effect

No direct invalidation; the named renderers own any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **结构化格式通过提取文本往返支持** — 复杂格式保真不在范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

送达模型的是 `render`，不是经校验的 `output.schema` 值：读取保留 `path`/`version`/`truncated`，写入报告产生的 version，否则带守卫的编辑以 stale 失败、裁剪定位打偏。产出物按渲染意图（`locations`）识别变更，从不按工具名识别。

</details>
