# @deepseek-ai/dsh-documents-local

[English](README.md) | 中文

面向写作模式的本地 workspace 文档 provider。它基于 `ctx.fs` 实现 `ctx.documents`，每次请求都从已附加会话的 `header.cwd` 解析根目录，并强制路径包含在该 workspace 内。未知会话或没有项目 cwd 的会话以 `DOCUMENT_IO_ERROR` 拒绝；有界目录浏览、文本/Markdown/代码读取、简单大纲提取、内容搜索、新建和带版本守卫的编辑共用这一个由会话持有的根目录。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxReadChars` | `200000` | `read` 返回的最大字符数，超出截断。 |
| `maxOutlineItems` | `1000` | `outline` 返回的最大大纲条目数。 |
| `maxSearchFiles` | `50000` | 一次 `search` 扫描的最大文件数。 |
| `maxBrowseEntries` | `2000` | 一次 `list` 返回的最大直接子级数量。 |

## Model Experience

Indirectly, through `dsh-tool-documents`, which renders document reads, edits, outlines, and search results to the model.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **结构化格式使用提取文本往返** — 支持 `.docx`/`.xlsx` 的读取、大纲、搜索和基础文本替换；复杂格式保真不在范围内。
- **搜索目前是简单子串扫描** — BM25/CJK bigram 排序已规划。
