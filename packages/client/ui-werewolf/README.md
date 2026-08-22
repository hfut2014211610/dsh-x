# dsh-client-ui-werewolf

English | [中文](README.zh.md)

The dedicated Werewolf conversation view: the lobby with exact `{ id, revision }` rule-set cards, a deliberately covered role reveal, the night/day table with a public timeline and the human's entitled private pane, generic action forms over the closed spec vocabulary, spectator state, pause/resume with confirm-guarded abort, the result with full role reveal, and authorized replay. The plugin registers no command and no Chat-composer mutation path — the view is the sole supported game surface.

## What it does

- **View registration** — injects the `conversation.view` slot entry `werewolf` (order 6) with a bilingual label, and declares it the preferred view for sessions whose `agentPreset` is `werewolf` without overwriting the user's persisted tab. Starting a game opens its dedicated `game-<GameId>` Host Session; reopening that Host restores the authorized projection directly instead of returning to the launcher.
- **Typed Remote verbs** — the inject face wraps `ctx.remote.werewolfGame` (`getLobby`, `start`, `getView`, `submitAction`, `resume`, `abortGame`, `getReplay`), unwrapping `RemoteResult` into view values or a thrown diagnostic that renders as an inline retryable error.
- **Invalidation refresh** — subscribes to the forwarded `game/projection-invalidated` host event before the first read, ignores events for other games, and re-reads through `getView`; an older revision cannot replace the current projection, and a same-phase refresh retains still-applicable drafts and selections.
- **Interaction states** — lobby, covered reveal (two-step, no flip dependency), Signal Circle table with one neutral sigil per seat and a sticky phase heading, night focus with a privacy hint, sequential day discussion with a current-speaker/progress banner and ordered speech or explicit pass records, vote with radio-group selection and a sticky confirm, spectator labeling, and result with replay checkpoints. Voting appears only after every planned living seat has spoken or passed. Werewolf-preset sessions elect an empty `conversation.composer` replacement after question and approval takeovers, so the game action form is the sole ordinary input while system waits remain answerable.
- **Private findings** — only `view.self.notices` can mark a seat as known. Known-seat controls and the private pane open the same finding detail, which shows built-in inspection targets, localized factions, and source days while retaining a readable key/value fallback for configured notice kinds.
- **Generic action form** — renders the closed spec vocabulary only: `player-target`, `choice`, `text`, and `compound`; field ids stay stable, compound text fields keep independent drafts, required fields gate submission, and a visible pass/skip control submits an explicit null action. No HTML, CSS, callbacks, or component names can arrive from configuration.
- **Accessibility** — seats announce state through text, keyboard traversal reaches every control in DOM order, radio groups support arrow-key selection and Escape clearing with `role="radio"`/`aria-checked`, busy, phase, and error regions use live semantics, and focus returns to the phase heading after a committed transition.
- **Failure recovery** — inline retry repeats the same logical mutation with its original idempotency key. Before offering mutation retry, the client refreshes the authorized projection and suppresses an obsolete action when the phase already advanced.

## Model Experience

None, as the game view renders host-authorized projections in the browser; view actions create no parent model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request, and the fixed per-seat game Bot Sessions are Host-owned and intentionally omitted from the generic subagent catalog and native popup.

## Known Limitations and Deferred Work

- **No presentation store yet** — drafts, side-panel state, and the animation toggle are component-local; a registered client store for cross-reload presentation preferences arrives with polish.
- **Replay is checkpoint-indexed** — review lists authorized revisions without day/phase scrubbing; scrubbed replay arrives with the stage-5 documentation pass.
- **No image regression harness** — the named viewport snapshots cover DOM structure rather than computed CSS geometry or contrast; those properties still require rendered-browser review.
- **No role portraits or decorative card art** — the covered role card remains a neutral back pattern, and seat sigils carry no role or faction meaning; text preserves every seat and finding state when images fail to load.
