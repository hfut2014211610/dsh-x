# @deepseek-ai/dsh-client-ui-writing

[English](README.md) | 中文

浏览器写作模式插件。它注册 `writing` 的 `conversation.view` 条目，并为 `agentPreset` 为 `writing` 的会话声明默认视图。

## Model Experience

None, as the browser-side writing plugin only registers a view tab; nothing here reaches a model request.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **编辑器目前是 Phase 1 textarea 外壳** — CodeMirror、树/大纲侧栏、搜索浮窗和 `@doc` 引用源尚未实现。
