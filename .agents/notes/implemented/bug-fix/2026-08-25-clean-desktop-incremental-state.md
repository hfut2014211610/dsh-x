# Agent Note: Clean desktop incremental compiler state with its output

Status: implemented

English | [中文](2026-08-25-clean-desktop-incremental-state.zh.md)

## Problem

`pnpm run clean` removed `apps/desktop/lib` but left `apps/desktop/tsconfig.tsbuildinfo`. The next project-reference build could trust the stale incremental record and report `TS6305` because the output files recorded as current no longer existed.

## Decision

The clean script recognizes the desktop application as a project-reference output owner and removes its `tsconfig.tsbuildinfo` whenever it removes `apps/desktop/lib`. The regression test creates both paths, runs the repository cleaner, and requires both to be absent.

## Alternatives considered

- **Keep the desktop build output.** Rejected because `clean` must return generated application output to a source-only state.
- **Delete every `tsconfig.tsbuildinfo` found recursively.** Rejected because the cleaner owns a closed set of build roots; an unrestricted recursive deletion could remove unrelated incremental state outside those outputs.
- **Require developers to run `tsc --force` after cleaning.** Rejected because the clean operation owns the inconsistent state and must remove it rather than shifting recovery to every caller.

## Consequences

- A clean desktop rebuild cannot reuse an incremental record for deleted output.
- The cleaner remains limited to explicit repository build roots and does not broaden its deletion scope.
