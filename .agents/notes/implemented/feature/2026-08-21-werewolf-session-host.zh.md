# Agent Note: 狼人杀阶段3——Session Host 与类型化游戏运行时

Status: implemented

[English](2026-08-21-werewolf-session-host.md) | 中文

## 问题

确定性核心与 one-shot 运行器会产生分离转换，但尚未拥有可玩的多轮生命周期。实况游戏需要一个持久权威、原子命令发布、调用方幂等、参与者授权、按局串行、有限并行 Bot 工作、重启恢复，以及供专用 UI 使用的类型化表面。把这些职责放进狼人杀引擎会妨碍后续游戏复用，并把平台身份与 Agent 生命周期混入领域规则。

## 决策

阶段3新增一个完整的 `@deepseek-ai/dsh-game` capability 包。`GameService` 是 Service Definition，`SessionGameService` 是默认 provider，`GameModule` 是 Consumer 约定。provider 为每局创建一个空闲 Host Agent 和 Session，记录本地主体到参与者的绑定，串行化每局变更，拥有 `GameAiExecutor`，发布 `game/projection-invalidated`，并在重启后读取已知 id 时冷恢复确定性的 `game-<GameId>` Host。Host 模型绝不运行。

每个变更请求携带调用方 `requestId`；开始后的请求还携带 `expectedGameRevision`。`game/command-receipt` 记录游戏与模块版本、方法、request id、规范 payload SHA-256 摘要、已提交修订、主体和参与者。相同重复请求即使经过自动推进也返回当前授权投影，同一键下另一 payload 会冲突，新请求携带过期修订则拒绝。回执与领域转换进入同一次 `Session.appendBatch()`。

`Session.appendBatch()` 快照每个候选，在改变实时日志前校验完整 surface 转换，并针对影子前缀运行同步 Session 不变量。失败时日志、surface、缓存事件快照与观察者均不改变。成功批次先完整进入日志，再按顺序向普通观察者发布事件。

`WerewolfGameModule` 保持为阶段1–2引擎与 reducer 之上的薄层。它在开始前校验准确规则集与隔离型 provider，把真人动作、恢复和中止转换为领域事件，并通过 Host executor 推进阶段。parallel-private Bot 请求共享一个源修订，在 `maxConcurrentBots` 下运行，并提交一个按座位排序的 `werewolf/bot-decision`；seat-order-public 阶段先提交一个行动者，再构造下一 prompt。`WerewolfGameGateway` 暴露类型化 `start`、`getView`、`getReplay`、`submitAction`、`resume`、`abortGame`，且不接受 Session id、player id 或座位。`WerewolfHumanViewV1` 是唯一真人投影，终局回放返回授权检查点而非原始事件。

## 后果

- 真实 Loader 组合通过 fresh 隔离子代理、有限并行、持久 Bot 上下文推进完成 `quick-7`；Host 模型调用为零，并产生终局授权回放与稳定 Host 事件序列快照。
- capability 拒绝发生在 `werewolf/game-started` 之前；即使 provider 支持结构化输出、persona、工具过滤和深度限制，只要继承父历史仍属非法。
- 通用回执新增一个 required Session 事件类型，因此生成的持久化词汇与目录包含它。
- 阶段4仍负责专用 Web 视图。阶段3不注册命令、斜杠命令或 Chat composer 变更路径。
- 版本1绑定一个 loopback 本地主体。支持从已知游戏 id 恢复；冷开始回执枚举与在线身份属于未来工作。

## 备选方案

**把 Host 保留在 `ctx.werewolf`。** 被否，因为 Agent/Session 生命周期、幂等、身份与 AI 调度不是狼人杀规则，其他回合制游戏同样需要复用。

**逐条追加回执与领域事件。** 被否，因为崩溃或不变量失败可能暴露没有转换的回执，或只暴露多事件转换的一部分。

**使用 Host 对话作为控制器。** 被否，因为这会让确定性操作消耗模型轮次，把合法性与保密移入 prompt，并让 UI 动作依赖 Chat 路由。
