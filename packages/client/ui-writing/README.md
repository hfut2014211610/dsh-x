# @deepseek-ai/dsh-client-ui-writing

English | [中文](README.zh.md)

Browser writing-mode plugin. It registers the `writing` `conversation.view` entry and declares it as the preferred view for sessions whose `agentPreset` is `writing`.

## Model Experience

None, as the browser-side writing plugin only registers a view tab; nothing here reaches a model request.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Editor is a Phase 1 textarea shell** — CodeMirror, tree/outline rail, search overlay, and `@doc` source are not yet implemented.
