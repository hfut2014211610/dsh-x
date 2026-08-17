# @deepseek-ai/dsh-documents-local

[English](README.md) | 中文

面向写作模式的本地 workspace 文档 provider。它基于 `ctx.fs` 实现 `ctx.documents`，强制 workspace 包含检查，支持文本/Markdown/代码读取、简单大纲提取、内容搜索、新建和带版本守卫的编辑。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `root` | 必填 | 用于解析相对路径和包含检查的 workspace 根目录。 |
| `maxReadChars` | `200000` | `read` 返回的最大字符数，超出截断。 |
| `maxOutlineItems` | `1000` | `outline` 返回的最大大纲条目数。 |
| `maxSearchFiles` | `50000` | 一次 `search` 扫描的最大文件数。 |

## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **结构化格式使用提取文本往返** — 支持 `.docx`/`.xlsx` 的读取、大纲、搜索和基础文本替换；复杂格式保真不在范围内。
- **搜索目前是简单子串扫描** — BM25/CJK bigram 排序已规划。
