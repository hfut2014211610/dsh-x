# Agent Note: Werewolf stage 3 — Session Host and typed game runtime

Status: implemented

English | [中文](2026-08-21-werewolf-session-host.zh.md)

## Problem

The deterministic core and one-shot runner produced detached transitions but did not own a playable multi-turn lifecycle. A live game needs one durable authority, atomic command publication, caller idempotency, participant authorization, per-game serialization, bounded parallel bot work, restart recovery, and a typed surface for the dedicated UI. Putting those concerns into the Werewolf engine would prevent reuse by later games and would mix platform identity and Agent lifetime into domain rules.

## Decision

Stage 3 adds one complete `@deepseek-ai/dsh-game` capability package. `GameService` is the Service Definition, `SessionGameService` is the default provider, and `GameModule` is the Consumer contract. The provider creates one idle Host Agent and Session per game, records a local principal-to-participant binding, serializes each game's mutations, owns `GameAiExecutor`, publishes `game/projection-invalidated`, and cold-resumes the deterministic `game-<GameId>` Host when a known id is read after restart. The Host model is never driven.

Every mutating request carries a caller `requestId`; requests after start also carry `expectedGameRevision`. `game/command-receipt` records the game and module version, method, request id, canonical payload SHA-256 digest, committed revision, principal, and participant. An equal duplicate returns the current authorized projection even after automatic advancement, another payload under the same key conflicts, and a new stale request rejects. The receipt and domain transition enter one `Session.appendBatch()` call.

`Session.appendBatch()` snapshots every candidate, validates the complete surface transition, and runs synchronous session invariants against shadow prefixes before changing the live log. A failure leaves the log, surface, cached event snapshot, and observers unchanged. A successful batch enters the log in full before ordinary observers receive its events in order.

`WerewolfGameModule` remains thin over the Stage 1–2 engine and reducer. It validates the exact rule set and isolated provider before start, converts human actions, resume, and abort into domain transitions, and advances phases through the Host executor. Parallel-private bot requests share one source revision, run under `maxConcurrentBots`, and commit one seat-ordered `werewolf/bot-decision`; seat-order-public phases commit one actor before the next prompt. `WerewolfGameGateway` exposes typed `start`, `getView`, `getReplay`, `submitAction`, `resume`, and `abortGame` methods without accepting a Session id, player id, or seat. `WerewolfHumanViewV1` is the sole human projection and terminal replay returns authorized checkpoints rather than raw events.

## Consequences

- A real Loader composition completes `quick-7` with fresh isolated children, bounded parallelism, durable bot-context progression, no Host model call, a terminal authorized replay, and a stable snapshot of the Host event sequence.
- Capability rejection happens before `werewolf/game-started`; providers that inherit parent history are invalid even if they support structured output, persona, tool filtering, and depth limits.
- The common receipt adds one required Session event type, so the generated persistence vocabulary and catalog include it.
- Stage 4 remains responsible for the dedicated Web view. Stage 3 registers no command, slash command, or Chat-composer mutation path.
- Version 1 binds one loopback local principal. Recovery from a known game id is supported; enumerating cold start receipts and online identity remain future work.

## Alternatives considered

**Keep the Host inside `ctx.werewolf`.** Rejected because Agent/Session lifetime, idempotency, identity, and AI scheduling are not Werewolf rules and are reusable by other turn-based games.

**Append the receipt and domain events one by one.** Rejected because a crash or invariant failure could expose a receipt without its transition or a partial multi-event transition.

**Use the Host conversation as the controller.** Rejected because it would spend model turns on deterministic operations, move legality and secrecy into prompts, and make UI actions dependent on Chat routing.
