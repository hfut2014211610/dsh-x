# dsh-client-ui-werewolf

English | [中文](README.zh.md)

The dedicated Werewolf conversation view: the lobby with exact `{ id, revision }` rule-set cards, a deliberately covered role reveal, the night/day table with a public timeline and the human's entitled private pane, generic action forms over the closed spec vocabulary, spectator state, pause/resume with confirm-guarded abort, the result with full role reveal, and authorized replay. The plugin registers no command and no Chat-composer mutation path — the view is the sole supported game surface.

## What it does

- **View registration** — injects the `conversation.view` slot entry `werewolf` (order 6) with a bilingual label, and declares it the preferred view for sessions whose `agentPreset` is `werewolf` without overwriting the user's persisted tab. Starting a game opens its dedicated `game-<GameId>` Host Session; reopening that Host restores the authorized projection directly instead of returning to the launcher.
- **Typed Remote verbs** — the inject face wraps `ctx.remote.werewolfGame` (`getLobby`, `start`, `getView`, `submitAction`, `resume`, `abortGame`, `getReplay`), unwrapping `RemoteResult` into view values or a thrown diagnostic that renders as an inline retryable error.
- **Invalidation refresh** — subscribes to the forwarded `game/projection-invalidated` host event before the first read, ignores events for other games, and re-reads through `getView`; an older revision cannot replace the current projection, and a same-phase refresh retains still-applicable drafts and selections.
- **Interaction states** — lobby, covered reveal (two-step, no flip dependency), table with non-color seat cues (icon, text, style) and a sticky phase heading, night focus with a privacy hint, day discussion with a bounded text editor, vote with radio-group selection and a sticky confirm, spectator labeling, and result with replay checkpoints.
- **Generic action form** — renders the closed spec vocabulary only: `player-target`, `choice`, `text`, and `compound`; field ids stay stable, compound text fields keep independent drafts, required fields gate submission, and a visible pass/skip control submits an explicit null action. No HTML, CSS, callbacks, or component names can arrive from configuration.
- **Accessibility** — seats announce state through text, keyboard traversal reaches every control in DOM order, radio groups support arrow-key selection and Escape clearing with `role="radio"`/`aria-checked`, busy, phase, and error regions use live semantics, and focus returns to the phase heading after a committed transition.
- **Failure recovery** — inline retry repeats the same logical mutation with its original idempotency key. Before offering mutation retry, the client refreshes the authorized projection and suppresses an obsolete action when the phase already advanced.

## Model Experience

None, as the game view renders host-authorized projections in the browser; view actions create no parent model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No presentation store yet** — drafts, side-panel state, and the animation toggle are component-local; a registered client store for cross-reload presentation preferences arrives with polish.
- **Replay is checkpoint-indexed** — review lists authorized revisions without day/phase scrubbing; scrubbed replay arrives with the stage-5 documentation pass.
- **No decorative card art** — the role card is a neutral back pattern by design; the game remains fully understandable when images fail to load.
