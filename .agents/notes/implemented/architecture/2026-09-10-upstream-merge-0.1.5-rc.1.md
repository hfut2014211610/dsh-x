# Agent Note: Upstream merge to 0.1.5-rc.1

Status: implemented

English | [中文](2026-09-10-upstream-merge-0.1.5-rc.1.zh.md)

## Problem

The fork stood on upstream 0.1.2-alpha.5 while upstream shipped 0.1.5-rc.1: 171 fork-only commits against 1459 upstream commits. Three upstream evolutions collided head-on with fork-owned surfaces: both sides had independently created `apps/desktop/`, upstream renamed `native/landlock-run` to `native/system`, and the session format pipeline replaced per-row event arrays with the single-pass `SessionFormatRestore` while removing `assistant/chunk` events entirely.

## Decision

Merge `upstream/master` (0.1.5-rc.1) into the fork and cut `0.1.5-rc.1-x.0.10`, then switch the desktop product to the upstream Electron shell (see below), releasing `0.1.5-rc.1-x.0.11` from it:

- Adopt `apps/desktop` and `apps/desktop-host` wholesale; the fork's Stage A sidecar shell is deleted. The fork's `desktop-release.yml` flow is rewritten around the upstream `package-target.ts` pipeline (packed family closure, so fork packages ride the runtime).
- The update channel is this repository's GitHub Releases instead of the upstream Tencent COS deployment (the fork holds no COS credentials); code signing stays an unsigned-but-valid fallback, engaging only when its environments exist.
- Fork manifests keep carrying the upstream version verbatim (`0.1.5-rc.1`); the fork serial rides the packaged manifest through `extraMetadata` (`DSH_DESKTOP_VERSION`), never the source tree.
- Re-port the two-writer overlap recovery onto the restore pipeline: the scanner retains fed rows and, on a restarting seq, rebuilds the restore over the spared prefix so the later numbering still wins. `overlaps`/`overlapFloor` semantics are unchanged.
- Port `usage-stats` and the Feishu renderer off `assistant/chunk`: usage travels on `assistant/message`, attempts without messages leave no record, and the card renders whole messages.
- Union the web-app/CLI compositions (upstream `open-in-app`, `file-uploads`, frontend-static rows plus the fork's Feishu/writing/model-hub rows).

## Alternatives considered

Keeping the fork's sidecar shell was the merge's first resolution and was then reversed: carrying a parallel shell permanently re-pays this merge's desktop conflict on every upstream sync, while the sidecar's real assets (the automated release flow and the GitHub update channel) port onto the upstream shell. Rebasing the fork instead of merging was rejected: 171 commits of review history are worth more than a linear log. Downgrading the overlap tests to assert refusal was rejected and then unneeded: the restore-aware re-port keeps the recovery the desktop-plus-CLI sharing scenario relies on.

## Verification

`release:verify --family dsh` (281 members at `0.1.5-rc.1`), `typecheck` (host and client faces), `lint`, the `usage-stats`/Feishu/session-persistence/ui-conversation/subprocess suites (including the re-homed v3 overlap tests), and `test:docs` are green on the merge.

## Consequences

Failed attempts settle no usage record: steps without an `assistant/message` are unbilled by design, where the old pipeline billed streamed chunk samples. The fork's `minimal` preset keeps its editor and Git-Bash rows against upstream's shell-only minimal. Browser snapshot goldens were not re-recorded locally; the web replay lanes in CI own that signal.
