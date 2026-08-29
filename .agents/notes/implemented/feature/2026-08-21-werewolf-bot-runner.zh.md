# Agent Note: 狼人杀阶段2——Bot 运行器与观察投影

Status: implemented

[English](2026-08-21-werewolf-bot-runner.md) | 中文

## 问题

阶段1证明了确定性规则，但每个 Bot 决策都是脚本回调。真实对局需要模型驱动 Bot 遵守隔离的决策约定：每个 Bot 只看到自己的授权观察、返回一个结构化信封、即使模型试图违规也无法产生非法动作、重试不会把被拒绝的自由文本提升为游戏状态，并以可见兜底而非静默降级收束。这些都不能搭在父代理上——父模型必须完全置身于游戏输入之外。

## 决策

在 `@deepseek-ai/dsh-werewolf` 中新增三部分，全部复用既有事件词汇：

1. **观察投影是权威折叠状态的纯函数。** `projectWerewolfBotObservation` 仅在请求的游戏及修订、阶段标识、动作计划、编译规则摘要、待决策行动者与完整先前上下文仍匹配当前状态时继续。prompt 随后从该状态派生合法动作与上下文，在座位及名称旁携带公开玩家 id，并经注册角色投影器得到私有知识；仅当编译角色声明 `seesFactionTeammates` 时才提供队友。隔离测试将序列化 prompt 与禁止内容比对，而不只检查预期字段。
2. **运行器在每个边界都把模型输出当作不可信数据。** `runWerewolfBotDecision` 接受 Host 的固定 Agent executor，并通过 `turnBot()` 发送 prompt；其独立调用面仍可通过 `ctx.subagents.start()` 启动全新子代理，携带由权威封闭规格词汇派生的对象根输出 schema（schema 子集强制 `enum` 节点携带 `type`）、固定 persona、`toolFilter: { allow: [] }`、`delegationDepthOf(parent) + 1` 的委派深度上限，以及可选的逐子代理路由。prompt 要求恰好返回 `action` 与 `contextDelta` 两个根键，明确当前阶段准确的动作对象，拒绝 `kind`、`text`、`target` 等动作别名，把文本动作的 `value` 映射为公开发言，并把增量限制为发生变化的主观字段，而不是完整先前上下文。信封被严格解析（未知键拒绝），先校验动作（包括公开发言的阶段与长度规则），再校验上下文增量。如果文本阶段的信封带有非法动作对象但提供显式且合法的 `publicSpeech` 字符串，运行器会在执行同一组校验前，把动作规范为 `{ value: publicSpeech }`；这只接受含义明确的展示别名，不接受隐藏推理，也不绕过发言长度限制。每次失败返回带唯一准确类别的分离 `werewolf/bot-attempt-failed` 载荷；子代理结果被拒绝时以 `result-rejected` 收束而非未处理拒绝。重试复用同一逻辑决策 id 并递增尝试号。固定 Session 保留先前观察，因此接收一行拒绝诊断和精简输出约定；独立重试没有先前 turn，所以携带完整观察。
3. **兜底、取消与清理都是可见事实。** 取消会与子代理结果及超时直接竞速，而非等待超时预算，并在返回 `cancelled` 前等待 dispose。每条结果路径都先 dispose 再接受；dispose 失败时使用 `disposal` 类别重试，因为子代理未证明静止。其他失败与 dispose 失败同时发生时，重试诊断保留两者，持久尝试类别记录为 `disposal`。配置的重试预算耗尽后，`auto-action` 提交按规格种类取首个合法值的确定性托管动作，附引擎生成的上下文增量与 `trustee: true`；`pause-game` 返回暂停请求由调用方追加。超时或 dispose 之后的迟到结果没有消费者，不能改变任何状态。运行时经校验的 schemastery `Config` 由 `botRunnerConfig()` 暴露，包括 `maxConcurrentBots`；Session Host 现在会在开始前校验 `inheritsParentContext === false`，并通过注入 executor 执行该并发设置。

## 后果

- 阶段2验收证明在测试中成立：决策 N 被接受的 `contextAfter` 正是决策 N+1 收到的 `priorContext`，同级 Bot 上下文保持不变，且同级捕获的 prompt 从不包含第一个 Bot 的私有增量。
- 托管对局为每个 Bot 座位保留一个固定隐藏 Agent Session；独立调用面则为每次尝试创建 fresh 子代理。两条路径都不会把游戏输入加入 Host 模型历史。
- 运行器只返回分离载荷；`WerewolfGameModule` 现在经通用 Session Host 追加这些载荷，并接入重试纪元及暂停/恢复。
- 无密钥真实 Loader 覆盖保留完整授权重试请求快照，并新增通过类型化 Host 表面完成 `quick-7` 且不调用 Host 模型的证明。
- `maxConcurrentBots` 解析为部署值；通用 executor 现在执行该上限，运行器自身仍保持每次调用只处理一个决策。

## 备选方案

**只在提交路径校验信封。** 引擎提交已拒绝非法动作，但重试分类需要在下一个子代理启动前得到准确类别；在运行器校验让重试廉价且日志干净。

**只使用每个 Bot 一个可续接子代理 Session。** 托管对局选择这条路径以保留策略，但独立调用面仍适合隔离运行器测试和原生支持逐调用 schema 的 provider。两条路径在提交前共用同一套游戏校验。

**信任 provider 的 schema 校验作为合法性检查。** provider 校验形状；合法性（目标成员、发言边界）是游戏权威，保留在引擎的封闭词汇中，这也让 schema 生成器保持在受强制约束的 JSON-Schema 子集内。
