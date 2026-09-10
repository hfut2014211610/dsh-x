---
description: "Connectors settings page: the channel registry seat, staged channel cards, and the shipped Feishu card."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-connectors

English | [中文](README.zh.md)

The Connectors settings page. It registers one `settings.section` entry (`connectors`) listing every app channel that can reach dsh from outside, declares `settings.connector.item` as the seat a channel registers its own card into, and ships the Feishu channel's card. Nothing runs on the host: each card edits its channel's own settings namespace through `ctx.settingsScope`.

## Summary

This package is the Connectors settings page: one `settings.section` entry listing every outside channel that can reach dsh, plus the `settings.connector.item` seat a channel registers its own card into, with the Feishu card shipped. Cards stage edits locally and write them only on save, through each channel's own settings namespace; nothing runs on the host. Absent channels keep a *Not installed* row with the install line but no controls. Use it when a channel needs a settings card without touching this package.

## Table of Contents

- [Why this is not a tab under Plugins](#why-this-is-not-a-tab-under-plugins)
- [Adding a channel](#adding-a-channel)
- [The staged form](#the-staged-form)
- [The Feishu card](#the-feishu-card)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="why-this-is-not-a-tab-under-plugins"></a>
## Why this is not a tab under Plugins

A connector is not a knob on the agent loop. It is a way in from outside, it usually needs a process the user has to start, and — unlike every other settings page — it is worth opening precisely when the thing it configures is **not** installed.

That last point is the visible difference. The Plugins section renders nothing for a plugin this deployment does not compose, which is right there: a deployment that never mounted the shell executor should show no trace of its limits. Here the opposite holds. A page that lists only the channels you already have cannot answer "what can I connect this to", so an absent channel keeps its row, carries a *Not installed* pill, and shows the one line that installs it. What an absent card never shows is controls: there is no namespace to write, and a disabled form would only invite the attempt.

<a id="adding-a-channel"></a>
## Adding a channel

A second channel ships as its own package and needs no edit to this one:

```js
ctx.slots.inject('settings.connector.item', () => ctx.slots.register({
  name: 'settings.connector.item',
  id: 'dingtalk',
  order: 10,
  locale: NS,
  inject: () => controller.inject(),
}, DingTalkCard))
```

The card chrome (`ConnectorCard`), the two controls (`ValueField`, `ChoiceField`), and the staged form (`ConnectorForm`) are internal to this package — the client bundle gate forbids importing them across packages, so a channel that wants the same chrome registers its card here rather than reimplementing it elsewhere.

<a id="the-staged-form"></a>
## The staged form

A card holds what the user types and writes it only when they save. Every settings write is a durable, revision-fenced document mutation, so a control that committed as it settled would turn one keystroke into a write nobody asked for and could not preview.

A field shows its effective value — user layer over composition layer over schema default — and whether the user layer carries it. That presence, not a value comparison, is what marks a field overridden: an override equal to the composition default is still an override. The save reads its outcome back from the section rather than predicting it, because the host's validators own constraints no schema can express; a save that did not land keeps its drafts so they can be corrected instead of retyped.

<a id="the-feishu-card"></a>
## The Feishu card

Five fields of `dsh-x-feishu`: the agent preset a session opened from Feishu runs, card density, the shortest gap between two pushes of the card body, how long an approval card waits for a tap, and the bridge endpoint.

The credentials are deliberately absent. The Feishu app and its secrets live in the system keychain behind `lark-cli`, held by the bridge process; the plugin stores none and neither does this page.

<a id="model-experience"></a>
## Model Experience

None, as this package only edits settings the host already owns; it registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No liveness, only composition.** The pill says whether the deployment composes the plugin, not whether the bridge process is up and the socket connected. Reporting that needs a status face on the channel plugin, which none has yet.
- **The nav row takes the fallback icon.** `ui-settings-general` maps section ids to icons and is an upstream file this fork does not patch, so `connectors` draws the generic settings glyph.
- **The bridge's own config is out of reach.** Allowlists, event config dirs, and the bot open id live in the bridge's `config.json`, not in a settings namespace, so this page cannot show or edit them.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Card chrome (`ConnectorCard`), controls, and the staged form are internal: the client bundle gate forbids importing them across packages, so a channel registers its card here rather than reusing them elsewhere. The nav row falls back to the generic settings glyph because `ui-settings-general` is an upstream file this fork does not patch.

</details>
