---
description: "Writing mode packages for document editing and revision: the documents seam, its local provider, model tools, and the writing policy section."
kind: "package-group"
---

# Writing

English | [中文](README.zh.md)

Writing mode packages for document editing and revision.

## Summary

The writing group gives sessions document editing and revision: a capability seam with shared vocabulary and a `documents/changed` event, a local workspace provider over `ctx.fs`, model-facing `document_*` tools, and the `writing:policy` prompt section. Mount the seam, provider, tools, and policy section as needed; each README owns its guarantees.

| Package | Path | Role |
|---|---|---|
| `@deepseek-ai/dsh-documents` | `packages/writing/documents/` | Document capability seam: shared vocabulary, service definition, `documents/changed` event |
| `@deepseek-ai/dsh-documents-local` | `packages/writing/documents-local/` | Local workspace provider over `ctx.fs` |
| `@deepseek-ai/dsh-tool-documents` | `packages/writing/tool-documents/` | Model-facing `document_*` tools |
| `@deepseek-ai/dsh-writing-mode` | `packages/writing/writing-mode/` | `writing:policy` system-prompt section |
