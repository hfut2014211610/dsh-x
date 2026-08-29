# Agent Note: Isolated Werewolf application and fixed Bot Sessions

Status: implemented

English | [中文](2026-08-24-isolated-werewolf-application.zh.md)

## Problem

Treating Werewolf as an agent preset tied the game to ordinary Session navigation. A player could leave through the conversation sidebar, game Host Sessions appeared beside normal work, and returning depended on selecting the right internal Session. The game also created fixed Bot Agents without guaranteeing a provider and model on their parent Host, so a deployment with no explicit `botAgent` route failed on the first Bot turn. Automatic advancement kept `start` and human mutations open until all following Bot turns completed, so the dedicated window could neither return promptly nor render each public Bot result as it committed. The human projection already identified entitled faction teammates, but the table did not render that knowledge.

## Decision

Werewolf runs in a separate application window selected by `dshMode=werewolf`. The primary shell exposes one `sidebar.footer.action` launcher, while the dedicated window's `shell.surface` replaces all conversation chrome and closes through its own exit. The retired Werewolf agent preset is absent from the preset roster. Game Host Sessions retain `agentPreset: werewolf` as internal classification and are excluded from ordinary workspace navigation.

The selected `gameId` is stored in the dedicated window URL. When no game is selected, `WerewolfGameGateway.getLobby()` calls `ctx.games.listViews()` and returns the local principal's running and paused projections newest first. Reopening the window therefore restores a game from Host state rather than browser storage or the primary window's current Session.

Every non-human seat has one hidden Agent Session for the complete game. `WerewolfGameModule.hostAgentOptions` resolves the current `ctx.agentDefaultModel` provider and model before Host creation; a configured `botAgent` route may still override each child. `WerewolfGameModule.initializeAgents()` provisions all of those Sessions before `start()` returns and pins configured `botReasoningEffort` on each Agent, so every later FIFO follow-up on that seat uses the same effort. The Web composition selects `high` to retain deliberate reasoning without applying `max` to every decision. A resumed persisted Bot Session retains the same deterministic id and parent Host. The Host model is never run.

Werewolf selects background automatic scheduling on the common game Host. Start and human mutations return after their own durable transition, then each automatic step runs through the same per-game queue and publishes its own projection invalidation. This extends the [Stage 3 Host](2026-08-21-werewolf-session-host.md) without changing foreground scheduling for other modules. The first Bot decision receives bounded public history; later decisions carry only public timeline entries added since that Bot's preceding committed decision, while the fixed Session retains earlier turns. A retry adds only the rejection diagnostic because the immediately preceding decision prompt remains in the same Session; the [Stage 2 runner](2026-08-21-werewolf-bot-runner.md) still owns envelope validation, fallback, and the standalone one-shot face.

The human projection exposes accepted text actions as public speeches even when the model omits the redundant `publicSpeech` field. The dedicated window renders each committed statement through its public timeline and speaking progress before voting opens. Night targets, Bot continuity context, and private reasoning remain absent from the human projection. The table renders an icon-and-text teammate badge only for player ids already present in `WerewolfHumanViewV1.self.teammates`.

The earlier [fresh one-shot proposal](../../rejected/feature/2026-08-20-configurable-werewolf-mode.md) is rejected because its continuity record duplicated context that a fixed game-owned Agent Session now retains directly. Its deterministic engine, typed action, configurable-rule, and authorization goals remain implemented, but this note owns the shipped Bot and presentation choices.

## Alternatives considered

**Keep Werewolf as an agent preset.** This retained the existing entry point but made an internal Host Session look like a normal conversation and allowed unrelated navigation to interrupt the product flow.

**Remember the last game in local storage.** This was smaller than a Host listing method, but it made browser state the only return path and could point at a removed or unauthorized game. `ctx.games.listViews()` derives the lobby from authoritative Host records and principal binding.

**Create a fresh subagent for every decision.** This isolated turns but required a second continuity model in game events and did not satisfy the requirement that one Bot keep a fixed model conversation for the whole game.

**Inherit the model route's unspecified reasoning default.** This avoided one setting but allowed deployment or main-session choices to push every Bot decision to `max`, making interaction latency unpredictable. Provision-time `botReasoningEffort` keeps one explicit game policy and lets exact-model resolution reject an unsupported level before network I/O.

**Wait for every automatic Bot turn inside the initiating RPC.** This surfaces an unexpected scheduling failure to that caller, but it keeps the game window blocked and hides already committed public progress. Background scheduling preserves the same serialized event authority while exposing each completed publication unit.

**Reveal teammate roles on the table.** The human projection authorizes teammate identity, not arbitrary role detail. The badge communicates exactly that entitlement without widening secret projection.

## Consequences

The primary app and game no longer share navigation state, and active games remain recoverable after closing the game window or switching conversations. Desktop must allow only same-origin Werewolf window URLs while continuing to send unrelated HTTP links to the system browser. The common game service exposes an authorized module-scoped list operation, fixed-Agent initialization, and an opt-in background scheduling mode; foreground remains the default for other modules. Werewolf Host creation requires `agentDefaultModel`, and tests must provide that service even when Bot-specific options are configured. Fixed Bot Sessions provide the requested strategic continuity without appearing in the generic subagent UI; incremental public observations avoid repeating already delivered timeline entries, but the accepted Bot turn history remains part of the model context.
