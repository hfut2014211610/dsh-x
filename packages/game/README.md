# game/ — deterministic game-domain runtimes

English | [中文](README.zh.md)

Game capabilities and hidden-role engines that keep authoritative state in the session log. The engine — never a model — owns rules, secrecy, legality, and victory; model-backed Bots use one hidden, game-owned Agent Session per seat for the whole game.

| Package | Role | ctx key |
|---|---|---|
| [`game/`](game/README.md) | Reusable Session Host: module registry, dedicated Agent/Session ownership, atomic command batches, principal binding, projection invalidation, and AI scheduling. | `ctx.games` |
| [`werewolf/`](werewolf/README.md) | The Werewolf core: definition registries, rule-set compilation, durable `werewolf/*` events, reducer, pure phase engine, and bot continuity context. | `ctx.werewolf` |
| [`werewolf-classic/`](werewolf-classic/README.md) | Classic villager/wolf/seer/witch roles, the standard night and day phases, faction victory conditions, and the `quick-7` rule set. | (registers on `ctx.werewolf`) |
| [`../client/ui-werewolf/`](../client/ui-werewolf/README.md) | The isolated game-window UI: launcher, resumable lobby, covered reveal, table, generic action forms, spectator, result, and authorized replay. | `sidebar.footer.action` + `shell.surface` |

The subsystem reference is [docs/subsystems/werewolf.md](../../docs/subsystems/werewolf.md); the shipped window, Host, and Bot ownership decision is recorded in the [implemented feature note](../../.agents/notes/implemented/feature/2026-08-24-isolated-werewolf-application.md).
