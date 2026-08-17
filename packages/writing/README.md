# Writing

English | [中文](README.zh.md)

Writing mode packages for document editing and revision.

| Package | Path | Role |
|---|---|---|
| `@deepseek-ai/dsh-documents` | `packages/writing/documents/` | Document capability seam: shared vocabulary, service definition, `documents/changed` event |
| `@deepseek-ai/dsh-documents-local` | `packages/writing/documents-local/` | Local workspace provider over `ctx.fs` |
| `@deepseek-ai/dsh-tool-documents` | `packages/writing/tool-documents/` | Model-facing `document_*` tools |
| `@deepseek-ai/dsh-writing-mode` | `packages/writing/writing-mode/` | `writing:policy` system-prompt section |
