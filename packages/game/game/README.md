# dsh-game

English | [中文](README.zh.md)

The reusable `ctx.games` capability for durable, turn-based game modules. The default provider creates one idle Host Agent and Session per game, serializes mutations, binds the local principal to one participant, atomically commits command receipts with domain events, invalidates authorized projections, and schedules fresh one-shot AI children without invoking the Host model.

## Lifecycle

`start()` validates the module before creating a Host. The first `game/command-receipt` and the module's start events enter the Session through `Session.appendBatch()`. Later `submitAction`, `resume`, and `abortGame` calls use `{ method, requestId }` receipts, payload SHA-256 digests, and `expectedGameRevision`: an equal duplicate returns the current projection, a changed payload conflicts, and a new stale request rejects. Each game has one serialized operation queue. A known `GameId` can cold-resume its deterministic `game-<GameId>` Host through the Agent persistence path. A module may stamp that Host with `hostAgentPreset` so a client can select the module's dedicated view without changing game authority.

## Module contract

A `GameModule` owns domain rules, event folding, revision and status, mutations, automatic advancement, authorized projection, and replay. The Host owns Agent/Session lifetime, principal binding, idempotency, atomic publication, cancellation, bounded concurrency, and child start authority. Module events are log-only; they never enter the Host model surface.

`GameAiExecutor.map()` preserves input order under the requested concurrency bound. `GameAiExecutor.start()` supplies the exact Host parent and operation signal, so modules construct prompts and schemas while the common Host retains child lineage and cancellation authority.

## Export shape

The default export is `SessionGameService`; the abstract Service Definition is `GameService`. `./invariant` validates Host receipt identity, revision, digest, and uniqueness. `./types` exposes branded ids and the module contract.

## Model Experience

### Game Host

#### What the model sees

Nothing. A Host remains idle while `ctx.games` appends ordinary mutations as log-only events. Only a module-requested one-shot child receives its module-authorized prompt.

#### Token effect

The Host consumes no model tokens. Child token usage belongs to the selected module and provider.

#### KV Cache effect

The Host creates no model request and therefore no game-specific Host cache entry. Fresh children do not reuse a previous decision transcript.

## Known Limitations and Deferred Work

- Version 1 has one loopback local principal. Online identity, multiplayer authorization, and product game forks are later layers. Start-request discovery across a cold persistence store is not enumerable; recovery from a known `GameId` is supported.
