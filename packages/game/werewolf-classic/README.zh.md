# dsh-werewolf-classic

[English](README.md) | 中文

经典狼人杀定义：平民、狼人、预言家、女巫角色，标准夜晚与白天阶段，阵营胜利条件，以及 `quick-7` 规则集。全部注册到 [`ctx.werewolf`](../../game/werewolf/README.zh.md)；本包不含引擎代码，也没有模型可见面。

## 它做什么

- **角色 v1** —— `villager`（无夜间动作）、`wolf`（可见同阵营队友；对 `night.wolf-kill` 的 required 绑定）、`seer`（对 `night.seer-inspect` 的 required 绑定；角色状态记录已完成的查验）、`witch`（对 `night.witch` 的 required 绑定；选项 `antidoteUses`、`poisonUses`、`selfSave: 'first-night-only' | 'never'`，均严格解析）。阵营为 `village` 与 `wolf`。
- **阶段 v1** —— `night.wolf-kill`（并行私密；狼人选择存活非狼，分歧按 `wolfTie` 策略结算）、`night.seer-inspect`（并行私密；预言家死亡时跳过）、`night.witch`（并行私密；女巫死亡或无药时跳过；自救遵守其选项）、`day.announce`（零行动者；从夜间结果合成黎明死亡）、`day.discussion`（座位顺序公开发言；文本受 `speechMaxChars` 限制）、`day.vote`（并行私密、可重复；平票向引擎报告 `voteOutcome` 以应用 `voteTie` 策略，重投目标限于平票玩家）。
- **胜利 v1** —— `faction-elimination`（只剩一个阵营）与 `wolf-parity`（选项 `wolfFaction`，默认 `wolf`；狼人达到均势）。
- **`quick-7`** —— 随包规则集输入：2 狼、1 预言家、1 女巫（默认选项）、3 平民；夜晚 `wolf-kill → seer-inspect → witch`；白天 `announce → discussion → vote`；两个胜利条件均为优先级 10；`voteTie: revote-once`、`wolfTie: seeded-random`、`deadHuman: spectate`、`maxDays: 8`、`speechMaxChars: 160`。

## 扩展注册

本包是函数插件（`name`、`inject: ['werewolf']`、`apply`），注册全部定义与规则集；没有 default 导出，Loader 因此保留注入元数据。需要经典对局的组合装配 `dsh-werewolf` 与本包；其他规则集也可在自己的配置输入中引用这些定义。

## 已知限制与遗留工作

- **无警长、猎人或守卫角色** —— 扩展约定可以接入它们；本包只交付 quick-7 阵容（[特性笔记范围](../../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.zh.md)）。
- **展示文案为英文键** —— 角色 `publicName` 与公告键是稳定字符串；本地化随视图阶段交付。
- **死亡不翻牌** —— 死亡公告不揭示受害者身份；翻牌变体将是扩展 announce 阶段之上的新规则集配置，而非引擎改动。
