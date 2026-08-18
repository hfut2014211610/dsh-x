# @deepseek-ai/dsh-client-ui-writing

English | [中文](README.zh.md)

Browser writing-mode plugin. It registers the `writing` `conversation.view` entry, temporarily promotes it over the session's persisted tab whenever `agentPreset` is `writing`, and places the existing Chat view and composer beside the editor through the conversation companion-view extension. A blank session enters this workspace as soon as the preset switch is confirmed; leaving the preset restores the previous conversation tab or the new-session Hero without overwriting that state.

The editor provides a focused text surface with file, outline, and workspace-search panels. The file panel loads the workspace root automatically, expands directories lazily, and keeps the tree open while files are switched. Opening or reloading a document refreshes its parent directory without collapsing expanded rows; a failed read or save does the same so a missing file is removed from the next listing. Markdown documents open in rendered preview and switch back to source editing without discarding an unsaved draft. An outline selection scrolls the rendered preview in place; source mode selects and reveals the provider-located heading, including repeated titles. Manual saves use the document version returned by the last read. A `documents/changed` event reloads a clean editor; when the user has unsaved text, the editor preserves that draft and shows a conflict notice instead of replacing it.

## Model Experience

None, as this package only inserts the current workspace-relative document path into the ordinary browser composer draft; the conversation package owns any resulting model-visible user message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Source editing is plain text** — Markdown has a rendered preview, but WYSIWYG Markdown, Word, and spreadsheet editing require format-specific browser editors; this package currently presents the structured formats' extracted text.
- **Saving is explicit** — there is no debounced autosave. The version guard prevents a stale manual save from overwriting a newer document.
