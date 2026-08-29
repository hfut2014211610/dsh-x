# Agent Note: 独立狼人杀应用与固定 Bot Session

Status: implemented

[English](2026-08-24-isolated-werewolf-application.md) | 中文

## 问题

把狼人杀作为 agent preset 会让游戏依赖普通 Session 导航。玩家可以通过会话侧边栏离开，游戏 Host Session 会和普通工作混在一起，返回游戏也依赖重新选择正确的内部 Session。游戏虽然已创建固定 Bot Agent，却没有保证其父 Host 带有 provider 和 model，因此未显式配置 `botAgent` 路由的部署会在第一次 Bot 行动时失败。自动推进会让 `start` 与真人变更一直等待后续所有 Bot turn 完成，导致专用窗口既不能快速返回，也不能在每条公开 Bot 结果提交时及时呈现。真人投影已经给出获授权可见的阵营队友，但游戏桌没有呈现这项信息。

## 决策

狼人杀在由 `dshMode=werewolf` 选择的独立应用窗口中运行。主界面只提供一个 `sidebar.footer.action` 入口；专用窗口的 `shell.surface` 会替换全部会话界面，并通过自己的退出操作关闭。preset 列表不再包含已退役的狼人杀 agent preset。游戏 Host Session 继续使用 `agentPreset: werewolf` 作为内部分类，但不会进入普通工作区导航。

所选 `gameId` 保存在专用窗口 URL 中。未选择对局时，`WerewolfGameGateway.getLobby()` 调用 `ctx.games.listViews()`，按新到旧返回本地主体的运行中与已暂停投影。因此再次打开窗口会从 Host 状态恢复游戏，而不是依赖浏览器存储或主窗口当前 Session。

每个非真人座位在整局中使用一个隐藏 Agent Session。`WerewolfGameModule.hostAgentOptions` 在创建 Host 前解析当前 `ctx.agentDefaultModel` 的 provider 和 model；配置的 `botAgent` 路由仍可逐个覆盖子 Agent。`WerewolfGameModule.initializeAgents()` 会在 `start()` 返回前建好所有这些 Session，并为每个 Agent 固定已配置的 `botReasoningEffort`，因此该座位后续每个 FIFO follow-up 都使用同一强度。Web 组合选择 `high`，以保留明确的推理过程，同时避免每次决策都使用 `max`。恢复后的持久 Bot Session 仍使用同一个确定性 id 与父 Host。Host 模型不会运行。

狼人杀在通用游戏 Host 上选择后台自动调度。开始与真人变更会在自身持久转换提交后返回，随后每个自动步骤经同一局串行队列运行，并分别发布投影失效通知。这扩展了[阶段3 Host](2026-08-21-werewolf-session-host.md)，但没有改变其他模块的前台调度。Bot 第一次决策接收有限公开历史；后续决策只携带自该 Bot 上一次已提交决策后新增的公开时间线，而固定 Session 会保留更早的 turn。重试只追加拒绝诊断，因为紧邻的决策 prompt 仍在同一个 Session 中；[阶段2运行器](2026-08-21-werewolf-bot-runner.md)仍然持有信封校验、兜底和独立 one-shot 调用面。

即使模型省略冗余的 `publicSpeech` 字段，真人投影也会把已接受的文本动作作为公开发言。专用窗口在投票开放前，通过公开时间线和发言进度呈现每条已提交发言。夜间目标、Bot 连续性上下文和私密推理不会进入真人投影。游戏桌只为已出现在 `WerewolfHumanViewV1.self.teammates` 中的玩家 id 呈现图标加文字的队友标识。

早先的 [fresh one-shot 提案](../../rejected/feature/2026-08-20-configurable-werewolf-mode.md)已被拒绝，因为其连续性记录重复保存了固定游戏 Agent Session 已能直接保留的上下文。该提案中的确定性引擎、类型化动作、规则配置与授权目标仍已实现，但实际交付的 Bot 与界面选择由本笔记记录。

## 考虑过的替代方案

**继续把狼人杀作为 agent preset。** 这样可以沿用原入口，但会让内部 Host Session 表现得像普通会话，也允许无关导航中断游戏流程。

**在 local storage 中记住上一局。** 这比增加 Host 列表方法更小，但会让浏览器状态成为唯一返回路径，也可能指向已删除或无权访问的游戏。`ctx.games.listViews()` 根据权威 Host 记录与主体绑定生成大厅。

**每次决策创建 fresh 子代理。** 这可以隔离单轮调用，但需要在游戏事件中维护第二套连续性模型，也不满足同一个 Bot 在整局中保留固定模型会话的要求。

**继承模型路由未指定的默认推理强度。** 这种方式少一个配置项，但部署或主会话选择可能让每个 Bot 决策都使用 `max`，使交互延迟无法预测。创建时设置 `botReasoningEffort` 能保持明确的游戏策略，并让准确模型解析在网络 I/O 前拒绝不支持的档位。

**在发起 RPC 内等待全部自动 Bot turn。** 这样可以把意外调度错误返回给该调用方，但会持续阻塞游戏窗口，并隐藏已经提交的公开进度。后台调度保留同一套串行事件权威，同时逐个暴露已完成的发布单元。

**在游戏桌揭示队友角色。** 真人投影只授权队友身份，并未授权任意角色细节。队友标识准确表达这项权限，不扩大秘密投影。

## 后果

主应用与游戏不再共享导航状态，关闭游戏窗口或切换会话后仍能恢复活跃对局。桌面端必须只允许同源狼人杀窗口 URL，同时继续把无关 HTTP 链接交给系统浏览器。通用游戏服务提供按模块和主体授权的列表操作、固定 Agent 初始化及可选的后台调度模式；其他模块默认仍使用前台调度。创建狼人杀 Host 必须存在 `agentDefaultModel`，因此即使配置了 Bot 专用选项，测试也要提供该服务。固定 Bot Session 能提供要求的策略连续性且不会出现在通用子代理 UI 中；增量公开观察避免重复已交付的时间线，但已接受的 Bot turn 历史仍属于模型上下文。
