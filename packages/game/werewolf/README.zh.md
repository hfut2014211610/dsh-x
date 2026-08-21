# dsh-werewolf

[English](README.md) | 中文

确定性狼人杀游戏核心：`ctx.werewolf` 定义注册表、规则集编译、持久 `werewolf/*` 会话事件、事件 reducer、纯函数阶段引擎与 Bot 连续性上下文。引擎是角色分配、合法动作、效果应用、阶段转换与胜负的唯一权威；模型驱动的 Bot、会话投影与游戏视图随[特性笔记](../../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md)的后续交付阶段到来。

## 它做什么

- **注册表** —— `ctx.werewolf` 持有规则集、角色、阶段、胜利条件四个注册表，以准确 `{ id, version }`（规则集为 `{ id, revision }`）为键。注册是调用方 fiber 上的 effect；返回的 disposer（或 fiber 处置）只移除该注册。同一版本下的重复标识符在注册时失败。
- **规则编译** —— `resolveWerewolfRuleSet(input, registry)` 是从 JSON 规则集输入到不可变 `WerewolfCompiledRuleSetV1` 的唯一路径：严格解析（未知键、不安全整数、空牌组、封闭联合都会大声失败）、按准确版本解析注册表、定义自有的选项解析、跨字段不变量，以及规范 JSON 的 SHA-256 摘要。`parseWerewolfRuleSetInput` 在任何游戏事件产生之前就拒绝非法记录。
- **事件** —— 九个 log-only 会话事件（`werewolf/game-started` … `werewolf/game-ended`）构成权威游戏记录；见 [docs/subsystems/werewolf.md](../../../docs/subsystems/werewolf.md) 与[持久化目录](../../../docs/persistence-catalog.md)。会改变状态的修订连续；`werewolf/bot-attempt-failed` 不改变修订。
- **Reducer 与引擎** —— `reduceWerewolfGame`/`applyWerewolfEvent` 把事件折叠为 `WerewolfGameStateV1`；纯引擎步骤（`startWerewolfGame`、`openNextWerewolfPhase`、`submitWerewolfHumanAction`、`commitWerewolfBotDecisions`、`resolveOpenWerewolfPhase`、`driveWerewolfGame`、`abortWerewolfGame`）计算下一批事件并用同一 reducer 折叠，因此实况对局与回放共用一条路径。动作按封闭规格词汇（`player-target`、`choice`、`text`、`compound`）校验。
- **Bot 连续性上下文** —— 每个 Bot 座位在配置限制下拥有一份主观 `WerewolfBotContextV1`；`validateWerewolfBotContextDelta` 与 `applyWerewolfBotContextDelta` 让每个被接受的决策成为独立检查点（`contextAfter`），增量则解释允许发生的变化。档案来自确定性的 `BOT_PROFILE_CATALOG` 分配。

## 确定性与回放

每次随机抽取（座位洗牌、角色分配、档案分配、平票裁决）都推进同一条种子流，其状态记录在 `game-started`、`phase-opened`、`phase-resolved` 上；回放只应用已记录结算，绝不重新运行角色或阶段代码。`werewolf/game-started` 记录完整规范化规则集、摘要与定义版本，因此恢复与 fork 使用已记录快照；缺少已记录版本的运行时拒绝继续。

## 扩展注册

插件注册定义与规则集；规则集配置以准确 id 和版本引用它们，并携带纯数据选项。加入已有阶段的新角色注册一个角色定义，其 `phaseBindings` 使用该阶段版本支持的 `kind`；新行动窗口还需注册阶段定义并将其加入配置周期；新胜利机制注册胜利条件。核心阶段循环从不改变。

## 导出形态

服务插件：default 导出 `WerewolfRuntime`，并把 `ctx.werewolf` 合并进 Cordis `Context` 接口。`./invariant` 子路径携带持久事件不变量伴随插件；类型位于 `src/types.ts`。

## 已知限制与遗留工作

- **尚无 Bot 运行器或真人投影** —— 阶段1是确定性核心；one-shot Bot 运行器、真人授权投影、Typert remote 与专用 `werewolf` 会话视图随特性笔记的阶段 2–4 交付。本包不调用任何模型。
- **尚无运行时变更 API** —— 活跃会话上的 `start`/`submitAction`/`resume`/`abortGame`（带 `requestId`/`expectedGameRevision` 幂等）随阶段3运行时落地；载荷字段与 reducer 的幂等键索引已就位。
- **仅本地威胁模型** —— 为支持回放，完整角色分配与 Bot 上下文存于原始会话存储；阶段1防止通过正常 UI 与 prompt 构造意外泄密，不承诺对抗性防作弊。
- **公告文案是键，不在此本地化** —— 结算记录 `key`/`data`；展示文案及其本地化由未来的视图阶段负责。
