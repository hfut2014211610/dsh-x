# dsh-werewolf

[English](README.md) | 中文

确定性狼人杀游戏运行时：`ctx.werewolf` 定义注册表、规则集编译、持久 `werewolf/*` 事件、reducer、阶段引擎、Bot 连续性、授权投影、整局固定的 Bot Session、`ctx.games` 薄适配器与类型化 Host 方法。角色分配、合法动作、效果、阶段和胜负仍只由引擎裁决。专用 Web 游戏视图由 [`dsh-client-ui-werewolf`](../../client/ui-werewolf) 提供。

## 它做什么

- **注册表** —— `ctx.werewolf` 持有规则集、角色、阶段、胜利条件四个注册表，以准确 `{ id, version }`（规则集为 `{ id, revision }`）为键。注册是调用方 fiber 上的 effect；返回的 disposer（或 fiber 处置）只移除该注册。同一版本下的重复标识符在注册时失败。
- **规则编译** —— `resolveWerewolfRuleSet(input, registry)` 是从 JSON 规则集输入到不可变 `WerewolfCompiledRuleSetV1` 的唯一路径：严格解析（未知键、不安全整数、空牌组、封闭联合都会大声失败）、按准确版本解析注册表、定义自有的选项解析、跨字段不变量，以及规范 JSON 的 SHA-256 摘要。`parseWerewolfRuleSetInput` 在任何游戏事件产生之前就拒绝非法记录。
- **事件** —— 九个 log-only 会话事件（`werewolf/game-started` … `werewolf/game-ended`）构成权威游戏记录；见 [docs/subsystems/werewolf.md](../../../docs/subsystems/werewolf.zh.md) 与[持久化目录](../../../docs/persistence-catalog.zh.md)。会改变状态的修订连续；`werewolf/bot-attempt-failed` 不改变修订。
- **Reducer 与引擎** —— `reduceWerewolfGame`/`applyWerewolfEvent` 把事件折叠为 `WerewolfGameStateV1`；纯引擎步骤（`startWerewolfGame`、`openNextWerewolfPhase`、`submitWerewolfHumanAction`、`commitWerewolfBotDecisions`、`resolveOpenWerewolfPhase`、`driveWerewolfGame`、`abortWerewolfGame`）计算下一批事件并用同一 reducer 折叠，因此实况对局与回放共用一条路径。动作按封闭规格词汇（`player-target`、`choice`、`text`、`compound`）校验。
- **Bot 连续性上下文** —— 每个 Bot 座位在配置限制下拥有一份主观 `WerewolfBotContextV1`；`validateWerewolfBotContextDelta` 与 `applyWerewolfBotContextDelta` 让每个被接受的决策成为独立检查点（`contextAfter`），增量则解释允许发生的变化。档案来自确定性的 `BOT_PROFILE_CATALOG` 分配。
- **观察投影** —— `projectWerewolfBotObservation` 在构造单次决策的授权视图前，拒绝过期的游戏、阶段、规则摘要、动作计划或 Bot 上下文。私有知识来自行动者角色投影器（仅当编译角色有权时才包含队友）；公开状态包含玩家 id、名册事实与有限近期时间线；合法动作与连续性上下文取自当前折叠状态，而非调用方携带的副本。任何路径都不会读取或序列化其他角色的私有状态。
- **固定 Bot 运行器** —— `WerewolfGameModule.initializeAgents()` 在 `start()` 返回前，通过 `GameAiExecutor.provisionBot()` 为每个非真人座位建好 Agent。确定性的子 Session id、固定身份 persona、空工具允许列表、可选模型路由与可选 `botReasoningEffort` 在整局内保持不变。`runWerewolfBotDecision` 把每次尝试经 `turnBot()` 依次送进同一个 Session，在 prompt 中明确当前阶段准确的 `action` 对象，解析助手返回的 JSON 文本，再把不可信信封按动作优先顺序校验（包括公开发言合法性与长度），最后校验上下文增量。prompt 只允许根键 `action` 与 `contextDelta`，把文本动作的 `value` 作为界面可见发言，并要求 Bot 只返回发生变化的上下文字段；这样可避免因猜测格式产生的重试，并确保已接受发言进入公开时间线。如果文本阶段的动作对象非法，但响应携带显式且合法的 `publicSpeech` 字符串，运行器会在校验前把它规范为 `{ action: { value: publicSpeech } }`，避免动作包装格式错误丢弃本来合法的发言。后续决策只携带该 Bot 上一次已提交决策之后新增的公开时间线；固定 Session 的重试携带拒绝诊断和同一输出约定，不重复观察。重试耗尽后应用托管动作或暂停。运行器不追加事件；调用方持有持久游戏日志。
- **Session Host 适配器** —— `WerewolfGameModule` 注册到 `ctx.games`；它折叠 Host Session、提交真人动作、初始化固定 Bot、执行 `maxConcurrentBots`，并在后台按发布单元逐步调度自动工作。因此开始与真人动作调用无需等待后续所有模型轮次，每个已提交 Bot 步骤都会使真人投影失效。按座位发言阶段每次只结算当前一位，从已接受的文本动作提取可见发言并写入公开时间线；全部发言者完成前不能打开随后投票阶段。只有白天阶段的投票记录会进入该公开时间线；夜间选人、Bot 上下文和私密推理始终保持私密。`WerewolfGameGateway` 暴露类型化 `start`、`getView`、`getReplay`、`submitAction`、`resume`、`abortGame`。请求从不接受 Session id、player id 或座位。
- **真人投影与回放** —— `WerewolfHumanViewV1` 包含公开名册与时间线，以及仅属于绑定真人的角色、获授权队友、通知、资源和当前动作表单。角色只在结果产生后进入最终公开视图。回放仅对已结束游戏可用，返回授权检查点，绝不返回原始事件、Bot 上下文或子代理 prompt。

## 确定性与回放

每次随机抽取（座位洗牌、角色分配、档案分配、平票裁决）都推进同一条种子流，其状态记录在 `game-started`、`phase-opened`、`phase-resolved` 上；回放只应用已记录结算，绝不重新运行角色或阶段代码。`werewolf/game-started` 记录完整规范化规则集、摘要与定义版本，因此恢复与 fork 使用已记录快照；缺少已记录版本的运行时拒绝继续。

## 扩展注册

插件注册定义与规则集；规则集配置以准确 id 和版本引用它们，并携带纯数据选项。加入已有阶段的新角色注册一个角色定义，其 `phaseBindings` 使用该阶段版本支持的 `kind`；新行动窗口还需注册阶段定义并将其加入配置周期；新胜利机制注册胜利条件。核心阶段循环从不改变。

## 导出形态

主服务插件 default 导出 `WerewolfRuntime` 并合并 `ctx.werewolf`。`./host` 插件注册 `WerewolfGameModule` 并暴露 `ctx.werewolfGame`；`./types` 是专用 UI 的线上类型词汇，`./typert` 与 `./remote` 携带生成的 Host 与客户端约定。`./invariant` 携带持久事件检查。

## 模型体验

### Bot 子代理 persona

#### 模型看到什么

每个 Bot 在一份整局固定的 persona 下运行，其中包含不可变的座位、角色、阵营与性格数据，并附带 `WEREWOLF_BOT_INSTRUCTIONS`。所需 JSON 恰好包含根键 `action` 与 `contextDelta`；prompt 明确当前阶段准确的动作对象，`legalAction.spec` 枚举它的合法值，上下文增量只能包含发生变化的主观字段。第一个 turn 携带含有限公开历史的序列化观察；后续 turn 携带自该 Bot 上次已提交决策后新增的公开记录、当前私有知识、合法动作与规范连续性上下文。更早的 Bot turn 留在同一 Session，因此后续决策也能看到自己实际说过的话和做过的选择。固定 Session 的重试追加拒绝诊断并重复精简输出约定，不重新发送观察。

#### Token 影响

每局每个 Bot 座位只有一个 Agent Session；token 成本随该 Bot 已完成的 turn 历史增长，而增量公开更新不会在每次决策重复同一段有限时间线。父对话不受影响——Host 模型从不被要求解释游戏输入。

#### KV Cache 影响

每个 Bot 可在多次决策之间复用自己的固定 persona 与已完成 turn 前缀；兄弟 Bot 和 Host 的历史与缓存相互隔离。

## 已知限制与遗留工作

- **复盘展示按检查点索引** —— 专用 Web 视图会列出授权修订，但尚不能按天或阶段拖动查看。不注册斜杠命令或 Chat composer 变更路径。
- **仅本地威胁模型** —— 为支持回放，完整角色分配与 Bot 上下文存于原始会话存储；阶段1防止通过正常 UI 与 prompt 构造意外泄密，不承诺对抗性防作弊。
- **公告文案是键，不在此本地化** —— 结算记录 `key`/`data`；展示文案及其本地化由未来的视图阶段负责。
