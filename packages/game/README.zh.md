# game/ — 确定性游戏领域运行时

[English](README.md) | 中文

以会话日志保存权威状态的隐藏身份游戏引擎。规则、保密、合法性与胜负由引擎——而非模型——持有；模型驱动的 Bot 在后续交付阶段以 one-shot 结构化输出子代理的形式接入。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`werewolf/`](werewolf/README.md) | 狼人杀核心：定义注册表、规则集编译、持久 `werewolf/*` 事件、reducer、纯函数阶段引擎与 Bot 连续性上下文。 | `ctx.werewolf` |
| [`werewolf-classic/`](werewolf-classic/README.md) | 经典平民/狼人/预言家/女巫角色、标准夜晚与白天阶段、阵营胜利条件与 `quick-7` 规则集。 | （注册到 `ctx.werewolf`） |

子系统参考见 [docs/subsystems/werewolf.md](../../docs/subsystems/werewolf.md)；设计与分阶段交付计划位于[提案笔记](../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md)。
