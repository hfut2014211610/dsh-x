# Agent Note: Werewolf stage 1 — the deterministic core

Status: implemented

English | [中文](2026-08-21-werewolf-deterministic-core.zh.md)

## Problem

The [configurable Werewolf mode proposal](../../rejected/feature/2026-08-20-configurable-werewolf-mode.md) stages delivery so that no playable surface ships before the deterministic foundation is provable without a model. Stage 1 had to answer three questions in code: how rule-set configuration selects registered mechanics without admitting executable code, how one session log can be the single authoritative record for a whole game (replay, resume, fork), and where bot subjectivity may live so it can never masquerade as game truth. The full interaction design (bot runner, projections, dedicated view) is deliberately out of this stage.

## Decision

Landed `packages/game/` with two packages. `@deepseek-ai/dsh-werewolf` owns the core; `@deepseek-ai/dsh-werewolf-classic` owns the classic definitions and the `quick-7` rule set. The stage-1 decisions:

1. **Engine and replay share one reducer.** Every engine step computes the next events, then folds them through `applyWerewolfEvent` — the same fold replay uses. Live play cannot diverge from replay because there is only one path from events to `WerewolfGameStateV1`.
2. **The cursor is event-derived.** `phase-opened` events carry `segment`/`cursorIndex`/`occurrence`/`day`; the reducer records them, and `positionConsumed` (set by resolves and skips) is the only extra bit. `openNextWerewolfPhase` derives the next position from state alone, so a restart resumes without engine-private memory. A revote re-opens the same position with `occurrence + 1` inside the resolve step's own event batch.
3. **A closed action-spec vocabulary** (`player-target`, `choice`, `text`, `compound`) is the whole legality language. Plans describe every actor's action with it; the engine validates actions generically; configuration can never smuggle logic. Human form fields (stage 4) derive from the same vocabulary.
4. **Tie policies split by who can act.** `voteTie` needs re-entry into scheduling, so the engine owns it (including the revote re-open); `wolfTie` is internal to the night kill, so the phase applies it inside `resolve` with the seeded picker. Neither side inspects the other's semantics.
5. **Randomness is one recorded stream.** Seat shuffle, role assignment, profile assignment, and seeded tie breaks advance a single seeded counter recorded on `game-started`, `phase-opened`, and `phase-resolved`. Replays apply recorded resolutions and never re-run definitions, but a resumed game continues the stream exactly.
6. **Bot continuity context is bounded subjective data with recomputable checkpoints.** Every accepted decision records the prior revision, action, validated delta, and full `contextAfter`; the package invariant recomputes each `contextAfter` from the prior checkpoint plus delta and rejects disagreement. Profiles come from a fixed catalog assigned deterministically from the seed.
7. **Deaths belong to dawn.** The night kill records the victim in its outcome and private notices only; `day.announce` reads the night's outcomes from `sameDayHistory` and emits the eliminations. This keeps every resolution declarative and lets the witch's prevention interact with the kill without resurrection logic.

## Consequences

- The lobby's two-rule-set acceptance criterion (different decks, options, phase orders, tie policies, victory conditions without engine changes) is testable today: registering definitions and compiling rule inputs exercises everything the criterion names.
- The invariant companion validates append and load semantics: contiguous revisions, one active game at a time, legal transitions, unique action ids, actor eligibility and ordering, context revision continuity with recomputed snapshots, resolution player references, resource underflow, and victory evidence shape. Candidate events are validated against a staged fold and published only after the event commits.
- Adding the stage-2 bot runner needs no event or reducer changes: decision entries already carry everything a child prompt reconstructs, and `bot-attempt-failed` exists for retries.
- Trusted phase facts carry faction, so the classic seer records the inspected faction in role state and its private notice. Gaps carried into later stages remain: announcement copy is keyed but not localized, and no human projection or dedicated view exists yet.

## Alternatives considered

**Fold in the engine, separate replay fold.** Duplicated state-derivation logic would let live play and replay disagree; one reducer removes the class of bug at the cost of the engine constructing its inputs through the same event payloads it appends.

**Derive the next phase from a live controller cursor.** Any cursor the controller owns dies with the process; the position fields on `phase-opened` events make restart resume a form of ordinary replay.

**JSON-Schema bot actions now.** The plan's object-rooted schema arrives with the stage-2 child runner, which is its only consumer; the closed spec vocabulary already gives the engine a complete legality check for both bots and (later) humans.

**Resource state inside opaque role state.** Separate named resources let the invariant check underflow generically and let the future human view render counts without understanding each role's JSON.
