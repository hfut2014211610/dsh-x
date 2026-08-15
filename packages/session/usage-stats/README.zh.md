# @deepseek-ai/dsh-usage-stats

[English](README.md) | 中文

函数插件，注册 `usageStats` 投影单元：每次模型请求一条记录——供应商上报的 token 计量、实际派发的 provider/model 与模型耗时——从持久会话日志折叠，经 session-projection seam（注册表快照、变更通知与全部投影载体：history 尾页、`session/projection` 推送帧、会话列表行）提供。参考消费方是 Web 设置的用量面板（`dsh-client-ui-settings-usage`），它读取会话列表行携带的逐会话值；本包不触碰任何模型请求。

## 折叠语义

- 每个上报过 usage 或组装出消息的 step 产生一条记录。`assistant/chunk` 的 usage 上报会提前创建或更新该 step 的记录，因此已流出 usage 随后失败的请求仍被计账；`assistant/message` 以最终 usage 与 `llmMs`（`step/start` → message，与 session-stats 求和的边界一致）落定同一条记录。
- 匹配只检查最后一条记录：合法日志中同一 turn/step 的 usage 上报相邻（token-meter 替换槽依赖的同一不变量），重复采样替换该 step 早先的值而不是重复累计。不带 usage 的 message 保留早先 chunk 的采样。
- `provider`/`model` 取自最近的 `request/context`（仅在路由或容量变化时落盘），即该 step 实际派发的路由；首个 context 之前均为 null。`contextWindow` 同为最后写入胜出，从未广播过则为 null。
- `time` 是记录最近一次贡献事件的时间，供外部消费；`usage` 在日志中没有任何上报时为 null，该记录仍计为一次请求并保留计时。

## 组合

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

注入 `sessionProjections`——插件的全部目的；缺注册表的组装中 fiber 保持 pending，不注册任何内容。挂载于 web-app bundle，由设置用量面板消费；其他组装不提供 `usageStats` key，客户端将其读作能力缺失。

## Model Experience

无。插件只对已落盘的会话事件计算面向客户端的读模型，不触碰任何 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；插件从不组装或发送供应商请求。

## Known Limitations and Deferred Work

- **辅助 LLM 调用未计账** —— `session/title-llm-request` 与 `web/deepseek-search-llm-request` 不记录 usage，标题生成与搜索 LLM 的消耗在这些事件携带计量前始终游离于统计之外。
- **DeepSeek 上 `cacheWriteTokens` 恒缺失** —— 适配器没有可填充它的线路字段，该桶在 DeepSeek 会话读为空，仅 pi-ai 路由可能填充。
- **重试的 step 只报告最终尝试** —— 重试停留在同一 step 内，替换语义保留最后一个 usage 采样，同 step 早先异常上报 usage 的失败尝试被覆盖而非累计。
- **记录以会话为界，无跨会话折叠** —— 单元描述单个会话的完整日志；设置面板在客户端聚合列表行，任何服务端全局聚合都需要新的持久层。
- **冷会话新鲜度受检查点约束** —— 分离会话展示其最后持久化的投影检查点（`asOfSeq` 说明陈旧程度）；挂载中的会话是实时的。
