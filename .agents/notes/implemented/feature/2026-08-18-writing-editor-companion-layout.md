# Agent Note: Writing editor with a companion conversation

Status: implemented

English | [中文](2026-08-18-writing-editor-companion-layout.zh.md)

## Problem

Writing sessions need document editing and model collaboration at the same time. A view-tab switch makes the user leave the document to read or send a message, while a second chat implementation inside the writing plugin would duplicate transcript state, composer behavior, approvals, queue handling, and future conversation changes. A path-only open form also makes document discovery depend on remembering the workspace layout.

Manual and model edits also share one file. A browser editor must not replace an unsaved local draft when a `documents/changed` event announces a newer version.

## Decision

`ui-conversation` exposes `ctx.conversation.declareCompanionView(resolver)`. A resolver returns a registered `conversation.view` id and localized panel label for one session and active view. The session body renders the active and companion entries through its existing child render share, while retaining one chat store and one resident composer. Missing, self-referential, and unregistered companion ids are ignored.

`ui-writing` declares Chat as the companion only when the `writing` view is active in a session whose `agentPreset` is `writing`. The conversation tab strip is hidden in that state. The editor occupies the primary column with a narrow document-tool rail; the existing Chat view receives an independent scrollport in the companion column, and the existing composer is positioned at the bottom of that column. Sessions without a companion keep the ordinary single-view layout.

The preferred-view declaration is a reversible override rather than a default used only when no tab was selected. While `agentPreset` is `writing`, the registered Writing view takes precedence without mutating the persisted tab. The root, header, and session body subscribe to that resolved preference; a blank session therefore leaves the Hero immediately after the preset switch, and returning to another preset restores the Hero or the prior active tab. Because the Hero preset chip would otherwise disappear with the Hero, the session-header preset surface reuses the same picker while the session remains blank and becomes the original read-only label after the first turn.

The writing view provides file, outline, and workspace-search panels around a focused source editor. The documents service lists one bounded, workspace-relative directory level at a time. The file panel loads the root automatically and reads child levels only when their directory rows expand; opening a file from the tree leaves the panel available for the next switch. A successful open or reload and a failed read or save refresh the document's parent listing without changing the expanded-directory set. Markdown documents open in the shared draft's rendered preview and can switch back to source editing without a read or write. An outline locator selects the matching rendered heading without leaving preview mode; source mode resolves the locator to an exact text range, focuses it, and scrolls the textarea to reveal it. Line locators distinguish repeated heading titles. It saves explicitly with the version returned by the last read. A matching `documents/changed` event reloads the document when the editor is clean. If the draft differs from the last saved content, the editor preserves it and presents a conflict notice that offers an explicit reload.

## Alternatives considered

**Keep Writing and Chat as mutually exclusive tabs.** This retained the existing view ring without another extension, but interrupted document context for every model exchange and did not satisfy simultaneous collaboration.

**Import and render ChatView from ui-writing.** This violated client plugin isolation and would have given the writing plugin knowledge of conversation internals. Reimplementing the chat would also create divergent state and behavior.

**Replace the conversation shell for writing sessions.** This could match the layout directly, but it would take ownership of the composer and every conversation child slot away from `ui-conversation`, breaking optional approvals, docks, input controls, and future contributors.

**Use `host.listDirectory` for the file tree.** That API lists directories for workspace selection and returns absolute host paths, but the writing panel needs files and workspace-relative document paths. Keeping document discovery on `ctx.documents` preserves containment and avoids widening the workspace picker into a file browser.

## Consequences

The companion declaration is a reusable presentation extension, but it deliberately supports one secondary view rather than an arbitrary pane tree. The writing workspace is desktop-first and uses a bounded companion width; narrower desktop windows preserve the assistant at 320 px and reduce the editor column. Directory browsing performs no eager recursive scan; each level has a configurable result cap and reports truncation in the tree.

There is still one conversation transcript, input machine, and composer. Entering Writing does not erase a user's prior tab selection, and leaving it does not require reconstructing layout state. Markdown source editing remains plain text, and explicit save remains a visible limitation until format-specific browser editors are introduced.

Focused GUI coverage pins immediate blank-session entry, Hero and prior-tab restoration, the blank-session header picker, companion rendering, ordinary-session fallback, lazy directory expansion, tree-based document switching, targeted parent-directory refresh after opens, reloads, and failures, preview and source outline navigation with repeated titles, new-window URLs, read failures, and dirty-draft conflict protection. The assembled Web replay covers outline navigation and the integrated enter-and-exit layout; visual comparison covers the combined workspace.
