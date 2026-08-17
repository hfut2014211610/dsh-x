# Agent Note: Writing mode for document editing and revision

Status: proposed

English | [中文](2026-08-17-writing-mode.zh.md)

## Problem

Long-form document work does not fit the current Web surface. The center column is always the conversation, document files are opened through external applications, and the standard agent preset exposes the full coding toolset. Users who want to draft, revise, or search documents must switch between dsh and an outside editor, keep model context aligned with file state by hand, and pay for tools the writing task never needs.

The product has no document-oriented mode. A writing session needs one editor surface for text, Markdown, code, Word, and Excel files; workspace-scoped content search; per-document structure navigation; document slices as prompt references; and live feedback from model edits into the editor.

## Proposal

Add **writing mode** as three cooperating parts. It introduces no generic mode registry and no agent-loop change:

- a shipped agent preset `writing` that contributes only the document tools and the writing policy prompt section;
- a host-side `documents` capability family that opens, slices, searches, outlines, creates, and edits workspace documents through the existing filesystem seam;
- a Web client plugin that contributes the editor view, the collapsible search overlay, the document tree and outline rail, and the `@doc` slice reference source.

The mode is per-session. The host capability is composed process-wide but is scoped to the calling agent's session workspace; only sessions created with the `writing` preset see the reduced toolset and the writing view as the default view.

### Composition

The Web preset mechanism owns the session plane; the existing [per-session agent presets decision](../../implemented/architecture/2026-08-03-per-session-agent-presets.md) applies unchanged. Host services are registries keyed by workspace or session, so one process instance serves every preset. The writing view is a `conversation.view` list entry; it does not replace the conversation slot, so the chat tab and composer remain available.

### Package topology

| Package | Path | Role |
|---|---|---|
| `@deepseek-ai/dsh-documents` | `packages/writing/documents/` | `Documents` Service Definition, shared locator/edit/error vocabulary, client-safe types, Typert Remote entry, and the `documents/changed` event declaration |
| `@deepseek-ai/dsh-documents-local` | `packages/writing/documents-local/` | Local provider over `ctx.fs`: path containment, format adapters, search index, outline, mutation, and Remote methods |
| `@deepseek-ai/dsh-tool-documents` | `packages/writing/tool-documents/` | Model-facing Consumer registering the five `document_*` tools and their card presentations |
| `@deepseek-ai/dsh-writing-mode` | `packages/writing/writing-mode/` | The `writing:policy` system-prompt section |
| `@deepseek-ai/dsh-client-ui-writing` | `packages/client/ui-writing/` | Browser plugin: writing view, search overlay, document tree and outline rail, editor adapters, `@doc` reference source, `documents/changed` application; the node half is empty |

The three document packages form one complete [capability seam](../../implemented/architecture/2026-06-13-capability-seams.md): Service Definition, local Service Provider, and model-facing Consumer.

### Document capability

The service resolves every relative path against the agent session cwd through `ctx.fs`, requires workspace containment, and returns the opaque fs version as an uninterpreted string.

**Version semantics.** The version string is the opaque `FsVersion` returned by `ctx.fs`; clients must not interpret it. The documents layer uses it only for stale guards and event propagation. The current local backend derives the token from high-resolution file metadata (`dev:ino:size:mtimeNs:ctimeNs`) and serializes mutations with a per-file lock; if content-hash semantics are later required, `documents-local` must add a content-derived version before delegating to `ctx.fs` or extend the fs provider. The `ctx.fs` lock is **per-file**: `apply` holds the lock on a single target file, making read-check-write one atomic interval. When two writers hold the same valid `baseVersion`, the one that enters the lock first wins; the second re-checks inside the lock, finds `baseVersion` no longer equal to the current version, and returns `DOCUMENT_STALE_VERSION`.

```ts ignore-check
type DocumentFormat = 'text' | 'markdown' | 'code' | 'docx' | 'xlsx'

type DocumentLocator =
  | { unit: 'line'; start: number; end: number }
  | { unit: 'paragraph'; start: number; end: number }
  | { unit: 'heading'; id: string }
  | { unit: 'block'; id: string }
  | { unit: 'cell'; sheet: string; range: string }

type DocumentEdit =
  | { kind: 'replace'; locator: DocumentLocator; text: string }
  | { kind: 'insert'; at: DocumentLocator; where: 'before' | 'after'; text: string }
  | { kind: 'delete'; locator: DocumentLocator }

type DocumentChange = {
  sessionId: SessionId
  path: string
  baseVersion: string
  version: string
  patches: DocumentPatch[] | null
}

// Element type for patches; null means the change is too large or not text-shaped — clients reload
type DocumentPatch =
  | { op: 'splice'; start: number; deleteCount: number; text: string } // line-level text patch (txt/md/code)
  | { op: 'replace'; locator: DocumentLocator; text: string }          // structured block replace (docx)
```

`DocumentChange.patches` is `null` when the change is too large or not text-shaped; clients then re-open the document instead of applying a local patch. Every mutation goes through one service entry point, `apply`, and emits `documents/changed` after the file write commits. The event joins the forwarded-event allowlist in `dsh-api-remotes`.

### Format adapters

| Format | Editor | Mutation capability |
|---|---|---|
| `.txt` and code | CodeMirror 6 with language modes | Full-fidelity line and paragraph edits |
| `.md` | CodeMirror 6 plus preview toggle | Full-fidelity line, paragraph, and heading edits |
| `.docx` | Block editor over sanitized preview | Paragraph/block text replace, insert, and delete; inserted runs inherit the anchor formatting; unsupported constructs fail with `DOCUMENT_EDIT_UNSUPPORTED` |
| `.xlsx` | Virtualized cell grid over SheetJS-extracted JSON | Cell and range value updates; formulas and values round-trip, complex styling is best-effort |

Adapters own parsing limits: compressed and uncompressed size caps, entry caps, external-entity rejection for OOXML, and bounded extracted text. `.docx` and `.xlsx` bytes never cross to the browser; only extracted, sanitized structured data does.

### Search

Search is a workspace-scoped, in-memory, lazily built index with incremental invalidation from file stat before each query. Text files are tokenized with Latin word splitting plus CJK bigrams; `.docx` and `.xlsx` are indexed through their extracted text. Relevance is BM25 over body text plus a filename boost and a title or outline boost. Results are ordered by score and bounded by configuration.

**Index limits.** Per-file extracted text is capped at 512 KB (excess is truncated and flagged as `truncated`). The total file count is bounded by `search.maxFiles` (default 50,000); files beyond the limit are skipped and a warning appears at the top of query results. For `.docx` and `.xlsx`, the format adapters enforce an additional 50 MB compressed / 200 MB decompressed size cap; files exceeding either limit are excluded from the index.

### Model plane

The shipped `writing` preset contains only the persona, `writing-mode`, and `tool-documents` rows. It contributes no shell, web, todo, plan, subagent, workflow, skill, ralph, goal, or generic file tools.

| Tool | Purpose | UI card |
|---|---|---|
| `document_search` | Find workspace documents by content keywords, ranked | `search` |
| `document_read` | Read a whole document or a located slice with its version | `generic` with locations |
| `document_outline` | Read the heading, block, or sheet structure | `generic` |
| `document_create` | Create a new supported text document (`.txt`, `.md`, or code files only; **`.docx` and `.xlsx` creation is not supported**) | `diff` |
| `document_edit` | Apply version-guarded replace, insert, or delete operations | `diff` call and result |

`document_edit` requires the version returned by a prior read; stale writes return `DOCUMENT_STALE_VERSION`. Tools use `ctx.fs` and dispatch the existing `fs/*` policy events, so sandbox and read-before-edit policy apply without a second permission system. The `writing:policy` prompt section requires every document change to go through `document_edit`.

**Locator × format validity.** Not every locator unit is valid for every format. The service validates at the tool call entry and returns `DOCUMENT_LOCATOR_UNSUPPORTED` for invalid combinations:

| Locator unit | txt / code | .md | .docx | .xlsx |
|---|---|---|---|---|
| `line` | ✓ | ✓ | ✗ | ✗ |
| `paragraph` | ✓ | ✓ | ✓ | ✗ |
| `heading` | ✗ | ✓ (ATX/Setext) | ✓ (Heading 1–6 style) | ✗ |
| `block` | ✗ | ✗ | ✓ (OOXML paragraph / table / list block) | ✗ |
| `cell` | ✗ | ✗ | ✗ | ✓ |

**Locator and edit semantics.** Line and paragraph numbers are 1-based inclusive ranges. `insert` places the new text immediately before or after the located unit; `delete` removes the unit. For `.xlsx`, only `replace` is supported (cell/range value updates); `insert` and `delete` return `DOCUMENT_EDIT_UNSUPPORTED`.

### Browser UI

The client plugin registers one `conversation.view` entry with id `writing`, one `shell.overlay` search entry, one `@doc` reference source through the input-trigger seam, and keyed tool cards. A small extension to the conversation view registry adds `preferredView(sessionId)`; the writing plugin prefers `writing` for sessions whose `agentPreset` is `writing`, while an explicit user tab selection still wins. This is the only change to `ui-conversation` or client runtime.

**`preferredView` extension-point interface.** The extension adds one public method to `ConversationViewRegistry` in `@deepseek-ai/dsh-ui-conversation`:

```ts ignore-check
interface ConversationViewRegistry {
  /** Existing: register a conversation.view entry */
  register(entry: ConversationViewEntry): void
  /** New: plugins call this to declare a preferred view for a given session.
   *  Resolvers run in registration order; the first non-null result wins.
   *  A view id persisted in the session summary from an explicit user tab selection
   *  takes precedence over any resolver's return value. */
  declarePreferredView(resolver: (sessionId: SessionId) => string | null): void
}
```

Blast radius: one type change and one call site in `ui-conversation`. Snapshot coverage must include the case where no `agentPreset` is set — `preferredView` returns `null` and the view falls back to the default `conversation`.

The writing view holds editor tabs in the center and a collapsible right rail with document tree and active-document outline. The search overlay is a collapsible floating panel at the top right; every hit offers open in the workspace or open in a separate same-origin window that reads the session id and path from the URL. Text documents autosave with debounce and an expected version; `.docx` and `.xlsx` save explicitly. User saves (manual or debounced) call the same documents service `apply` entry point with the editor's expected version, so model and user writes share one version-guarded mutation path. Stale versions never overwrite.

A selected line, paragraph, or section can be sent to the composer as a plain-text `<document-slice>` envelope carrying path, version, locator, and current text. Picking `@doc` inserts the same envelope, following the existing [plain-text reference decision](../../implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md). The envelope travels as ordinary `user/message` text, so it is logged and reconstructable without new session events or content blocks.

**`@doc` vs `@file`.** `@file` references a whole file path and lets the model read it with `document_read`; `@doc` references a located slice of an already-open document and embeds the text directly, so the model does not need to issue a separate read. Both are plain-text inserts and can appear in the same message.

**`<document-slice>` envelope format:**

```
<document-slice path="<workspace-relative path>" version="<opaque version string>" locator="<JSON-serialized DocumentLocator>" >
<referenced text, original line endings preserved>
</document-slice>
```

The `locator` field is a single-line JSON-serialized `DocumentLocator` object with no extra escaping. The model uses `path` + `locator` to locate the file position; `version` feeds into the version guard of a subsequent `document_edit`.

**Conflict UX for stale-version rejections.** When the model's `document_edit` returns `DOCUMENT_STALE_VERSION`, the editor shows a banner at the top of the active document ("Model edit rejected: document has been updated locally — ask the model to retry"). No merge dialog appears, and nothing is silently discarded. The user's next manual save or debounced autosave produces a new version; the model's next `document_read` picks it up.

### Data flows

1. The user creates a session with the `writing` preset; the session summary carries `agentPreset`, the preferred view selects `writing`, and the prompt assembles only the writing tools.
2. Opening a document resolves the path through `ctx.fs`, parses it in the format adapter, and returns surface, outline, and version to the editor.
3. A referenced slice is inserted into the composer as plain text and becomes one logged user message.
4. `document_edit` commits through `ctx.fs`, emits `documents/changed`, and every open window applies the patch or reloads on a version mismatch.

### Security and concurrency

- Every path resolves through `ctx.fs`; absolute paths outside the workspace, `..` escapes, and symlink escapes are rejected.
- Model and user writes share the existing sandbox and `fs/*` policy gate; neither Consumer bypasses it.
- Version guards plus the `ctx.fs` per-target lock give one winner and explicit staleness for everyone else.
- Search and outline return bounded extracts only; binary document bytes and full index contents never cross the wire.
- OOXML and spreadsheet parsing enforces size, entry, and external-entity limits; preview HTML is sanitized before rendering.

### Composition changes

- `packages/bundle/web-app/cordis.patch.yml` adds the `documents-local` host row and the `ui-writing` client row.
- `packages/api/remotes` imports and mounts the generated `documents` Remote and adds `documents/changed` to the forwarded-event allowlist.
- `apps/cli` ships `config/agent-presets/writing/` and depends on the preset's two host packages.
- `packages/README.md` gains the `writing/` group row; the tool, config, event, and module catalogs regenerate.
- A new `docs/subsystems/writing.md` reference and an updated architecture extension-point table accompany the change.

### Phasing

1. End-to-end text path: documents seam, txt/Markdown/code editing, preset, writing view, tree and outline, search, `@doc`, live `document_edit` feedback, and preferred view.
2. Structured formats: `.xlsx` grid editing, `.docx` block editing with sanitized preview, and the separate-window open path.
3. Enhancements: persistent or warmed search index, external-change watching, code symbol outline, `/writing` command, and an adopt-model-prose review panel.

### Open review decisions

1. **Does phase 2 include `.docx` block-level writes** (block editing, formatting inheritance, and explicit refusals), or does `.docx` stay read-only through phase 2 and block writes move to phase 3? (Phase 1 covers txt/Markdown/code only; `.docx` writes are out of scope for phase 1.)
2. Accept debounced autosave for text and explicit save for Word and Excel?
3. Accept that every document modification must go through `document_edit`, with no automatic adoption of model prose?
4. Accept a process-local search index that rebuilds after restart?
5. Enter writing mode through the preset picker only, or also add `/writing` for blank sessions?
6. Accept CodeMirror 6, a virtualized grid, and limited OOXML editing as the editor foundation?

## Alternatives considered

**A generic mode registry.** Rejected. Plan mode is deliberately session-specific logged state, and the agent preset mechanism already composes per-session tools and prompt sections. A new mode registry would duplicate composition authority without adding behavior.

**Reusing only the existing `tool-fs` and ripgrep tools.** Rejected for the session toolset. Those tools solve file discovery and text editing, but they do not index Word or Excel content, produce document outlines, or carry the slice and version vocabulary the writing view needs; they also keep the full coding toolset visible.

**A durable document store with its own session events.** Rejected. Files remain the source of truth and `ctx.fs` already provides atomic version-guarded mutation. Model tool calls are logged as ordinary tool events, and slice envelopes are logged as ordinary user text, so no new session event is needed for reconstructability.

**Replacing the `conversation` slot with a writing-only layout.** Rejected. The single slot is occupied by the conversation skeleton, and a replacement would remove the composer, chat tab, and every declared child seat. A `conversation.view` tab keeps those surfaces and adds the editor without owning them.

## Acceptance criteria

- A session created with the `writing` preset assembles exactly the five document tools and the `writing:policy` section; no shell, web, or generic file tools are visible.
- The writing view is the default view for such sessions, chat remains one click away, and explicit tab selection persists.
- Opening, editing, and saving txt, Markdown, and code files round-trips content and line endings without loss.
- Search returns filename and content matches ranked by relevance, supports Chinese keywords, and opens results both in the workspace and in a separate window.
- The right rail shows the document tree and active-document outline, and outline nodes navigate to the exact editor position.
- A line, paragraph, or section can be referenced into the composer as a plain-text slice that the model can follow back to the file.
- `document_edit` updates every open window through `documents/changed` and returns `DOCUMENT_STALE_VERSION` instead of overwriting a newer file state.
- `.docx` and `.xlsx` files open, outline, search, and support the adapter-limited edits declared above; unsupported constructs fail with a structured code, never silently corrupt the file.
- Unit, GUI, snapshot, and catalog gates cover the new packages and the assembled writing-session transcript.

## Risks

- `.docx` round-tripping preserves only the declared block-level subset; complex formatting, tracked changes, and embedded objects are explicitly out of scope and could surprise users.
- The in-memory search index can be slow on very large workspaces and loses its warm state on restart.
- CJK relevance quality depends on tokenization and boost tuning; the first release may need field iteration.
- Multi-window and model/user edit races are bounded by version guards but still surface as conflicts users must resolve.
- The `preferredView` extension touches shared client conversation machinery; its blast radius is small but requires snapshot coverage for ordinary sessions.
