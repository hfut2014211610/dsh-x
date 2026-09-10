---
description: "Writing-mode browser view: document editor with preview, outline, and workspace search beside chat, gated on the writing agent preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-writing

English | [中文](README.zh.md)

Browser writing-mode plugin. It registers the session-owned `writing` `conversation.view` entry, activates it only while `agentPreset` is `writing`, and places the existing Chat view and composer beside the editor through the conversation companion-view extension. Writing is selected for a new or still-blank session and never appears as a tab in an ordinary or already-started session. A blank session enters this workspace as soon as the preset switch is confirmed; leaving the preset restores the previous conversation tab or the new-session Hero without overwriting that state.

The editor provides a focused text surface with file, outline, and workspace-search panels. The file panel loads the workspace root automatically, expands directories lazily, and keeps the tree open while files are switched. Opening or reloading a document refreshes its parent directory without collapsing expanded rows; a failed read or save does the same so a missing file is removed from the next listing. Markdown documents open in rendered preview and switch back to source editing without discarding an unsaved draft. An outline selection scrolls the rendered preview in place; source mode selects and reveals the provider-located heading, including repeated titles. Manual saves use the document version returned by the last read. A `documents/changed` event reloads a clean editor; when the user has unsaved text, the editor preserves that draft and shows a conflict notice instead of replacing it.

## Summary

This package is the browser writing-mode workspace for the `writing` agent preset: a document editor with rendered Markdown preview, outline navigation, and workspace search, sitting beside chat through the companion-view extension. Manual saves carry the last-read document version; external changes reload clean editors and raise conflict notices over unsaved drafts. Use it when a session edits documents rather than chats. It inserts only the workspace-relative path into the composer draft and owns no model-visible message.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only inserts the current workspace-relative document path into the ordinary browser composer draft; the conversation package owns any resulting model-visible user message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Source editing is plain text** — Markdown has a rendered preview, but WYSIWYG Markdown, Word, and spreadsheet editing require format-specific browser editors; this package currently presents the structured formats' extracted text.
- **Saving is explicit** — there is no debounced autosave. The version guard prevents a stale manual save from overwriting a newer document.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Saves must carry the document version from the last read; the guard is what keeps a stale editor from overwriting a newer document. A pick or edit is a reference, never a request: it lands in the composer draft and the user still states the change.

</details>
