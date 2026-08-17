# Agent Note: Anchored Standard shipped preset

Status: implemented

English | [中文](2026-08-17-anchored-standard-preset.zh.md)

## Problem

DeepSeek V4-class models strongly condition their first chain-of-thought trajectory on the first model request's API-visible conditions. The upstream community reproduction (`dsh-anchored-standard`, MIT) measured three levers: the tool schema (the official Minimal pair anchored 5/5 runs; every standard-family schema fell to standard-like behavior 11/11), the first-request output budget, and auto-injected context (the skill catalog present: 0/9 anchored). The shipped presets force a choice between those conditions: `standard` exposes the full catalog and every injection from request #1, giving up the Minimal-condition trajectory; `minimal` keeps the trajectory forever but gives up every heavier tool. On the Project2-class evaluation the upstream preset family scored 98/99/99 across three V4 Pro runs against Standard's 91 — the two-phase composition is what recovers both.

## Decision

A fifth shipped preset, `apps/cli/config/agent-presets/anchored-standard/` (picker name 锚定标准模式, order 1.5, opt-in — `standard` stays the default). It composes the Standard roster with two phase-controlling rows ahead of it and two injection replacements:

- **`context-gate`** (mounted FIRST) closes both unified injection paths while the session is unpromoted: the assembly's `contexts` are blanked (the whole `SystemPrompt.context()` family, not a per-source denylist) and the pre-step waterfall keeps only the claimed message batch plus `allowKinds` (`skill-invocation` survives as a user gesture). Waterfall after-next transforms apply in reverse registration order, so first registration plus `prepend` listeners makes the gate the outermost transform.
- **`tool-bootstrap`** narrows request #1 to the Minimal preset's exact real pair — the persistent `bash` (sandbox `tool-bash` stays disabled everywhere; the persistent shell owns the name) plus `str_replace_editor` — then, once the session logs its first durable `tool/call` OR `assistant/message` (`promoteOn: either`), narrows to a resident set: the bootstrap pair, the three discovery tools, and whatever the model unlocked. A full-catalog dump at promotion measurably pulls the trajectory back (the post-promotion regression the upstream work fixed).
- **`instruction-hint`** replaces the `dsh-agent-instructions` digest row: after promotion, one durable-guarded hint tells the model the instruction files exist; the model reads them itself.
- **`skill-search`** replaces the `dsh-tool-skill` row: `skill_search`/`skill_load` on demand instead of the ~9KB `<available_skills>` catalog injection, keeping tool-skill's visibility rule (`invocation.modelInvocable`).
- **`dev-tool-search`** registers `dev_tool_search`: keyword search over the agent-scoped catalog plus exact-name unlock; unlocked names derive from durable `tool/call` arguments, so resume keeps them.

All phase state derives from durable session events through one epoch-aware tracker (`compaction-epoch.mjs`): a `compaction/end` boundary demotes to the bootstrap pair plus a `compactionTools` work set until a new promotion signal lands, so the first post-compaction request is a controlled "second first request". `includeSubagents: true` on the phase rows makes a delegation's first request anchor too. Missing bootstrap tools degrade to the full catalog with a one-time warning; invalid config fails at mount; the gate filters degrade to keeping context rather than eating it.

## Adaptations from the upstream preset

The upstream composition targeted harness `0.1.0-rc.5` and Windows via a `custom-bash` row because its PTY backend was linux/darwin-only. This harness's `spawnTerminal` runs node-pty directly, which read as cross-platform — but `subprocess-local`'s process inspector still rejects win32 at spawn time ("terminal inspection is unsupported on platform win32"), so the PTY seam is linux/darwin in practice. The port therefore keeps the upstream platform split: the persistent shell owns `bash` on linux/darwin, and a ported `custom-bash` (adapted to this harness's required-`cwd` spawn spec) owns the same name on win32, executing Git Bash through the ordinary subprocess seam. The shipped `minimal` preset carried the same win32 defect (its ungated persistent shell mounted but could not execute); this change gates it and mounts the same `custom-bash` there too.

The upstream `dev-tool-search` schema compiler also dropped the `toolNames` `items` field; the port passes it through. Skill visibility follows this harness's invocation policies, which upstream predates.

## Alternatives considered

**Ship the upstream variant family too (zero-anchored, whoami, prefab, eternal-minimal, wire-think, combo).** Rejected: they are comparison modes for the upstream evaluation loop — each buys its lever at a standing cost (an extra model call per session or per turn, sibling provider routes, prefix-cache churn) and their Project2-class scores are not separable from the base mode's. The base two-phase composition carries the measured win at zero standing cost; a variant can be ported later on demand.

**Keep `custom-bash` for Windows parity with upstream.** Kept: this harness's PTY primitive looked cross-platform (node-pty with no win32 guard), but the local subprocess provider's process inspector covers linux/darwin only and throws on win32 at spawn time, so the persistent shell cannot execute on Windows. A second `bash` implementation is the price of a working pair on every platform; its description differs (fresh shell, unsandboxed) and the e2e asserts the pair by EXECUTING it, not by catalog presence.

**Promote `anchored-standard` to the default preset.** Rejected: the trajectory claim is the upstream project's measurement on its evaluation, not re-verified against this fork's behavior; shipping it as opt-in lets it prove out per deployment while `standard` remains the unopinionated default.

**Cap the bootstrap request's output budget by default (`bootstrapMaxTokens`).** Rejected as default, kept as opt-in: the Minimal schema anchors at the adapter-default maxTokens, and the cap's delivery was profile-package dependent in the upstream reproduction; a shipped default should depend on the lever that is actually load-bearing.

## Consequences

- The picker gains a fifth shipped preset with its own UI locale entries (`presetAnchored*` in `ui-agent-preset`'s bundles, following the built-in mapping), and `web-agent-presets.e2e.ts` asserts the full list plus a new two-phase test: bootstrap pair and empty contexts → durable-reply promotion to the resident set → `dev_tool_search` search and durable unlock → compaction demotion to the bootstrap pair plus the work set.
- The preset directory is self-contained: its local `./…mjs` rows travel with it, so `agentPresets.copy` of it keeps working; upstream MIT attribution stays in the row files it came from.
- Prefix-cache continuity breaks at each catalog change (promotion, every unlock) — inherent to a phase-narrowed catalog, and the same trade the preset exists to make.
- The heavier Standard tools (`web_search`, `subagent`, `workflow`, `exit_plan_mode`, …) sit one `dev_tool_search` behind the resident set; sessions that never search see the two-tool surface, which is the Minimal pair's cost profile by design.
- The trajectory benefit is inherited evidence, not a local guarantee: the anchor conditions (schema, budget, injections) are asserted by the new test, the trajectory itself is not — a keyless test cannot assert model behavior.
