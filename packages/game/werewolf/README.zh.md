# dsh-werewolf

[English](README.md) | 中文

确定性狼人杀游戏运行时：`ctx.werewolf` 定义注册表、规则集编译、持久 `werewolf/*` 事件、reducer、阶段引擎、Bot 连续性、授权投影、fresh one-shot 决策运行器、`ctx.games` 薄适配器与类型化 Host 方法。角色分配、合法动作、效果、阶段和胜负仍只由引擎裁决。专用 Web 游戏视图属于[特性计划](../../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md)的后续阶段。

## 它做什么

- **注册表** —— `ctx.werewolf` 持有规则集、角色、阶段、胜利条件四个注册表，以准确 `{ id, version }`（规则集为 `{ id, revision }`）为键。注册是调用方 fiber 上的 effect；返回的 disposer（或 fiber 处置）只移除该注册。同一版本下的重复标识符在注册时失败。
- **规则编译** —— `resolveWerewolfRuleSet(input, registry)` 是从 JSON 规则集输入到不可变 `WerewolfCompiledRuleSetV1` 的唯一路径：严格解析（未知键、不安全整数、空牌组、封闭联合都会大声失败）、按准确版本解析注册表、定义自有的选项解析、跨字段不变量，以及规范 JSON 的 SHA-256 摘要。`parseWerewolfRuleSetInput` 在任何游戏事件产生之前就拒绝非法记录。
- **事件** —— 九个 log-only 会话事件（`werewolf/game-started` … `werewolf/game-ended`）构成权威游戏记录；见 [docs/subsystems/werewolf.md](../../../docs/subsystems/werewolf.md) 与[持久化目录](../../../docs/persistence-catalog.md)。会改变状态的修订连续；`werewolf/bot-attempt-failed` 不改变修订。
- **Reducer 与引擎** —— `reduceWerewolfGame`/`applyWerewolfEvent` 把事件折叠为 `WerewolfGameStateV1`；纯引擎步骤（`startWerewolfGame`、`openNextWerewolfPhase`、`submitWerewolfHumanAction`、`commitWerewolfBotDecisions`、`resolveOpenWerewolfPhase`、`driveWerewolfGame`、`abortWerewolfGame`）计算下一批事件并用同一 reducer 折叠，因此实况对局与回放共用一条路径。动作按封闭规格词汇（`player-target`、`choice`、`text`、`compound`）校验。
- **Bot 连续性上下文** —— 每个 Bot 座位在配置限制下拥有一份主观 `WerewolfBotContextV1`；`validateWerewolfBotContextDelta` 与 `applyWerewolfBotContextDelta` 让每个被接受的决策成为独立检查点（`contextAfter`），增量则解释允许发生的变化。档案来自确定性的 `BOT_PROFILE_CATALOG` 分配。
- **观察投影** —— `projectWerewolfBotObservation` 在构造单次决策的授权视图前，拒绝过期的游戏、阶段、规则摘要、动作计划或 Bot 上下文。私有知识来自行动者角色投影器（仅当编译角色有权时才包含队友）；公开状态包含玩家 id、名册事实与有限近期时间线；合法动作与连续性上下文取自当前折叠状态，而非调用方携带的副本。任何路径都不会读取或序列化其他角色的私有状态。
- **One-shot Bot 运行器** —— `runWerewolfBotDecision` 通过 `ctx.subagents.start()` 启动全新子代理，携带该阶段的对象根输出 schema、固定 Bot persona、空工具允许列表与委派深度上限。结构化结果作为不可信信封先校验动作（包括公开发言的阶段合法性与长度），再校验上下文增量。取消会与结果及超时直接竞速；每个已启动子代理都在收束前完成 dispose，dispose 失败作为可重试的 `disposal` 尝试记录，不会接受其结果。重试耗尽后应用配置的兜底（托管动作或暂停）。运行器绝不追加事件；调用方持有持久日志。
- **Session Host 适配器** —— `WerewolfGameModule` 注册到 `ctx.games`；它折叠 Host Session、提交真人动作、执行 `maxConcurrentBots`、发布一个有序并行决策事件，并自动推进到下一真人表单、暂停或结果。`WerewolfGameGateway` 暴露类型化 `start`、`getView`、`getReplay`、`submitAction`、`resume`、`abortGame`。请求从不接受 Session id、player id 或座位。
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

每个 Bot 子代理在固定的 `WEREWOLF_BOT_PERSONA`（座位身份来自游戏状态、局内文本为不可信数据、只决定当前请求的动作）与 `WEREWOLF_BOT_INSTRUCTIONS`（恰好返回一个匹配输出 schema 的 JSON 对象；`legalAction.spec` 枚举全部合法值；上下文增量只更新自己的主观字段）下运行。prompt 携带序列化观察：决策标识、天数与阶段、行动者角色与私有知识、含有限近期时间线的公开状态、合法动作，以及该行动者的先前连续性上下文。重试尝试前prepend一行：`Previous attempt rejected: <category>: <diagnostic>`。

#### Token 影响

每次尝试一个全新子代理会话；token 成本随尝试次数与配置的 `publicTimelineEntries` 上限增长。父对话不受影响——父模型从不被要求解释游戏输入。

#### KV Cache 影响

每个子代理都是 one-shot，除 persona 与指令块外没有可复用前缀；父会话的缓存不受影响。

## 已知限制与遗留工作

- **尚无专用 Web 视图** —— 阶段3已暴露类型化 Host API 与授权视图数据，但大厅、遮罩角色揭示、游戏桌、动作控件、响应式、可访问性和回放展示仍由阶段4负责。不注册斜杠命令或 Chat composer 变更路径。
- **仅本地威胁模型** —— 为支持回放，完整角色分配与 Bot 上下文存于原始会话存储；阶段1防止通过正常 UI 与 prompt 构造意外泄密，不承诺对抗性防作弊。
- **公告文案是键，不在此本地化** —— 结算记录 `key`/`data`；展示文案及其本地化由未来的视图阶段负责。
