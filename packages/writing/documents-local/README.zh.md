---
description: "本地 workspace 文档 provider：基于 ctx.fs，按会话根目录读取、搜索、新建与版本守卫编辑。"
kind: "package-reference"
---

# @deepseek-ai/dsh-documents-local

[English](README.md) | 中文

面向写作模式的本地 workspace 文档 provider。它基于 `ctx.fs` 实现 `ctx.documents`，每次请求都从已附加会话的 `header.cwd` 解析根目录，并强制路径包含在该 workspace 内。未知会话或没有项目 cwd 的会话以 `DOCUMENT_IO_ERROR` 拒绝；有界目录浏览、文本/Markdown/代码读取、简单大纲提取、内容搜索、新建和带版本守卫的编辑共用这一个由会话持有的根目录。

文本编辑只按 `line` 或 `paragraph` 的行范围定位。范围边界在做越界检查之前先按整数校验，因为 locator 来自模型编写的工具 JSON、而工具 schema 接受任意 locator 对象：`start`/`end` 缺失时每一项范围比较都为假，偏移量会解析成整份文档，一次 replace 就会把整个文件静默覆盖为它的替换文本——一次成功返回却毁掉文档的调用，而版本守卫看不见它。没有整数边界的 locator 以 `DOCUMENT_LOCATOR_UNSUPPORTED` 拒绝。

每次写入都携带**调用方会话**的沙箱策略，经 `ctx.sandboxPolicy` 带着该会话解析。不带会话时策略服务会回落到部署配置的根，而 Web bundle 把它取自运行时的 `process.cwd()`——只有开发者恰好在工作区里启动服务时，那个目录才等于工作区。打包后的应用里它是安装目录，于是 `workspace-write` 会拒绝掉用户真正打开的那个工作区里的每一次文档写入。

## 概述

本包是写作模式背后的本地文档 provider：基于 `ctx.fs` 实现 `ctx.documents`，根目录取自已附加会话的工作区并强制 containment，提供有界浏览、读取、大纲、搜索、新建与带版本守卫的行/段落编辑。locator 先按整数校验再做越界检查，缺失边界绝不会解析成整个文件；每次写入都携带调用方会话的沙箱策略。适合会话需要经 documents seam 读写修订工作区文档的场景。

## 目录

- [配置](#config)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxReadChars` | `200000` | `read` 返回的最大字符数，超出截断。 |
| `maxOutlineItems` | `1000` | `outline` 返回的最大大纲条目数。 |
| `maxSearchFiles` | `50000` | 一次 `search` 扫描的最大文件数。 |
| `maxBrowseEntries` | `2000` | 一次 `list` 返回的最大直接子级数量。 |

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **结构化格式使用提取文本往返** — 支持 `.docx`/`.xlsx` 的读取、大纲、搜索和基础文本替换；复杂格式保真不在范围内。
- **搜索目前是简单子串扫描** — BM25/CJK bigram 排序已规划。
- **没有字符串锚定的 locator** — 只知道上下文文本的调用方必须先读取文档再自行计算行范围，每次编辑因此多一个往返。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

locator 边界先按整数校验再做越界检查：模型编写的 JSON 可能缺 `start`/`end`，没有整数关卡时每一项比较都为假，偏移量会解析成整个文件。写入经调用方会话解析沙箱策略，绝不用部署根。

</details>
