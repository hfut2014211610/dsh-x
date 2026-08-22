# Agent Note: Werewolf stage 4 — the dedicated conversation view

Status: implemented

English | [中文](2026-08-21-werewolf-conversation-view.zh.md)

## Problem

Stages 1–3 delivered the deterministic engine, the one-shot bot runner, and the session-backed Host with a typed gateway — but the only surface into a game was a test harness. The proposal requires one dedicated view that owns lobby, covered role reveal, the table, generic human action forms, spectator, pause/resume, result, and replay, with no slash command and no Chat-composer mutation path. The view must also keep the model out of game input: no parent model request may result from a click.

## Decision

Stage 4 adds `@deepseek-ai/dsh-client-ui-werewolf`, a browser plugin in the ui-writing lineage, plus the composition that mounts it:

1. **The view is a projection consumer, not a state owner.** `WerewolfView` receives every value and verb through the slot's inject face, which wraps the generated `ctx.remote.werewolfGame` namespace (`getLobby`, `start`, `getView`, `submitAction`, `resume`, `abortGame`, `getReplay`) and unwraps `RemoteResult` into view values or thrown diagnostics that render as inline retryable errors. Revision checks reject older responses, while a same-phase refresh retains presentation-local drafts and selections. Retry reuses the original mutation's idempotency key and is suppressed when a reconciliation read shows that the phase already advanced.
2. **Refresh rides one forwarded event.** `game/projection-invalidated` joined `API_REMOTE_FORWARDED_EVENTS`; the view subscribes before its first read, ignores other games' ids, and re-reads via `getView`. The event carries no secret fields, so authorization stays entirely in the Host projector.
3. **Lobby needs a pre-game listing.** The gateway gained an additive `getLobby` remote returning the registered rule-set options sorted by `{ id, revision }` — the one host surface the lobby can call before any game exists.
4. **Client-safety forced three small host refactors.** `@deepseek-ai/dsh-game/types` no longer names Agent or subagent types (the executor contracts moved to a host-side `executor.ts` module), `@deepseek-ai/dsh-werewolf/types` now re-exports wire types from modules that never import the engine or the runtime class, and the projection's registry dependency became the structural `WerewolfRuleSetSource`. Without these, importing the generated remote's declarations dragged host-only modules into the client compilation face.
5. **Forms render the closed vocabulary only.** `player-target`, `choice`, `text`, and `compound` map to seat buttons, option radios, bounded textareas, and nested fieldsets; compound text fields keep independent drafts, required subfields gate submission, and visible pass or abstain controls send explicit null actions. `buildAction` and `fieldChoices` remain pure functions of the authoritative phase spec, including targets that a future role may legally select despite their current roster state.
6. **Composition and Host navigation are data.** The web-app bundle gained host rows (`dsh-game`, `dsh-werewolf`, `dsh-werewolf-classic`, `dsh-werewolf/host`) plus a browser row for the view. The Werewolf runtime defaults `subagentProvider` to the base bundle's `spawn` provider, while the `werewolf` agent preset contributes only a persona. `GameModule.hostAgentPreset` stamps the dedicated `game-<GameId>` Host Session, so a successful start opens that Session and reopening it restores the game projection directly.

## Consequences

- All eight product states are covered by jsdom behavior tests, and desktop/820px/390px layout snapshots pin the deterministic seat order, sticky phase status, and the mobile seat carousel.
- Accessibility is structural: radio groups with arrow-key selection, Escape clearing and `aria-checked`, live status and alert regions, non-color seat cues, 44px targets, visible focus, and phase-heading focus restoration after committed transitions.
- The bot child surface is unchanged: stage 4 adds no model-visible parent input, so the Model Experience section of the view package documents the absence as the contract.
- Replay remains checkpoint-indexed; day/phase scrubbing and a presentation store are deferred and recorded in the package README's limitations.

## Alternatives considered

**Wire the view to session projections.** Rejected for stage 4: the game lives in its own Host session, so a `SessionProjectionMap` key would need a per-session binding the stage-3 Host does not publish; the typed remote plus one forwarded event is the smaller honest seam.

**Derive human forms in the Host.** The Host already validates everything; rendering derives from the same closed spec the bot prompt serializes, so duplicating a form builder host-side would add a second owner for identical data.

**A slash-command fallback.** Rejected by the proposal: it forces players to remember syntax, obscures private resources, and mixes game speech with assistant conversation.
