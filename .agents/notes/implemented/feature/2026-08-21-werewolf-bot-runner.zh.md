# Agent Note: 狼人杀阶段2——one-shot Bot 运行器与观察投影

Status: implemented

[English](2026-08-21-werewolf-bot-runner.md) | 中文

## 问题

阶段1证明了确定性规则，但每个 Bot 决策都是脚本回调。真实对局需要子代理 seam 的 one-shot 合同之下的模型驱动 Bot，且该 seam 的验收标准严格：每个子代理只看到自己的授权观察、返回一个结构化信封、即使模型试图违规也无法产生非法动作、重试不泄露上一个子代理的自由文本、并以可见兜底而非静默降级收束。这些都不能搭在父代理上——父模型必须完全置身于游戏输入之外。

## 决策

在 `@deepseek-ai/dsh-werewolf` 中新增三部分，全部复用既有事件词汇：

1. **观察投影是折叠状态的纯函数。** `projectWerewolfBotObservation` 构造完整的 `WerewolfBotPromptV1`：行动者角色与私有知识来自注册的角色投影器，仅当编译角色声明 `seesFactionTeammates` 时才提供队友，公开状态只含名册事实与配置数量的尾部时间线，合法动作序列化封闭规格词汇。隔离测试将序列化 prompt 与禁止内容（他人角色或阵营、同级上下文）比对，而不只检查预期字段。
2. **运行器在每个边界都把模型输出当作不可信数据。** `runWerewolfBotDecision` 通过 `ctx.subagents.start()` 启动全新子代理，携带由封闭规格词汇派生的对象根输出 schema（schema 子集强制 `enum` 节点携带 `type`）、固定 persona、`toolFilter: { allow: [] }`、`delegationDepthOf(parent) + 1` 的委派深度上限，以及可选的逐子代理路由。信封被严格解析（未知键拒绝）、先动作后增量校验，每次失败追加带唯一准确类别的分离 `werewolf/bot-attempt-failed` 载荷；子代理结果被拒绝时以 `result-rejected` 收束而非未处理拒绝。重试复用同一逻辑决策 id、递增尝试号，且只前置一行诊断——绝不携带上一个子代理的输出。
3. **兜底与取消是可见事实。** 配置的重试预算耗尽后，`auto-action` 提交按规格种类取首个合法值的确定性托管动作，附引擎生成的上下文增量与 `trustee: true`；`pause-game` 返回暂停请求由调用方追加。调用方 signal 取消会 dispose 在途子代理并返回 `cancelled`；超时或 dispose 之后的迟到结果无法改变任何状态，因为该次尝试已经收束。运行时新增经校验的 schemastery `Config`（provider 名、逐子代理路由、重试预算、超时、兜底策略、上下文限制、并发、时间线上限），经 `botRunnerConfig()` 暴露；阶段3控制器接入会话流后，游戏开始将在首个事件前断言 provider 的四项能力。

## 后果

- 阶段2验收证明在测试中成立：决策 N 被接受的 `contextAfter` 正是决策 N+1 收到的 `priorContext`，同级 Bot 上下文保持不变，且同级捕获的 prompt 从不包含第一个 Bot 的私有增量。
- 每次尝试一个全新子代理会话，标签为 `werewolf <phase> seat <n> attempt <k>`；父会话的模型历史在构造上不受影响。
- 运行器只返回分离载荷——阶段3控制器负责追加它们、重试纪元预算与暂停/恢复持久化。
- `maxConcurrentBots` 是经过校验的配置，但测试中为串行执行；遵循它的并行协调器随阶段3控制器落地。

## 备选方案

**只在提交路径校验信封。** 引擎提交已拒绝非法动作，但重试分类需要在下一个子代理启动前得到准确类别；在运行器校验让重试廉价且日志干净。

**每个 Bot 一个可续接子代理会话。** 因与原提案相同的理由被否：没有逐决策结构化合同，注入面持续增长。

**信任 provider 的 schema 校验作为合法性检查。** provider 校验形状；合法性（目标成员、发言边界）是游戏权威，保留在引擎的封闭词汇中，这也让 schema 生成器保持在受强制约束的 JSON-Schema 子集内。
