---
description: "写作模式 system-prompt section：要求所有文档修改经过 document_edit。"
kind: "package-reference"
---

# @deepseek-ai/dsh-writing-mode

[English](README.md) | 中文

写作模式 system-prompt section。它注册 `writing:policy` 提示词 section，要求所有文档修改都必须经过 `document_edit`。

## 概述

本包贡献 `writing:policy` system-prompt 段：一条常驻指令，要求所有文档修改经过 `document_edit`，让每次变更都落在带版本守卫的 seam 里。它没有独立运行时行为。适合写作预设需要把模型绑死在受守卫编辑路径上的场景。

## 目录

- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the system-prompt renderer, which owns the assembled model-visible text.

#### KV Cache effect

No direct invalidation; the named renderer owns any request-prefix changes.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **没有独立运行时行为** — 本包只贡献提示词 section。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

除 section 文本外无其他内容：该策略把模型绑死在 `document_edit` 上，让每次变更都落在带版本守卫的 seam 里。

</details>
