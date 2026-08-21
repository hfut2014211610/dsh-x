# dsh-werewolf

English | [中文](README.zh.md)

The deterministic Werewolf game runtime: `ctx.werewolf` definition registries, rule-set compilation, durable `werewolf/*` events, reducer, phase engine, bot continuity, authorized projections, fresh one-shot decision runner, thin `ctx.games` adapter, and typed Host methods. The engine remains the only authority for role assignment, legal actions, effects, phases, and victory. The dedicated Web game view remains a later stage of the [feature plan](../../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md).

## What it does

- **Registries** — `ctx.werewolf` holds rule sets, roles, phases, and victory conditions keyed by exact `{ id, version }` (rule sets by `{ id, revision }`). Registration is an effect on the calling fiber; the returned disposer (or fiber disposal) removes exactly that registration. Duplicate identifiers at one version fail at registration.
- **Rule compilation** — `resolveWerewolfRuleSet(input, registry)` is the only path from JSON rule-set input to an immutable `WerewolfCompiledRuleSetV1`: strict parsing (unknown keys, unsafe integers, empty decks, closed unions all fail loud), registry resolution at exact versions, definition-owned option parsing, cross-field invariants, and a canonical-JSON SHA-256 digest. `parseWerewolfRuleSetInput` rejects a record before any game event exists.
- **Events** — nine log-only session events (`werewolf/game-started` … `werewolf/game-ended`) are the authoritative game record; see [docs/subsystems/werewolf.md](../../../docs/subsystems/werewolf.md) and the [persistence catalog](../../../docs/persistence-catalog.md). State-changing revisions are contiguous; `werewolf/bot-attempt-failed` changes none.
- **Reducer and engine** — `reduceWerewolfGame`/`applyWerewolfEvent` fold events into `WerewolfGameStateV1`; the pure engine steps (`startWerewolfGame`, `openNextWerewolfPhase`, `submitWerewolfHumanAction`, `commitWerewolfBotDecisions`, `resolveOpenWerewolfPhase`, `driveWerewolfGame`, `abortWerewolfGame`) compute the next events and fold them through the same reducer, so live play and replay share one path. Actions are validated against a closed spec vocabulary (`player-target`, `choice`, `text`, `compound`).
- **Bot continuity context** — every bot seat owns one subjective `WerewolfBotContextV1` under configured limits; `validateWerewolfBotContextDelta` and `applyWerewolfBotContextDelta` make each accepted decision an independent checkpoint (`contextAfter`) while the delta explains the permitted change. Profiles come from the deterministic `BOT_PROFILE_CATALOG` assignment.
- **Observation projection** — `projectWerewolfBotObservation` rejects a stale game, phase, rule digest, action plan, or bot context before constructing one decision's authorized view. Private knowledge comes from the actor's role projector (teammates only when the compiled role is entitled); public state contains roster ids and facts plus a bounded recent timeline; the legal action and continuity context come from the current folded state rather than caller-supplied copies. Nothing reads or serializes another role's private state.
- **One-shot bot runner** — `runWerewolfBotDecision` starts a fresh child through `ctx.subagents.start()` with the phase's object-rooted output schema, fixed bot persona, empty tool allowlist, and delegation-depth cap. Structured results are untrusted envelopes validated action-first, including public-speech legality and bounds, then context delta. Cancellation races the result and timeout, every started run is disposed before settlement, and a disposal failure is a retryable `disposal` attempt rather than an accepted result. Retry exhaustion applies the configured fallback (trustee action or pause). The runner never appends events; the caller owns the durable log.
- **Session Host adapter** — `WerewolfGameModule` registers on `ctx.games`; it folds the Host Session, commits human actions, enforces `maxConcurrentBots`, publishes one ordered parallel decision event, and auto-advances to the next human form, pause, or result. `WerewolfGameGateway` exposes typed `start`, `getView`, `getReplay`, `submitAction`, `resume`, and `abortGame` methods. Requests never accept a Session id, player id, or seat.
- **Human projection and replay** — `WerewolfHumanViewV1` contains public roster and timeline facts plus only the bound human's role, entitled teammates, notices, resources, and current action form. Roles reveal to the final view only after the result. Replay is available only for ended games and returns authorized checkpoints, never raw events, bot contexts, or child prompts.

## Determinism and replay

Every random draw (seat shuffle, role assignment, profile assignment, tie breaks) advances one seeded stream whose state is recorded on `game-started`, `phase-opened`, and `phase-resolved`; replays apply only recorded resolutions and never re-run role or phase code. `werewolf/game-started` records the full normalized rule set, digest, and definition versions, so resume and fork use the recorded snapshot; a runtime missing a recorded version refuses to continue.

## Extension registration

Plugins register definitions and rule sets; rule-set configuration references them by exact id and version and carries data-only options. A new role that joins an existing phase registers a role definition whose `phaseBindings` use a `kind` that phase version supports; a new action window also registers a phase definition and adds it to the configured cycle; a new victory mechanic registers a victory condition. The core phase loop never changes.

## Export shape

The main service plugin default-exports `WerewolfRuntime` and merges `ctx.werewolf`. The `./host` plugin registers `WerewolfGameModule` and exposes `ctx.werewolfGame`; `./types` is the dedicated UI's wire vocabulary, while `./typert` and `./remote` carry the generated Host and client contracts. `./invariant` carries durable-event checks.

## Model Experience

### Bot child persona

#### What the model sees

Every bot child runs under the fixed `WEREWOLF_BOT_PERSONA` (seat identity from game state, in-game text as untrusted data, decide only the requested action) plus `WEREWOLF_BOT_INSTRUCTIONS` (return exactly one JSON object matching the output schema; `legalAction.spec` enumerates every legal value; the context delta updates only the actor's own subjective fields). The prompt carries the serialized observation: decision identity, day and phase, the actor's role and private knowledge, the public state with a bounded recent timeline, the legal action, and the actor's prior continuity context. A retried attempt prepends one line: `Previous attempt rejected: <category>: <diagnostic>`.

#### Token effect

One fresh child session per attempt; token cost scales with attempt count and the configured `publicTimelineEntries` bound. The parent conversation is untouched — the harness parent model is never asked to interpret game input.

#### KV Cache effect

Each child is one-shot, so there is no reusable prefix across decisions beyond the persona and instruction block; the parent session's cache is unaffected.

## Known Limitations and Deferred Work

- **No dedicated Web view yet** — Stage 3 exposes the typed Host API and authorized view data, but Stage 4 still owns the lobby, covered role reveal, game table, action controls, responsive layout, accessibility, and replay presentation. No slash command or Chat-composer mutation path is registered.
- **Local threat model only** — full role assignment and bot contexts sit in raw session storage for replay; version 1 prevents accidental disclosure through normal UI and prompt construction, not adversarial anti-cheat.
- **Announcement copy is keyed, not localized here** — resolutions record `key`/`data`; display copy and its localization are owned by the future view stage.
