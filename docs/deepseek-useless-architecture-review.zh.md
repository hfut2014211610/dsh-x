# DeepSeek Useless 平台架构评审

[English](deepseek-useless-architecture-review.md) | 中文

## 评审范围

2026-08-21 执行了两轮独立 Opus 评审：第一轮评审[平台架构 Agent Note](../.agents/notes/proposed/feature/2026-08-21-deepseek-useless-game-platform.md)，第二轮把它与 `D:\dev\DSH-X-werewolf` 当前狼人杀阶段 1–2 实现及阶段 3 提案逐项对照。两轮主 `claude-opus-5-0.2` 路由均因 provider 502 中断，未返回可用结论；按既定单次降级规则，`claude-opus-5` 完成了两轮只读评审。评审者没有修改代码、分支或远端。

## 裁决

平台评审裁决为 **ACCEPT WITH CHANGES**；狼人杀专项裁决为 **阶段 3 开始前必须调整脚手架**。两轮评审都认可确定性领域内核、两平面拆分、不绑定统一阶段语法的 `GameModule`、one-shot AI 座位、观察者投影和分阶段裁剪；同时否决由狼人杀自行持有 Session 控制器或用循环 append 伪装批次原子性。

综合源码复核并完成阶段 3 提案修订后，结论是：**设计基线通过，原有文档阻塞冲突已经消除；实现只能从后续冻结的 DSH-X 集成提交开始，并且在通过下列门禁前不能称为完成。** 本次只修订文档，没有实现平台运行时、没有向 `dsh-u` 同步代码，也没有操作远端。

## 发现与处理

| 等级 | 发现 | 处理结果 |
|---|---|---|
| P0 | 已复核的 DSH-X `Session.append()` 每次只追加一个事件，原方案却声称事件批次原子提交。 | 接受。阶段 1 明确要求新增 `Session.appendBatch()`，整批预校验、一次更新内存日志、顺序通知 observer，并在发布投影前通过 `ctx.sessions.flush()`。故障时隔离实例，不确认命令。 |
| P0 | 狼人杀提案由自身 runtime 持有 Session 控制器、串行化、RPC 和投影生命周期，fork 后会与平台形成两套控制器。 | 接受。阶段 3 改为引入完整 `ctx.games` seam 和狼人杀薄适配器；Host/Session 绑定、mailbox、收据、身份、批次提交、失效通知和 AI 调度只由 `ctx.games` 持有，`ctx.werewolf` 保留规则、引擎、reducer、投影和 Bot 策略。 |
| P0 | 一份 Session 可承载多局游戏，原始 Session fork 同时被当作产品分支操作。 | 接受。每局游戏与可玩 fork 都创建专用空闲 Host Agent/Session；“再来一局”创建有 lineage 的新实例。原始 Session fork 只用于诊断；可玩 fork 记录父修订并派生新的服务端 entropy。 |
| P0 | DND GM/NPC 的 continuable 生命周期没有定义。 | 接受问题，但不把 continuable 变成首版依赖。阶段 1 至 4 固定使用 fresh `spawn` one-shot，并从事件与显式连续性重建完整上下文；continuable 需要以后独立设计。 |
| P1 | `game` profile 是否继承 `base/web-app` 不明确，可能仍挂载 Terminal、Writing 或飞书。 | 接受。`game` 改为独立最小 bundle，直接声明所需核心依赖；`base/web-app` 仅留在 maintainer profile。 |
| P1 | 阶段 3 从调用方传入的 `sessionId` 推断唯一真人，无法安全扩展到 Web、飞书或多人身份。 | 接受。外部变更方法不再接收 Host Session 或座位；入口适配器把 Web 身份或未来飞书 `open_id` 解析为平台主体，再由 `ctx.games` 解析参与者绑定。MVP 仍只绑定一名本地真人。 |
| P1 | 专项评审建议把通用 AI 观察、合法动作与意图 schema 拆成三个方法。 | 部分接受。真人投影保持独立，但 AI 观察与 schema 继续统一在 `prepareAiTurn()` 中，保证模块只有一份 AI 决策真相；狼人杀现有观察/schema builder 在该方法后适配，连续性仍由模块持有。 |
| P1 | “投影测试证明永不泄密”的表述超出类型系统和有限测试能保证的范围。 | 接受。改为每模块 viewer 矩阵、秘密 fixture、字段排除、跨座位 prompt 快照和非干扰测试的运行时门禁。 |
| P1 | 可玩 fork 的随机流策略未定义。 | 接受。可玩分支创建新的 host Agent/Session，记录父修订和新服务端 entropy；子分支未来随机不同但自身可回放。原随机状态只用于只读诊断克隆。 |
| P1 | 模型选择与保留的飞书路径没有进入首版控制器契约。 | 接受。`model-hub` 按座位、游戏、Host 默认顺序解析，child Session 记录实际路由/模型。未来 fork 保留飞书源码，并在后续通过可选 `game-feishu` adapter 接入；基础 `game` profile 不挂载飞书。 |
| P2 | 专项评审建议立即拆出 `game`、`game-session-runtime` 和 `game-agent` 三个包。 | 有意收窄。阶段 3 只创建一个完整 `packages/game/game/` 能力包；provider/runtime 与 AI executor 先作为内部模块，等第二款游戏证明包级 seam 后再拆。 |
| P2 | SRD、DeepSeek/DND 名称和 Logo 有许可或商标风险。 | 不阻塞本地技术实现；DND 内容包必须固定 `srdVersion` 和署名，任何公开发布前另做品牌与法务评审。 |

## 源码复核修正

评审中的 continuable 建议使用了非公开表述。在已复核的 DSH-X 快照中，实际公共入口是 `SubagentRuntime.startContinuable()`，后续通过 `followup()`、`interrupt()` 和 drain API 管理；内部 `Activation` 由 continuation manager 持有，不暴露给游戏模块。因此修订方案没有让模块保存内部句柄。

AI 座位必须显式选择 `subagent-spawn-in-process`，并验证 `inheritsParentContext === false`。`fork` provider 会继承父会话的已完成 turn，不能作为隐藏信息游戏的默认 AI 路径。

持久化抽象已经接受连续事件数组，并在 `append()` 返回前达到 durability；缺口位于内存 `Session` 的单事件接纳面。因此推荐补充 `appendBatch()`，而不是在游戏层用 `append()` 循环伪装原子事务。

## 阶段 1 门禁

- 实现分支只能从狼人杀完成并集成当前 DSH-X 主线后的精确干净提交创建；官方 rc.8 只作为对比基线。
- `Session.appendBatch()` 在任一候选事件无效时不改变内存日志，并有故障注入测试。
- 一个命令的收据和模块事件进入同一持久化批次；flush 成功前不发投影、不确认请求。
- 每局游戏与可玩 fork 都有专用 Host Agent/Session、一个 mailbox 和一个写入所有者；Host 不接收普通聊天 turn。
- RPC 解析平台主体与参与者绑定；任何外部变更都不能自行选择 Host Session 或座位。
- AI 只使用 fresh `spawn`、结构化输出、受限工具和 `inheritsParentContext === false`；验证 `model-hub` 优先级与 child 执行证据。
- `game` bundle 不继承 `base/web-app`，运行快照中不存在被排除插件的注册项。
- 可选飞书 overlay 通过同一主体与投影契约映射 `open_id`，且不进入基础阶段 3 里程碑。
- 狼人杀 adapter 的直接引擎等价、回放、幂等、秘密投影和 quick-7 脚本 fixture 通过。

## 最终建议

架构与修订后的狼人杀阶段 3 设计在文档层面通过。不要在当前仅保存设计的 `dsh-u` 工作树中开始实现；应等待狼人杀完成，集成当前 DSH-X 主线并保留 `model-hub` 与飞书，冻结精确干净提交后再 fork。运行时实现与测试、远程多人、continuable GM、公开发布及品牌法务审查都属于后续工作。最终评审状态为 **ACCEPT WITH CHANGES，文档层已处理，等待实现门禁**。
