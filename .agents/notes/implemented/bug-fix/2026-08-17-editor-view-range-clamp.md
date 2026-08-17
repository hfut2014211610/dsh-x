# Agent Note: str_replace_editor view clamps a past-EOF final line

Status: implemented

English | [中文](2026-08-17-editor-view-range-clamp.zh.md)

## Problem

The `view` command rejected any `view_range` whose final line exceeded the file's line count — `view_range=[1, 200]` against a 48-line file failed the whole call. Models pad the upper bound to mean "the rest of the file", so sessions paid a failed tool round-trip and a retry for a request the file could already answer; users saw the `Invalid view_range` error recur in real transcripts.

## Decision

`formatFileView` clamps a past-EOF final line to the file's last line and answers with the truncated range, echoing the effective (clamped) values in the prompt. Everything still invalid stays an error: wrong arity, non-integers, an initial line outside `[1, lines]`, and a final line smaller than the first (`-1` still means "to the end").

## Alternatives considered

**Keep the error and let the model retry.** Rejected: the error message restates the line count the successful answer would have shown, so the retry produces exactly the clamped result one round-trip later.

**Clamp the initial line too.** Rejected: an initial line past EOF selects nothing, so clamping it would invent a range the caller never named; failing there keeps the contract honest.

## Consequences

- A padded "rest of the file" view succeeds on the first call and reports the effective range, so the model learns the file's true extent from the same output.
- The tool's tests assert the clamp and still cover every remaining error path; per-file coverage stays at the repository's 100% gate.
