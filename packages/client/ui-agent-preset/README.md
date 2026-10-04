---
description: "Choose Agent presets and the new-task default in Web, read what each mode does and what it declares. Authoring is guided to Creator mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

English | [中文](README.zh.md)

## Summary

Choose Agent presets and the new-task default in Web, read what each mode does and what it declares. Authoring is guided to Creator mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Settings shows the built-in and custom card groups with default highlighting and card-body selection; a group without presets is omitted, except the custom group, which keeps its Creator entry on screen. Every card offers “View configuration”, which opens the preset's declared plugin list as read-only YAML in the Loader's own dialect (`!!js` conditions included); a failed preset stays readable because its diagnostic points into that YAML. Escape closes only the viewer and returns focus to its card; leaving Settings clears the viewer, and a late read does not reopen it. The page edits nothing: the Creator entry starts a Creator-mode task that authors or overrides a preset as a bundle, offered while the `cordis` preset is on the roster and a conversation flow exists.

Coding Tools in General Settings decide whether a mode can be chosen at all: with them off the new-session picker disappears, while the settings cards still choose the saved default that keeps composing new tasks and Creator stays available. With Coding Tools on, choosing a healthy default also synchronizes the blank session on the current new-task surface; with them off, a reused blank session keeps its preset. Creator starts a new task using the `cordis` preset.

## The session-header surface

A third surface sits beside the session title. While the session is blank, it reuses the new-session picker so a preferred workspace such as Writing can replace the Hero without removing the control needed to leave that preset. After the first turn starts, it becomes static chrome naming the preset THIS session runs; a control then would promise a switch the host refuses outright. It reads the preset from the session's own summary and resolves the display name against the same roster the General row reads. Forwarded `agent-preset/selected` owner events fold committed blank-session switches into that shared summary in every tab; the initiating tab may already have applied the RPC echo, and the merge is idempotent.

Known shipped presets offer mode details and usage examples in a read-only dialog. Its tabs preserve each page's scroll position; closing returns focus to the opening action. Help does not change the new-task default. The default badge replaces the card's group badge, and the preset id appears beside the title. Guide copy and examples belong to this package.

Preset files publish one unlocalized `name` and `description`, which Web uses for any declaration that names itself. For the shipped ids (`standard`, `anchored-standard`, `minimal`, `cordis`, `ptc`, `writing`, and `ued`), Web resolves both fields from its active locale instead; the shared fold in `dsh-agent-preset-registry/display` carries the four upstream ids, and this plugin extends it with the three the fork ships from the same bundle.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`agentPresets/list` supplies the roster and marks the current default, and `agentPresets/read` one declaration's YAML for the viewer; default changes write the `agent-preset-registry` settings namespace. The picker, blank-session synchronization and read-only session label use recorded preset identities. Connection resets and settings updates refresh the roster.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected preset, whose plugins own model-visible capabilities.

#### KV Cache effect

Selection changes affect only later tasks; existing plugins and prompts remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Web creates and edits no preset: the configuration viewer is read-only, and a bundle installed through Creator mode declares a new preset or overrides a shipped one by row id, replacing its complete child list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published; the Host registry owns state, and component tests cover client presentation and selection.
