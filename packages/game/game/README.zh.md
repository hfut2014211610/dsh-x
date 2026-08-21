# dsh-game

[English](README.md) | 中文

面向持久回合制游戏模块的通用 `ctx.games` capability。默认 provider 为每局创建一个保持空闲的 Host Agent 和 Session，串行化变更，把本地主体绑定到一个参与者，将命令回执与领域事件原子提交，使授权投影失效，并调度 fresh one-shot AI 子代理；整个过程不调用 Host 模型。

## 生命周期

`start()` 在创建 Host 前完成模块校验。第一条 `game/command-receipt` 与模块开始事件通过 `Session.appendBatch()` 进入 Session。后续 `submitAction`、`resume`、`abortGame` 使用 `{ method, requestId }` 回执、payload SHA-256 摘要和 `expectedGameRevision`：相同重复请求返回当前投影，修改 payload 会发生冲突，新请求携带过期修订则拒绝。每局只有一个串行操作队列。已知 `GameId` 可经 Agent 持久化路径冷恢复其确定性的 `game-<GameId>` Host。

## 模块约定

`GameModule` 拥有领域规则、事件折叠、修订与状态、变更、自动推进、授权投影和回放。Host 拥有 Agent/Session 生命周期、主体绑定、幂等、原子发布、取消、有限并发和子代理启动权限。模块事件只进入日志，绝不进入 Host 模型 surface。

`GameAiExecutor.map()` 在指定并发上限下保持输入顺序。`GameAiExecutor.start()` 补入准确 Host 父节点和操作 signal，因此模块负责构造 prompt 与 schema，通用 Host 保留子代理血缘与取消权限。

## 导出形态

默认导出 `SessionGameService`；抽象 Service Definition 为 `GameService`。`./invariant` 校验 Host 回执的身份、修订、摘要和唯一性。`./types` 暴露品牌化 id 与模块约定。

## 模型体验

### 游戏 Host

#### 模型看到什么

什么都看不到。Host 始终空闲，`ctx.games` 将普通游戏变更追加为 log-only 事件。只有模块请求的 one-shot 子代理会收到经模块授权的 prompt。

#### Token 影响

Host 不消耗模型 token。子代理 token 用量属于所选模块和 provider。

#### KV Cache 影响

Host 不创建模型请求，因此没有游戏专属 Host cache。fresh 子代理不会复用上一次决策的 transcript。

## 已知限制与暂缓事项

- 版本1只有一个 loopback 本地主体。在线身份、多人授权、产品级游戏 fork 与狼人杀专用 UI 属于后续层。冷持久化存储无法枚举开始请求；支持从已知 `GameId` 恢复。
