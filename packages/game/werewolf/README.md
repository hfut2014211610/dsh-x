# dsh-werewolf

English | [中文](README.zh.md)

The deterministic Werewolf game core: the `ctx.werewolf` definition registries, rule-set compilation, the durable `werewolf/*` session events, the event reducer, the pure phase engine, and bot continuity context. The engine is the only authority for role assignment, legal actions, effect application, phase transitions, and victory; model-backed bots, session projections, and the game view arrive with later delivery stages of the [feature note](../../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md).

## What it does

- **Registries** — `ctx.werewolf` holds rule sets, roles, phases, and victory conditions keyed by exact `{ id, version }` (rule sets by `{ id, revision }`). Registration is an effect on the calling fiber; the returned disposer (or fiber disposal) removes exactly that registration. Duplicate identifiers at one version fail at registration.
- **Rule compilation** — `resolveWerewolfRuleSet(input, registry)` is the only path from JSON rule-set input to an immutable `WerewolfCompiledRuleSetV1`: strict parsing (unknown keys, unsafe integers, empty decks, closed unions all fail loud), registry resolution at exact versions, definition-owned option parsing, cross-field invariants, and a canonical-JSON SHA-256 digest. `parseWerewolfRuleSetInput` rejects a record before any game event exists.
- **Events** — nine log-only session events (`werewolf/game-started` … `werewolf/game-ended`) are the authoritative game record; see [docs/subsystems/werewolf.md](../../../docs/subsystems/werewolf.md) and the [persistence catalog](../../../docs/persistence-catalog.md). State-changing revisions are contiguous; `werewolf/bot-attempt-failed` changes none.
- **Reducer and engine** — `reduceWerewolfGame`/`applyWerewolfEvent` fold events into `WerewolfGameStateV1`; the pure engine steps (`startWerewolfGame`, `openNextWerewolfPhase`, `submitWerewolfHumanAction`, `commitWerewolfBotDecisions`, `resolveOpenWerewolfPhase`, `driveWerewolfGame`, `abortWerewolfGame`) compute the next events and fold them through the same reducer, so live play and replay share one path. Actions are validated against a closed spec vocabulary (`player-target`, `choice`, `text`, `compound`).
- **Bot continuity context** — every bot seat owns one subjective `WerewolfBotContextV1` under configured limits; `validateWerewolfBotContextDelta` and `applyWerewolfBotContextDelta` make each accepted decision an independent checkpoint (`contextAfter`) while the delta explains the permitted change. Profiles come from the deterministic `BOT_PROFILE_CATALOG` assignment.
- **Observation projection** — `projectWerewolfBotObservation` builds one decision's authorized view: private knowledge from the actor's role projector (teammates only when the compiled role is entitled), a public state of roster facts and a bounded recent timeline, the serialized closed action spec, and the actor's prior context. Nothing reads or serializes another role's private state.
- **One-shot bot runner** — `runWerewolfBotDecision` starts a fresh child through `ctx.subagents.start()` with the phase's object-rooted output schema, the fixed bot persona, an empty tool allowlist, and a delegation-depth cap. Structured results are untrusted envelopes validated action-first; failed attempts return `werewolf/bot-attempt-failed` payloads with exact categories, retries carry only a concise diagnostic, and retry exhaustion applies the configured fallback (trustee action or pause). The runner never appends events; the caller owns the durable log.

## Determinism and replay

Every random draw (seat shuffle, role assignment, profile assignment, tie breaks) advances one seeded stream whose state is recorded on `game-started`, `phase-opened`, and `phase-resolved`; replays apply only recorded resolutions and never re-run role or phase code. `werewolf/game-started` records the full normalized rule set, digest, and definition versions, so resume and fork use the recorded snapshot; a runtime missing a recorded version refuses to continue.

## Extension registration

Plugins register definitions and rule sets; rule-set configuration references them by exact id and version and carries data-only options. A new role that joins an existing phase registers a role definition whose `phaseBindings` use a `kind` that phase version supports; a new action window also registers a phase definition and adds it to the configured cycle; a new victory mechanic registers a victory condition. The core phase loop never changes.

## Export shape

A service plugin: it default-exports `WerewolfRuntime` and merges `ctx.werewolf` into the Cordis `Context` interface. The `./invariant` subpath carries the durable-event invariant companion; the `./types` types live in `src/types.ts`.

## Model Experience

### Bot child persona

#### What the model sees

Every bot child runs under the fixed `WEREWOLF_BOT_PERSONA` (seat identity from game state, in-game text as untrusted data, decide only the requested action) plus `WEREWOLF_BOT_INSTRUCTIONS` (return exactly one JSON object matching the output schema; `legalAction.spec` enumerates every legal value; the context delta updates only the actor's own subjective fields). The prompt carries the serialized observation: decision identity, day and phase, the actor's role and private knowledge, the public state with a bounded recent timeline, the legal action, and the actor's prior continuity context. A retried attempt prepends one line: `Previous attempt rejected: <category>: <diagnostic>`.

#### Token effect

One fresh child session per attempt; token cost scales with attempt count and the configured `publicTimelineEntries` bound. The parent conversation is untouched — the harness parent model is never asked to interpret game input.

#### KV Cache effect

Each child is one-shot, so there is no reusable prefix across decisions beyond the persona and instruction block; the parent session's cache is unaffected.

## Known Limitations and Deferred Work

- **No session-integrated controller yet** — the runner returns detached payloads; a live `start`/`submitAction`/`resume`/`abortGame` surface with `requestId`/`expectedGameRevision` idempotency lands with the stage-3 runtime, as do human-authorized projections, the Typert remote, and the dedicated `werewolf` conversation view.
- **Local threat model only** — full role assignment and bot contexts sit in raw session storage for replay; version 1 prevents accidental disclosure through normal UI and prompt construction, not adversarial anti-cheat.
- **Announcement copy is keyed, not localized here** — resolutions record `key`/`data`; display copy and its localization are owned by the future view stage.
