# @deepseek-ai/dsh-feishu

English | [中文](README.zh.md)

Reach a dsh session from Feishu: say something in a direct message and it starts working, @ it in a group and it takes the job, and the run is visible on a card.

The design and its trade-offs are in the [channel note](../../../personal/docs/notes/proposed/2026-08-18-feishu-channel.md).

## Two parts

| Part | Where it runs | What it does |
|---|---|---|
| The plugin (`src/`) | inside dsh's web profile process | creates sessions, submits messages, renders events, answers tool approvals |
| The bridge (`src/bridge/`) | its own resident process | holds the one Feishu event subscription, sends messages and cards, and starts dsh when it is not running |

One local socket connects them. **The socket being connected is what "dsh is alive" means**, so there is no heartbeat file, no pid probe, and no staleness threshold. The bridge also opens a read-only event relay socket so other local components can reuse the inbound events; those components must not start a second `lark-cli event consume`.

Why two processes at all: `lark-cli` admits **exactly one consumer per event key**. Since there can only be one, the resident bridge holds it end to end and dsh is the client — which makes handover and mutual exclusion problems that never arise.

## Dependencies

- `lark-cli` (v1.0.87 here, with the app and its credentials in the system keychain). The bridge is the only thing that talks to Feishu, and this plugin stores no Feishu credential of its own.
- The plugin side needs only dsh's services and `zod`.

## Configuration

Everything lives under Settings → Connectors → Feishu, or the equivalent section of `$DSH_HOME/settings.yaml`. The bridge has no interface of its own: its `~/.dsh-x-feishu/config.json` is written by the plugin, read-only to it, and watched — so a settings change needs no bridge restart.

The first question is whether it is **connected at all** (`mode`). Until it is, the card offers two ways in and nothing else:

| | `direct` — dsh's own Feishu app | `bridge` — a third-party bridge |
|---|---|---|
| What to fill in | a profile name (default `dsh`) | an app id, plus a command replacing `lark-cli event consume` |
| How it completes | scan a code to authorize | filling it in is all there is |
| Who holds the subscription | the bridge spawns lark-cli itself | the command you gave |
| Recommended | yes | advanced; most people do not need it |

Once connected the card shows status and two actions — reconfigure and reset — with the session settings folded away.

```yaml
# $DSH_HOME/settings.yaml
dsh-x-feishu:
  mode: direct          # '' not connected | direct | bridge
  profileId: dsh        # direct: which lark-cli profile, at ~/.lark-cli/dsh
  appId: ''             # bridge: which Feishu app those events belong to
  eventCommand: ''      # bridge: the command replacing `lark-cli event consume`

  # Session settings (folded away on the card)
  workspace: ''         # where Feishu sessions run; empty means $DSH_HOME/feishu
  presetId: standard    # which agent preset; empty uses the deployment default
  density: standard     # compact | standard | detailed
  flushMs: 2500
  approvalTimeoutMs: 300000
  endpoint: ''          # local socket to the bridge; empty uses the platform default

  # Who can reach it. Deny by default: an empty list admits nobody
  dmMode: allowlist     # open | allowlist | disabled
  dmAllowlist: []       # open_ids
  groupAllowlist: []    # chat_ids; empty admits no group at all
  requireMention: true
  staleMs: 600000
```

In `~/.dsh-x-feishu/config.json`, `launch` (the command that starts dsh when it is not running) and `botOpenIds` (a manual override of each app's bot open_id) are not the settings page's to own, and survive a write untouched. While `mode` is still empty nothing is written at all: nothing has been decided, and writing anyway would only start the bridge against an empty configuration.

### Where the sessions land

With `workspace` empty, sessions run in `$DSH_HOME/feishu`. That is not a registered workspace, so they appear under "Ungrouped" — a message arriving from a chat app should not write into a project you have open by default. Point it at a directory to change that.

### Connecting a third-party bridge

`eventCommand` replaces the `lark-cli event consume <key> --as bot` the bridge would otherwise run. The bridge appends the event key to your command, hands the whole line to a shell, and reads NDJSON from its stdout line by line. Use it when another process already holds that event key — one event key admits one consumer.

Outbound still goes through lark-cli: `appId` is how the matching profile is found locally, and replies and cards are sent as that app. Whichever app an event arrived through is the one answered — a card can only be patched by the app that sent it, so a wrong identity cannot even refresh progress.

## Running it

The Web bundle mounts this package, so the only thing left to start is the bridge — a resident process holding the machine's single Feishu event subscription:

```sh
# From a checkout
node --import tsx/esm packages/channel/feishu/src/bridge/main.ts

# Once installed
dsh-feishu-bridge
```

## Checks

```sh
pnpm exec vitest run packages/channel/feishu
```

## Verified against real credentials

These raw escape hatches were driven through `lark-cli` v1.0.87 against a real group chat:

- Send: `POST /open-apis/im/v1/messages?receive_id_type=chat_id`, query parameters via `--params` and `{ receive_id, msg_type, content }` via `--data`; `content` is the whole message JSON as a string.
- Reply: `POST /open-apis/im/v1/messages/:message_id/reply`; the resulting message id is always `data.message_id`.
- Patch a card: `PATCH /open-apis/im/v1/messages/:message_id`, body `{ content }`, where `content` is the whole card JSON as a string.
- Bot identity: `GET /open-apis/bot/v3/info`, read from the raw response at `bot.open_id`. This one needs `--format ndjson` to keep the original shape; v1.0.87's `--format json` flattens that response into an empty `data`.
- Button callbacks: the event schema's field is a top-level `action_value` holding the developer-defined object as a JSON string, not `action.value`. The bridge parses it back before routing an approval or a stop.

`event consume` runs without `--quiet`, so dropped-event warnings are not hidden; the real loss rate still needs long observation of the resident log.

## Numbers actually measured

Five cold `lark-cli` starts: 339 / 361 / 291 / 343 / 282 ms. **About 300ms each**, which is why the card updates in stages rather than streaming token by token — streaming wants a frame every 200–500ms, and process startup alone eats that.
