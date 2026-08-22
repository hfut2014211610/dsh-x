# Agent Note: Werewolf stage 4 — the dedicated conversation view

Status: implemented

English | [中文](2026-08-21-werewolf-conversation-view.zh.md)

## Problem

Stages 1–3 delivered the deterministic engine, the initial bot runner, and the session-backed Host with a typed gateway — but the only surface into a game was a test harness. The proposal requires one dedicated view that owns lobby, covered role reveal, the table, generic human action forms, spectator, pause/resume, result, and replay, with no slash command and no Chat-composer mutation path. The view must also keep the Host model out of game input: no parent model request may result from a click.

## Decision

Stage 4 adds `@deepseek-ai/dsh-client-ui-werewolf`, a browser plugin in the ui-writing lineage, plus the composition that mounts it:

1. **The view is a projection consumer, not a state owner.** `WerewolfView` receives every value and verb through the slot's inject face, which wraps the generated `ctx.remote.werewolfGame` namespace (`getLobby`, `start`, `getView`, `submitAction`, `resume`, `abortGame`, `getReplay`) and unwraps `RemoteResult` into view values or thrown diagnostics that render as inline retryable errors. Revision checks reject older responses, while a same-phase refresh retains presentation-local drafts and selections. Retry reuses the original mutation's idempotency key and is suppressed when a reconciliation read shows that the phase already advanced.
2. **Refresh rides one forwarded event.** `game/projection-invalidated` joined `API_REMOTE_FORWARDED_EVENTS`; the view subscribes before its first read, ignores other games' ids, and re-reads via `getView`. The event carries no secret fields, so authorization stays entirely in the Host projector.
3. **Lobby needs a pre-game listing.** The gateway gained an additive `getLobby` remote returning the registered rule-set options sorted by `{ id, revision }` — the one host surface the lobby can call before any game exists.
4. **Client-safety forced three small host refactors.** `@deepseek-ai/dsh-game/types` no longer names Agent or subagent types (the executor contracts moved to a host-side `executor.ts` module), `@deepseek-ai/dsh-werewolf/types` now re-exports wire types from modules that never import the engine or the runtime class, and the projection's registry dependency became the structural `WerewolfRuleSetSource`. Without these, importing the generated remote's declarations dragged host-only modules into the client compilation face.
5. **Forms render the closed vocabulary only.** `player-target`, `choice`, `text`, and `compound` map to seat buttons, option radios, bounded textareas, and nested fieldsets; compound text fields keep independent drafts, required subfields gate submission, and visible pass or abstain controls send explicit null actions. `buildAction` and `fieldChoices` remain pure functions of the authoritative phase spec, including targets that a future role may legally select despite their current roster state.
6. **Composition and Host navigation are data.** The web-app bundle gained host rows (`dsh-game`, `dsh-werewolf`, `dsh-werewolf-classic`, `dsh-werewolf/host`) plus a browser row for the view. The `werewolf` agent preset contributes the Host persona. `GameModule.hostAgentPreset` stamps the dedicated `game-<GameId>` Host Session, so a successful start opens that Session and reopening it restores the game projection directly.
7. **Private findings remain projection-owned.** The browser marks a seat as known only when `view.self.notices` contains a matching target, and both the seat control and private pane open that authorized record. Built-in seer notices include their source day and reveal only faction, never an inferred role; configured notice kinds use a generic key/value presentation. Seven inlined neutral sigils distinguish seats without encoding role or faction.
8. **The game owns its ordinary input.** The composer chain receives the Host-confirmed `agentPreset`; the Werewolf entry elects an empty replacement for `werewolf` sessions after higher-priority question and approval takeovers. The game action form is therefore the only ordinary input, while pending system interactions remain answerable and other presets retain the default composer.
9. **Bot identity and daytime order are explicit runtime state.** Game start provisions one fixed, tool-free Agent Session for each non-human seat, and every decision or retry uses that seat's FIFO context for the whole game. Game Bot Sessions retain the Host parent id but omit the generic subagent origin descriptor, so native subagent navigation does not list or open them. A `seat-order-public` discussion commits exactly one statement at a time; the human projection exposes current speaker and progress, and the view renders completed statements or explicit passes before the vote can open. Only vote records resolved in the day segment enter the public timeline, so private night targeting cannot appear as an early vote.

## Consequences

- All eight product states are covered by jsdom behavior tests. Desktop/820px/390px DOM snapshots pin deterministic seat order and accessibility structure; responsive geometry and contrast still require a rendered-browser review because jsdom does not compute CSS layout.
- Accessibility is structural: radio groups with arrow-key selection, Escape clearing and `aria-checked`, live status and alert regions, non-color seat cues, 44px targets, visible focus, and phase-heading focus restoration after committed transitions.
- Finding tests pin known-seat derivation, detail switching, source-day rendering, generic notice fallback, and return to the private identity pane without widening the authorized projection.
- Composer-selection tests pin Werewolf acceptance and non-Werewolf decline, including removal on plugin disposal.
- Bot decisions never invoke the Host model, and game-owned Bot Sessions stay outside the native subagent popup. The view package's Model Experience section therefore still records no parent-model request.
- Replay remains checkpoint-indexed; day/phase scrubbing and a presentation store are deferred and recorded in the package README's limitations.

## Alternatives considered

**Wire the view to session projections.** Rejected for stage 4: the game lives in its own Host session, so a `SessionProjectionMap` key would need a per-session binding the stage-3 Host does not publish; the typed remote plus one forwarded event is the smaller honest seam.

**Derive human forms in the Host.** The Host already validates everything; rendering derives from the same closed spec the bot prompt serializes, so duplicating a form builder host-side would add a second owner for identical data.

**A slash-command fallback.** Rejected by the proposal: it forces players to remember syntax, obscures private resources, and mixes game speech with assistant conversation.
