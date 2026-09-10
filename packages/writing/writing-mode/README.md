---
description: "Writing-mode system-prompt section requiring all document changes through document_edit."
kind: "package-reference"
---

# @deepseek-ai/dsh-writing-mode

English | [中文](README.zh.md)

Writing-mode system-prompt section. It registers the `writing:policy` prompt section that requires all document changes to go through `document_edit`.

## Summary

This package contributes the `writing:policy` system-prompt section: the standing instruction that all document changes go through `document_edit`, keeping every mutation inside the version-guarded seam. It has no independent runtime behavior. Mount it when a writing preset must bind the model to the guarded editing path.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the system-prompt renderer, which owns the assembled model-visible text.

#### KV Cache effect

No direct invalidation; the named renderer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **No independent runtime behavior** — this package only contributes a prompt section.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None beyond the section text: the policy binds the model to `document_edit` so every mutation stays inside the version-guarded seam.

</details>
