# Agent Note: Writing editor with a companion conversation

Status: implemented

English | [中文](2026-08-18-writing-editor-companion-layout.zh.md)

## Problem

Writing sessions need document editing and model collaboration at the same time. A view-tab switch makes the user leave the document to read or send a message, while a second chat implementation inside the writing plugin would duplicate transcript state, composer behavior, approvals, queue handling, and future conversation changes. A path-only open form also makes document discovery depend on remembering the workspace layout.

Manual and model edits also share one file. A browser editor must not replace an unsaved local draft when a `documents/changed` event announces a newer version.

## Decision

`ui-conversation` exposes `ctx.conversation.declareCompanionView(resolver)`. A resolver returns a registered `conversation.view` id and localized panel label for one session and active view. The session body renders the active and companion entries through its existing child render share, while retaining one chat store and one resident composer. Missing, self-referential, and unregistered companion ids are ignored.

`ui-writing` declares Chat as the companion only when the `writing` view is active in a session whose `agentPreset` is `writing`. The conversation tab strip is hidden in that state. The editor occupies the primary column with a narrow document-tool rail; the existing Chat view receives an independent scrollport in the companion column, and the existing composer is positioned at the bottom of that column. Sessions without a companion keep the ordinary single-view layout.

The writing view provides file, outline, and workspace-search panels around a focused source editor. The documents service lists one bounded, workspace-relative directory level at a time. The file panel loads the root automatically and reads child levels only when their directory rows expand; opening a file from the tree leaves the panel available for the next switch. Markdown documents open in the shared draft's rendered preview and can switch back to source editing without a read or write. It saves explicitly with the version returned by the last read. A matching `documents/changed` event reloads the document when the editor is clean. If the draft differs from the last saved content, the editor preserves it and presents a conflict notice that offers an explicit reload.

## Alternatives considered

**Keep Writing and Chat as mutually exclusive tabs.** This retained the existing view ring without another extension, but interrupted document context for every model exchange and did not satisfy simultaneous collaboration.

**Import and render ChatView from ui-writing.** This violated client plugin isolation and would have given the writing plugin knowledge of conversation internals. Reimplementing the chat would also create divergent state and behavior.

**Replace the conversation shell for writing sessions.** This could match the layout directly, but it would take ownership of the composer and every conversation child slot away from `ui-conversation`, breaking optional approvals, docks, input controls, and future contributors.

**Use `host.listDirectory` for the file tree.** That API lists directories for workspace selection and returns absolute host paths, but the writing panel needs files and workspace-relative document paths. Keeping document discovery on `ctx.documents` preserves containment and avoids widening the workspace picker into a file browser.

## Consequences

The companion declaration is a reusable presentation extension, but it deliberately supports one secondary view rather than an arbitrary pane tree. The writing workspace is desktop-first and uses a bounded companion width; narrower desktop windows preserve the assistant at 320 px and reduce the editor column. Directory browsing performs no eager recursive scan; each level has a configurable result cap and reports truncation in the tree.

There is still one conversation transcript, input machine, and composer. A writing session with a previously persisted explicit Chat selection may initially show the ordinary tab layout; selecting Writing restores the combined workspace. Markdown source editing remains plain text, and explicit save remains a visible limitation until format-specific browser editors are introduced.

Focused GUI coverage pins companion rendering, ordinary-session fallback, lazy directory expansion, tree-based document switching, document open/save/search/outline behavior, new-window URLs, read failures, and dirty-draft conflict protection. The assembled Web replay and visual comparison cover the integrated layout.
