# DeepSeek Useless platform architecture review

English | [中文](deepseek-useless-architecture-review.zh.md)

## Review scope

Two independent Opus reviews ran on 2026-08-21: one covered the [platform architecture Agent Note](../.agents/notes/proposed/feature/2026-08-21-deepseek-useless-game-platform.md), and one compared it with the current Werewolf Stage 1–2 implementation and Stage 3 proposal in `D:\dev\DSH-X-werewolf`. Both primary `claude-opus-5-0.2` routes ended with provider 502 errors and produced no usable verdict. Under the defined one-step fallback rule, `claude-opus-5` completed both read-only reviews. The reviewers changed no code, branch, or remote.

## Verdict

The platform verdict is **ACCEPT WITH CHANGES**. The focused Werewolf verdict is **SCAFFOLD CHANGES REQUIRED BEFORE STAGE 3**. Both reviews accept the deterministic domain core, the two-plane split, a phase-agnostic `GameModule`, one-shot AI seats, viewer projections, and staged trimming. They reject starting Stage 3 with a Werewolf-owned Session controller or simulated batch append.

After source verification and the Stage 3 proposal revision, the combined conclusion is: **the design baseline is accepted, and the previously blocking document conflicts are resolved; implementation may start only from the later frozen DSH-X integration commit and is not complete until the gates below pass.** This work revised documents only. It did not implement the platform runtime, synchronize code into `dsh-u`, or touch a remote.

## Findings and disposition

| Priority | Finding | Disposition |
|---|---|---|
| P0 | The reviewed DSH-X `Session.append()` appends one event at a time, while the proposal claimed atomic event batches. | Accepted. Stage one now requires `Session.appendBatch()` with whole-batch prevalidation, one in-memory log update, ordered observer publication, and `ctx.sessions.flush()` before projections. A durability failure quarantines the instance and does not acknowledge the command. |
| P0 | The Werewolf proposal assigned its own runtime the Session controller, serialization, RPC, and projection lifecycle, which would create a second controller after the platform fork. | Accepted. Stage 3 now introduces the complete `ctx.games` seam and a thin Werewolf adapter. `ctx.games` exclusively owns Host/Session binding, mailbox, receipts, identity, batch commit, invalidation, and AI scheduling; `ctx.werewolf` retains rules, engine, reducer, projections, and Bot policy. |
| P0 | One Session could hold successive games, and raw Session fork was also the product branch operation. | Accepted. Every game and playable fork gets a dedicated idle Host Agent/Session. Playing again creates a new instance with lineage. Raw Session fork remains diagnostic only; a playable fork records parent revision and derives fresh server entropy. |
| P0 | Continuable lifecycle for DND GM and NPC agents was undefined. | The concern is accepted without making continuable a first-release dependency. Stages one through four use fresh `spawn` one-shots and rebuild complete context from events plus explicit continuity. Continuable requires a later independent design. |
| P1 | It was unclear whether the `game` profile inherited `base/web-app`, which could still mount Terminal, Writing, or Feishu. | Accepted. `game` is now an independent minimal bundle that directly declares required core dependencies. `base/web-app` remain only in the maintainer profile. |
| P1 | Stage 3 inferred the sole human from caller-supplied `sessionId`; that could not safely extend to Web, Feishu, or multiplayer identities. | Accepted. External mutation methods no longer accept a Host Session or seat. An entry adapter resolves Web identity or future Feishu `open_id` to a platform principal, and `ctx.games` resolves the participant binding. The local MVP still binds one human. |
| P1 | The focused review recommended separate generic AI-observation, legal-action, and intent-schema methods. | Partially accepted. Human projection remains separate, but the AI observation and schema stay together in `prepareAiTurn()` so the module has one AI-decision authority. Werewolf's existing observation/schema builders adapt behind that method; continuity remains module-owned. |
| P1 | “Projection tests prove no leak ever” exceeded what types and finite tests can establish. | Accepted. The gate is now a per-module viewer matrix, secret fixtures, field exclusions, cross-seat prompt snapshots, and runtime non-interference tests. |
| P1 | Random-stream behavior for a playable fork was undefined. | Accepted. A playable branch creates a new host Agent/Session and records the parent revision plus fresh server entropy. Its future randomness differs but remains replay-stable. Parent RNG state is retained only for a read-only diagnostic clone. |
| P1 | Model selection and the retained Feishu path were not part of the first controller contract. | Accepted. `model-hub` resolves seat, game, then Host defaults and child Sessions record the actual route/model. Feishu source remains in the future fork and later uses an optional `game-feishu` adapter; it is not mounted in the base `game` profile. |
| P2 | The focused review proposed immediate `game`, `game-session-runtime`, and `game-agent` packages. | Deliberately narrowed. Stage 3 creates one complete `packages/game/game/` capability package; provider/runtime and AI executor remain internal modules until a second game proves a package seam. |
| P2 | SRD content and the DeepSeek/DND names and logo carry licensing or trademark risk. | This does not block local technical work. A DND content pack pins `srdVersion` and attribution, and any public release requires separate brand and legal review. |

## Source-verification corrections

The review described continuable management with a non-public name. In the reviewed DSH-X snapshot, the actual public entry point is `SubagentRuntime.startContinuable()`, followed by `followup()`, `interrupt()`, and drain APIs. The continuation manager owns internal Activations; a game module does not receive a handle. The revision therefore does not ask modules to retain internal handles.

AI seats must explicitly select `subagent-spawn-in-process` and verify `inheritsParentContext === false`. The `fork` provider inherits completed parent turns and is not a safe default for a hidden-information game's AI path.

The persistence abstraction already accepts a contiguous event array and reaches durability before its `append()` returns. The missing capability is the in-memory, single-event admission surface on `Session`. Adding `appendBatch()` is therefore preferable to simulating an atomic transaction with a loop of game-layer `append()` calls.

## Stage-one gates

- The implementation fork starts from one exact clean DSH-X integration commit after Werewolf completion and current DSH-X master integration; official rc.8 remains a comparison baseline only.
- `Session.appendBatch()` leaves the in-memory log unchanged when any candidate is invalid and has fault-injection coverage.
- One command's receipt and module events enter one durable batch; no projection or acknowledgement precedes flush.
- Every game and playable fork has a dedicated Host Agent/Session, one mailbox, and one write owner; the Host receives no ordinary chat turns.
- RPC resolves a platform principal and participant binding; no external mutation chooses a Host Session or seat.
- AI uses only fresh `spawn`, structured output, restricted tools, and `inheritsParentContext === false`; `model-hub` precedence and child execution evidence are verified.
- The `game` bundle does not inherit `base/web-app`; runtime snapshots contain no registration for excluded plugins.
- The optional Feishu overlay maps `open_id` through the same principal and projection contracts and remains outside the base Stage 3 milestone.
- The Werewolf adapter passes direct-engine equivalence, replay, idempotency, secret-projection, and scripted quick-7 fixtures.

## Final recommendation

The architecture and revised Werewolf Stage 3 design are approved at document level. Do not start implementation in the current design-only `dsh-u` worktree. Wait for Werewolf completion, integrate current DSH-X master while retaining `model-hub` and Feishu, freeze the exact clean commit, and fork from that point. Runtime implementation, tests, remote multiplayer, a continuable GM, public release, and brand/legal clearance remain future work. The final review state is **ACCEPT WITH CHANGES RESOLVED IN DESIGN; IMPLEMENTATION GATES OPEN**.
