# dsh-werewolf

English | [中文](README.zh.md)

The deterministic Werewolf game runtime: `ctx.werewolf` definition registries, rule-set compilation, durable `werewolf/*` events, reducer, phase engine, Bot continuity, authorized projections, fixed per-game Bot Sessions, thin `ctx.games` adapter, and typed Host methods. The engine remains the only authority for role assignment, legal actions, effects, phases, and victory. The dedicated Web game view is provided by [`dsh-client-ui-werewolf`](../../client/ui-werewolf).

## What it does

- **Registries** — `ctx.werewolf` holds rule sets, roles, phases, and victory conditions keyed by exact `{ id, version }` (rule sets by `{ id, revision }`). Registration is an effect on the calling fiber; the returned disposer (or fiber disposal) removes exactly that registration. Duplicate identifiers at one version fail at registration.
- **Rule compilation** — `resolveWerewolfRuleSet(input, registry)` is the only path from JSON rule-set input to an immutable `WerewolfCompiledRuleSetV1`: strict parsing (unknown keys, unsafe integers, empty decks, closed unions all fail loud), registry resolution at exact versions, definition-owned option parsing, cross-field invariants, and a canonical-JSON SHA-256 digest. `parseWerewolfRuleSetInput` rejects a record before any game event exists.
- **Events** — nine log-only session events (`werewolf/game-started` … `werewolf/game-ended`) are the authoritative game record; see [docs/subsystems/werewolf.md](../../../docs/subsystems/werewolf.md) and the [persistence catalog](../../../docs/persistence-catalog.md). State-changing revisions are contiguous; `werewolf/bot-attempt-failed` changes none.
- **Reducer and engine** — `reduceWerewolfGame`/`applyWerewolfEvent` fold events into `WerewolfGameStateV1`; the pure engine steps (`startWerewolfGame`, `openNextWerewolfPhase`, `submitWerewolfHumanAction`, `commitWerewolfBotDecisions`, `resolveOpenWerewolfPhase`, `driveWerewolfGame`, `abortWerewolfGame`) compute the next events and fold them through the same reducer, so live play and replay share one path. Actions are validated against a closed spec vocabulary (`player-target`, `choice`, `text`, `compound`).
- **Bot continuity context** — every bot seat owns one subjective `WerewolfBotContextV1` under configured limits; `validateWerewolfBotContextDelta` and `applyWerewolfBotContextDelta` make each accepted decision an independent checkpoint (`contextAfter`) while the delta explains the permitted change. Profiles come from the deterministic `BOT_PROFILE_CATALOG` assignment.
- **Observation projection** — `projectWerewolfBotObservation` rejects a stale game, phase, rule digest, action plan, or bot context before constructing one decision's authorized view. Private knowledge comes from the actor's role projector (teammates only when the compiled role is entitled); public state contains roster ids and facts plus a bounded recent timeline; the legal action and continuity context come from the current folded state rather than caller-supplied copies. Nothing reads or serializes another role's private state.
- **Fixed Bot runner** — `WerewolfGameModule.initializeAgents()` provisions every non-human seat through `GameAiExecutor.provisionBot()` before `start()` returns. A deterministic child id, fixed identity persona, empty tool allowlist, optional model route, and optional `botReasoningEffort` remain attached to that Agent for the whole game. `runWerewolfBotDecision` sends each attempt through `turnBot()` in the same FIFO Session, states the exact phase-specific `action` object in the prompt, parses the assistant's JSON text, and validates the untrusted envelope action-first, including public-speech legality and bounds, then context delta. The prompt admits only the root keys `action` and `contextDelta`, treats a text action's `value` as the visible statement, and tells the Bot to return only changed context fields; this avoids format-guess retries and ensures an accepted statement reaches the public timeline. When a text-phase response has an invalid action object but carries an explicit legal `publicSpeech` string, the runner canonicalizes that string to `{ action: { value: publicSpeech } }` before validation, so an action-wrapper formatting error cannot discard an otherwise valid statement. Later decisions carry only public timeline entries added after that Bot's preceding committed decision, and a fixed-session retry carries the rejection diagnostic plus the same output contract without duplicating the observation. Retry exhaustion applies the configured fallback (trustee action or pause). The runner never appends events; the caller owns the durable game log.
- **Session Host adapter** — `WerewolfGameModule` registers on `ctx.games`; it folds the Host Session, commits human actions, initializes fixed Bots, enforces `maxConcurrentBots`, and schedules automatic work in the background one publication unit at a time. Start and human-action calls therefore return without waiting for every following model turn, while each committed Bot step invalidates the human projection. Seat-order discussion commits exactly one pending speaker at a time, derives visible speech from the accepted text action, exposes it on the public timeline, and cannot open the following vote phase until every speaker is settled. Only day-segment vote records enter that public timeline; night targeting, Bot context, and private reasoning remain private. `WerewolfGameGateway` exposes typed `start`, `getView`, `getReplay`, `submitAction`, `resume`, and `abortGame` methods. Requests never accept a Session id, player id, or seat.
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

Every Bot runs under one fixed per-game persona containing its immutable seat, role, faction, and personality data, plus `WEREWOLF_BOT_INSTRUCTIONS`. The required JSON has exactly the root keys `action` and `contextDelta`; the prompt spells out the current phase's exact action object, `legalAction.spec` enumerates its legal values, and the delta may contain only changed subjective fields. The first turn carries the serialized observation with bounded public history; later turns carry public entries added since that Bot's prior committed decision, current private knowledge, legal action, and canonical continuity context. Earlier Bot turns stay in the same Session, so later decisions also see their own actual statements and choices. A retried fixed-session attempt adds the rejection diagnostic and repeats the compact output contract without resending the observation.

#### Token effect

One Agent Session per Bot seat per game; token cost grows with that Bot's completed-turn history, while incremental public updates avoid repeating the same bounded timeline on every decision. The parent conversation is untouched — the Host model is never asked to interpret game input.

#### KV Cache effect

Each Bot can reuse its own stable persona and completed-turn prefix across decisions; sibling Bots and the Host have separate caches and histories.

## Known Limitations and Deferred Work

- **Replay presentation is checkpoint-indexed** — the dedicated Web view lists authorized revisions but does not yet scrub by day or phase. No slash command or Chat-composer mutation path is registered.
- **Local threat model only** — full role assignment and bot contexts sit in raw session storage for replay; version 1 prevents accidental disclosure through normal UI and prompt construction, not adversarial anti-cheat.
- **Announcement copy is keyed, not localized here** — resolutions record `key`/`data`; display copy and its localization are owned by the future view stage.
