# Agent Note: Remove the Werewolf experiment from DSH

Status: implemented

English | [中文](2026-08-29-remove-werewolf-experiment.zh.md)

## Problem

The Werewolf experiment added a generic game runtime, a deterministic Werewolf engine and ruleset, persistent role bots, Remote APIs, a dedicated browser application, presets, generated catalogs, documentation, and desktop release wiring to the main DSH repository. It explored whether durable agent sessions and projections could support a multi-role game, but the resulting product direction did not strengthen the general-purpose agent harness enough to justify its package, release, and maintenance cost.

Keeping the implementation disabled would still retain its dependency graph, event vocabulary, public types, documentation obligations, build time, and release payload. With no current non-Werewolf consumer for the generic game runtime, those abstractions also violate the repository rule that every shipped abstraction has a current owner and need.

## Decision

DSH does not ship the game runtime or the Werewolf application. The `packages/game` group, `client/ui-werewolf`, the Werewolf preset, game events and Remote APIs, Web and desktop entries, generated catalog entries, subsystem documentation, and feature-specific tests and Agent Notes are absent from the active tree and release inputs.

The final experiment source is retained only as a deprecated remote snapshot at `codex/archive/werewolf-deprecated-20260829`, commit `8c42340a8d67dee9136546c1a2554d828417e538`. That branch is historical recovery material, not a supported product line or documentation authority.

This note consolidates the removed deterministic-core, session-host, bot-runner, conversation-view, isolated-application, and configurable-mode decisions. Their original motivation was to test deterministic hidden-information rules, persistent per-seat agent continuity, replayable session events, and a focused single-player surface. The complete removal reflects a product-scope decision, not a claim that those mechanisms were technically invalid.

## Alternatives considered

- **Keep the packages mounted nowhere.** Rejected because unused packages still expand dependency resolution, type aggregation, generated references, verification obligations, and release payload risk.
- **Move the implementation under `experimental/`.** Rejected because an in-repository experimental tree would still require ongoing synchronization with session, Remote API, Client, packaging, and documentation changes.
- **Retain only the generic game runtime.** Rejected because Werewolf was its only production consumer; preserving a speculative capability without a current user would leave an abstraction with no owner or acceptance path.
- **Continue Werewolf in a separate product repository.** This is the preferred reintroduction path if a concrete product owner and acceptance plan appear. It keeps game-specific release and UX decisions outside the general DSH distribution while allowing selected harness capabilities to be consumed through published interfaces.

## Consequences

- DSH gives up the built-in deterministic Werewolf engine, classic quick-seven rules, persistent seat bots, replay projection, dedicated UI, and one-command Werewolf profile.
- Mainline package discovery, TypeScript aggregates, Web composition, Remote APIs, generated catalogs, documentation, and desktop release inputs contain no game or Werewolf entry.
- Existing pre-release Werewolf sessions and event logs have no compatibility promise and are not readable as a supported mainline application.
- Reintroduction requires a current product owner, an isolated distribution boundary, explicit session and hidden-information security review, product-visible snapshot coverage, and an acceptance plan independent of the deprecated branch.
