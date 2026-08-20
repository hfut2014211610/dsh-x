# Writing workspace design QA

## Result

PASS. The implementation matches the selected desktop composition and has no open P0, P1, or P2 visual findings.

## Comparison input

- Reference: `C:/Users/60410/.codex/generated_images/01a0126a-d61a-7a40-ac6c-0109ec7c5234/exec-cbe69e30-31a6-49f3-8c31-d46ad890f69f.png`
- Implementation: `C:/Users/60410/.codex/visualizations/2026/08/18/01a0126a-d61a-7a40-ac6c-0109ec7c5234/implementation-writing-companion-preview.png`
- Directory tree: `C:/Users/60410/.codex/visualizations/2026/08/18/01a0126a-d61a-7a40-ac6c-0109ec7c5234/implementation-writing-directory-tree.png`
- Viewport: 1488 × 1056 CSS pixels at device scale factor 1
- State: dark theme, writing session selected, workspace tree loaded, `docs/subsystems/writing.md` opened from the expanded `docs/subsystems` branch in Markdown preview, companion conversation resident

## Findings

- P0: 0
- P1: 0
- P2: 0
- P3: 2 intentional deltas. The implementation uses an explicit Edit/Preview switch because the current document service stores Markdown source rather than rich editor state. The live companion screenshot contains historical tool-error rows from the selected persisted session; these are transcript data, not layout errors.

The implementation preserves the selected reference's global sidebar, narrow document rail, broad centered document surface, fixed companion conversation, independent scrolling, and bottom composer. The file rail now loads the workspace root automatically, expands directories in place, keeps the selected file visible, and leaves the tree open after navigation. The Markdown preview provides the reference's rendered-document hierarchy while source editing stays one action away and shares the same unsaved draft.

## Responsive and interaction checks

At 1024 × 768 the document editor, assistant transcript, and composer remain present and independently usable. Automatic root loading, lazy directory expansion, file selection, current-file highlighting, tree persistence after navigation, file open, Markdown preview, Edit/Preview switching, outline navigation, workspace search, dirty-state save enablement, and draft restoration were exercised in the in-app browser.

## QA history

1. The first comparison found that raw Markdown source reduced the document hierarchy relative to the reference.
2. A rendered Markdown preview backed by the same draft was added, with an explicit Edit/Preview switch.
3. The second same-viewport comparison closed the hierarchy mismatch and introduced no P0, P1, or P2 findings.
4. The workspace directory tree was added to the existing file rail and verified with `docs/subsystems/writing.md` selected while the rendered preview and companion conversation remained visible.
