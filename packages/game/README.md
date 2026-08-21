# game/ — deterministic game-domain runtimes

English | [中文](README.zh.md)

Hidden-role game engines that keep authoritative state in the session log. The engine — never a model — owns rules, secrecy, legality, and victory; model-backed bots arrive as one-shot structured-output subagents in later delivery stages.

| Package | Role | ctx key |
|---|---|---|
| [`werewolf/`](werewolf/README.md) | The Werewolf core: definition registries, rule-set compilation, durable `werewolf/*` events, reducer, pure phase engine, and bot continuity context. | `ctx.werewolf` |
| [`werewolf-classic/`](werewolf-classic/README.md) | Classic villager/wolf/seer/witch roles, the standard night and day phases, faction victory conditions, and the `quick-7` rule set. | (registers on `ctx.werewolf`) |

The subsystem reference is [docs/subsystems/werewolf.md](../../docs/subsystems/werewolf.md); the design and staged delivery plan live in the [proposed feature note](../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md).
