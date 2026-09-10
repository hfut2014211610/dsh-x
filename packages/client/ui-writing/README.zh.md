---
description: "写作模式浏览器视图：文档编辑器，带预览、大纲与工作区搜索，伴随聊天，仅 writing agent 预设激活。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-writing

[English](README.md) | 中文

浏览器写作模式插件。它注册会话自有的 `writing` `conversation.view` 条目，仅在 `agentPreset` 为 `writing` 时激活该视图，并通过会话伴随视图扩展把现有 Chat 视图和 composer 放在编辑器旁边。写作模式只在新建或仍为空白的会话中选择，不会作为 tab 出现在普通会话或已经开始的会话里。空白会话会在 preset 切换确认后立即进入该工作区；离开此 preset 会恢复之前的会话 tab 或新建会话 Hero，且不会覆写原状态。

编辑器提供专注的文本编辑区，以及文件、大纲和工作区搜索面板。文件面板自动加载工作区根目录，展开目录时按需读取子级，并在切换文件时保持目录树打开。打开或重新载入文档会刷新其父目录，但不会折叠已展开行；读取或保存失败时也会刷新父目录，使已不存在的文件从下一次目录结果中移除。Markdown 文档默认使用渲染预览，并可切换回源码编辑，未保存草稿不会丢失。选择大纲项时，渲染预览会在当前模式内滚动；源码模式依据 provider 返回的位置选中并显示对应标题，重复标题也能区分。手工保存使用最近一次读取返回的文档版本。编辑器没有未保存内容时，`documents/changed` 事件会重新载入文档；存在未保存内容时，编辑器保留草稿并显示冲突提示，不会替换用户文本。

## 概述

本包是 `writing` agent 预设的浏览器写作模式工作区：文档编辑器，带渲染好的 Markdown 预览、大纲导航与工作区搜索，通过伴随视图扩展坐在聊天旁边。手工保存携带最近一次读取的文档版本；外部变更重载干净的编辑器，对有未保存草稿的编辑器提示冲突。适合用来改文档而不是聊天的会话。它只把工作区相对路径插进 composer 草稿，不拥有任何模型可见消息。

## 目录

- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

无，因为本包只把当前文档的工作区相对路径插入普通浏览器 composer 草稿；任何由此产生的模型可见用户消息都由 conversation 包负责。

#### KV Cache effect

无；本包不组装或发送 provider 请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **源码编辑能力为纯文本** — Markdown 已提供渲染预览，但所见即所得 Markdown、Word 与电子表格编辑仍需要格式专用浏览器编辑器；本包当前展示结构化格式的提取文本。
- **保存需要显式触发** — 当前没有防抖自动保存；版本守卫会阻止过期的手工保存覆盖更新后的文档。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

保存必须携带最近一次读取的文档版本；版本守卫是防止过期编辑器覆盖新文档的唯一屏障。拾取与编辑都是引用，不是请求：落进 composer 草稿，改什么仍由用户说出来。

</details>
