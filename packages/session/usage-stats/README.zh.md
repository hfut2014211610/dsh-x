---
description: "逐请求 token 用量投影：每个组装出消息的 step 一条记录，带路由、用量与模型耗时。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-stats

[English](README.md) | 中文

函数插件，注册 `usageStats` 投影单元：每次模型请求一条记录——供应商上报的 token 计量、实际派发的 provider/model 与模型耗时——从持久会话日志折叠，经 session-projection seam（注册表快照、变更通知与全部投影载体：history 尾页、`session/projection` 推送帧、会话列表行）提供。参考消费方是 Web 设置的用量面板（`dsh-client-ui-settings-usage`），它读取会话列表行携带的逐会话值；本包不触碰任何模型请求。

## 概述

本包把每个组装出消息的 step 折叠成一条用量记录：`assistant/message` 自带的用量、最近 `request/context` 的路由，以及 `step/start` → message 的耗时。用量随消息到达——没有独立的用量记录——因此没有落定消息的 step 不留记录。记录经 session-projection seam 提供给设置用量面板。适合客户端基于持久日志展示逐请求 token 花销的场景。

## 目录

- [折叠语义](#fold-semantics)
- [组合](#composition)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="fold-semantics"></a>
## 折叠语义

- 每个组装出消息的 step 产生一条记录。`assistant/message` 以最终 usage 与 `llmMs`（`step/start` → message，与 session-stats 求和的边界一致）落定该 step 的记录；不带 usage 的消息保留 null 采样；没有落定消息的 step——失败尝试只带流不带计量——不留记录。
- 匹配只检查最后一条记录：合法日志中同一 turn/step 的 usage 上报相邻（token-meter 替换槽依赖的同一不变量），重复采样替换该 step 早先的值而不是重复累计。
- `provider`/`model` 取自最近的 `request/context`（仅在路由或容量变化时落盘），即该 step 实际派发的路由；首个 context 之前均为 null。`contextWindow` 同为最后写入胜出，从未广播过则为 null。
- `time` 是记录最近一次贡献事件的时间，供外部消费；`usage` 在日志中没有任何上报时为 null，该记录仍计为一次请求并保留计时。

<a id="composition"></a>
## 组合

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

注入 `sessionProjections`——插件的全部目的；缺注册表的组装中 fiber 保持 pending，不注册任何内容。挂载于 web-app bundle，由设置用量面板消费；其他组装不提供 `usageStats` key，客户端将其读作能力缺失。

<a id="model-experience"></a>
## Model Experience

无。插件只对已落盘的会话事件计算面向客户端的读模型，不触碰任何 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；插件从不组装或发送供应商请求。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **辅助 LLM 调用未计账** —— `session/title-llm-request` 与 `web/deepseek-search-llm-request` 不记录 usage，标题生成与搜索 LLM 的消耗在这些事件携带计量前始终游离于统计之外。
- **DeepSeek 上 `cacheWriteTokens` 恒缺失** —— 适配器没有可填充它的线路字段，该桶在 DeepSeek 会话读为空，仅 pi-ai 路由可能填充。
- **重试的 step 只报告最终尝试** —— 重试停留在同一 step 内，替换语义保留最后一个 usage 采样，同 step 早先异常上报 usage 的失败尝试被覆盖而非累计。
- **记录以会话为界，无跨会话折叠** —— 单元描述单个会话的完整日志；设置面板在客户端聚合列表行，任何服务端全局聚合都需要新的持久层。
- **冷会话新鲜度受检查点约束** —— 分离会话展示其最后持久化的投影检查点（`asOfSeq` 说明陈旧程度）；挂载中的会话是实时的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

用量随 `assistant/message` 到达；失败尝试只带流不带计量，按设计不留记录。upsert 只检查最后一条记录，因为同一 turn/step 的上报相邻——保持该相邻不变量，否则重复采样会重复累计。

</details>
