# @deepseek-ai/dsh-tool-documents

English | [中文](README.zh.md)

Model-facing document tools for writing mode: `document_search`, `document_read`, `document_outline`, `document_create`, and `document_edit`. The package registers the five `document_*` tools on `ctx.tools` and the writing guidance section on `ctx.systemPrompt`.

## Result projections

`render` is what reaches the model; the validated `output.schema` value does not. Three projections therefore carry more than a body. `document_read` prefixes its content with `path`, `version`, and — only when the content was clipped — `truncated`: the version has no other source, so a body-only projection leaves `document_edit`'s `base_version` unobtainable and every guarded edit fails as stale, and line locators aimed at a clipped body would address the wrong lines of the whole document. `document_create` and `document_edit` each report the version their own write produced, so a follow-up edit needs no extra read.

`document_create` and `document_edit` declare `locations` on their call view — a diff card against nothing for a create, a generic `edit` card for a located edit, which has no prior content to diff. That is the vocabulary [`dsh-client-ui-deliverables`](../../client/ui-deliverables/README.md) reads to list a produced file; it recognizes a mutation by render intent, never by tool name.

## Model Experience

Indirectly, through the generated tool catalog and system-prompt renderer, which own the model-visible schemas and guidance text.

#### KV Cache effect

No direct invalidation; the named renderers own any request-prefix changes.

## Known Limitations and Deferred Work

- **Structured formats are supported through extracted-text round-trips** — advanced formatting preservation is out of scope.
