# @deepseek-ai/dsh-tool-documents

[English](README.md) | 中文

面向模型的写作文档工具：`document_search`、`document_read`、`document_outline`、`document_create` 和 `document_edit`。本包在 `ctx.tools` 注册五个 `document_*` 工具，并在 `ctx.systemPrompt` 注册写作指导 section。

## 结果投影

送达模型的是 `render`，而非经校验的 `output.schema` 值。因此有三处投影携带的不只是正文。`document_read` 在内容前加上 `path`、`version`，以及仅在内容被裁剪时的 `truncated`：version 没有别的来源，只投影正文会让 `document_edit` 的 `base_version` 无从取得、每次带守卫的编辑都以 stale 失败；而按行定位若瞄准被裁剪的内容，命中的会是整份文档的错误行。`document_create` 与 `document_edit` 各自报告本次写入产生的 version，因此紧随其后的编辑无需再读一次。

`document_create` 与 `document_edit` 在各自的调用视图上声明 `locations`——create 是对空的 diff 卡片，定位编辑则是 generic `edit` 卡片（它没有可供对比的原内容）。这正是 [`dsh-client-ui-deliverables`](../../client/ui-deliverables/README.md) 用来列出产出文件的词汇：它按渲染意图识别变更，从不按工具名识别。

## Model Experience

Indirectly, through the generated tool catalog and system-prompt renderer, which own the model-visible schemas and guidance text.

#### KV Cache effect

No direct invalidation; the named renderers own any request-prefix changes.

## Known Limitations and Deferred Work

- **结构化格式通过提取文本往返支持** — 复杂格式保真不在范围内。
