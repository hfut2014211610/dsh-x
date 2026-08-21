# dsh-werewolf-classic

English | [中文](README.zh.md)

The classic Werewolf definitions: villager, wolf, seer, and witch roles, the standard night and day phases, the faction victory conditions, and the `quick-7` rule set. Everything registers on [`ctx.werewolf`](../../game/werewolf/README.md); the package owns no engine code and no model-visible surface.

## What it does

- **Roles v1** — `villager` (no night action), `wolf` (sees faction teammates; required binding to `night.wolf-kill`), `seer` (required binding to `night.seer-inspect`; role state records completed checks), `witch` (required binding to `night.witch`; options `antidoteUses`, `poisonUses`, `selfSave: 'first-night-only' | 'never'`, each strictly parsed). Factions are `village` and `wolf`.
- **Phases v1** — `night.wolf-kill` (parallel-private; wolves pick a living non-wolf, disagreement resolves by the `wolfTie` policy), `night.seer-inspect` (parallel-private; skips when the seer is dead), `night.witch` (parallel-private; skips when the witch is dead or out of potions; self-save honors its option), `day.announce` (zero actors; synthesizes dawn deaths from the night's outcomes), `day.discussion` (seat-order-public; text speeches bounded by `speechMaxChars`), `day.vote` (parallel-private, repeatable; a tie reports `voteOutcome` for the engine's `voteTie` policy, and a revote restricts targets to the tied players).
- **Victory v1** — `faction-elimination` (one faction remains) and `wolf-parity` (options `wolfFaction`, default `wolf`; wolves reach parity).
- **`quick-7`** — the shipped rule-set input: 2 wolves, 1 seer, 1 witch (default options), 3 villagers; night `wolf-kill → seer-inspect → witch`; day `announce → discussion → vote`; both victory conditions at priority 10; `voteTie: revote-once`, `wolfTie: seeded-random`, `deadHuman: spectate`, `maxDays: 8`, `speechMaxChars: 160`.

## Extension registration

The plugin is a function plugin (`name`, `inject: ['werewolf']`, `apply`) that registers every definition and the rule set; there is no default export, so the Loader keeps the injection metadata. Compositions that want the classic game mount `dsh-werewolf` and this package; rule sets may also reference these definitions from their own configured inputs.

## Known Limitations and Deferred Work

- **No sheriff, hunter, or guard roles** — the extension contracts admit them; this package ships only the quick-7 roster ([feature note scope](../../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md)).
- **Display copy is keyed English** — role `publicName`s and announcement keys are stable strings; localization arrives with the view stage.
- **No death-side role reveal** — deaths announce without revealing the victim's role; a reveal variant would be a new rule-set configuration over an extended announce phase, not an engine change.
