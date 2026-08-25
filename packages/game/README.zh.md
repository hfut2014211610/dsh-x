# game/ — 确定性游戏领域运行时

[English](README.md) | 中文

以会话日志保存权威状态的游戏 capability 与隐藏身份引擎。规则、保密、合法性与胜负由引擎——而非模型——持有；每个模型驱动的 Bot 座位在整局中复用一个由游戏持有、且不进入通用子代理目录的 Agent Session。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`game/`](game/README.zh.md) | 通用 Session Host：模块注册表、专用 Agent/Session 所有权、原子命令批次、主体绑定、投影失效与 AI 调度。 | `ctx.games` |
| [`werewolf/`](werewolf/README.zh.md) | 狼人杀核心：定义注册表、规则集编译、持久 `werewolf/*` 事件、reducer、纯函数阶段引擎与 Bot 连续性上下文。 | `ctx.werewolf` |
| [`werewolf-classic/`](werewolf-classic/README.zh.md) | 经典平民/狼人/预言家/女巫角色、标准夜晚与白天阶段、阵营胜利条件与 `quick-7` 规则集。 | （注册到 `ctx.werewolf`） |
| [`../client/ui-werewolf/`](../client/ui-werewolf/README.zh.md) | 专用浏览器视图：大厅、遮盖揭示、游戏桌、通用动作表单、观战、结算与授权复盘。 | `conversation.view` 条目 `werewolf` |

子系统参考见 [docs/subsystems/werewolf.md](../../docs/subsystems/werewolf.zh.md)；专用 Web 游戏视图仍在[分阶段特性计划](../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.zh.md)中。
