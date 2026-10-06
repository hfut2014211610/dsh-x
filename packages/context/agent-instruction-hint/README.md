# @deepseek-ai/dsh-agent-instruction-hint

English | [中文](README.zh.md)

## Summary

`instruction-hint` replaces the full AGENTS.md/CLAUDE.md digest that `@deepseek-ai/dsh-agent-instructions` injects with a single one-shot hint naming which instruction files exist.

The model learns the files are there, so it reads them before acting, without their content entering every request. It reads them itself through the filesystem tools when a task needs them.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Understand the implementation](#understand-the-implementation)
  - [Which files it names](#which-files-it-names)
  - [Once per session](#once-per-session)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The hint](#the-hint)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [The project root is not the working directory](#the-project-root-is-not-the-working-directory)
  - [A failed probe costs the hint](#a-failed-probe-costs-the-hint)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

Add the row after `context-gate` and `tool-bootstrap`. The plugin prepends its `agent/pre-step` listener, so it runs inside the gate's outermost strip — but it emits only after promotion, when that strip is inactive.

```yaml
- id: instruction-hint
  name: '@deepseek-ai/dsh-agent-instruction-hint'
```

The composition must mount the session projection registry; the plugin fails loudly without it.

### Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `promoteOn` | `either` | Which durable signal promotes this session before its hint is injected. |
| `includeSubagents` | `false` | Whether subagents wait for their own promotion signal. |

An unknown key fails when the row mounts.

### Subagents

A subagent (`delegationDepth > 0`) reads as promoted, so it receives its hint on its first request. Set `includeSubagents: true` to make it wait for its own first reply or tool call, which also keeps the hint out of the context gate's stripped first request. Keep this flag equal to the two companion rows' flags.

## Understand the implementation

### Which files it names

The project chain is walked from the session's working directory up to the first ancestor holding `.git`, `.hg`, or `.svn`; that directory is probed for `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, and `CLAUDE.local.md`. `$DSH_HOME/AGENTS.md` is probed separately as the user-global file.

The walk reuses the harness's own home resolution rather than reading `DSH_HOME` and `USERPROFILE` itself.

Probing goes through a two-question seam — does this path exist, is it a regular file — adapted from the host `fs` service. A test supplies that seam directly, so no test needs the whole filesystem service.

### Once per session

A session projection records that the hint reached the durable log, so a process restart cannot inject a second copy. An in-process claim set additionally keeps two concurrent steps of one turn from both probing.

The hint carries its own `instruction-hint` source kind. Earlier fork releases recorded it under the released `plugin` kind, which 0.2.0 removed; that spelling is still recognized when folding, because released-format migration refuses a kind it no longer knows and an unreadable log is worse than a presentation label.

### Failure behavior

A missing filesystem seam, an unreadable probe, and an aborted step all degrade to no hint. The claim is taken before probing, so a probe that then fails costs this session its hint rather than risking two hints. Any other failure skips the hint and warns once. Downstream listener errors propagate untouched.

## Further Exploration

- The promotion phase this plugin waits for: `packages/compaction/compaction-epoch`
- The injection gate that strips the first request: `packages/guard/context-gate`
- The full injection this replaces: `packages/context/agent-instructions`
- Waterfall semantics: `docs/cordis-primer.md`

## Model Experience

### The hint

After the session's first durable promotion signal, the model receives one short user message listing the instruction files that were found and their project root, followed by an instruction to read the relevant files first and not to assume their content. No file content is included. A session with no instruction files receives nothing.

### Token effect

The hint is a few dozen tokens once per session, against the full digest it replaces, which repeats in every request for as long as the workspace baseline holds.

### KV Cache effect

The hint is prepended to the step's messages rather than appended to the prompt prefix, so it does not invalidate the cached prefix. It appears once; the messages that follow it are unaffected.

## Known Limitations and Deferred Work

### The project root is not the working directory

The hint names the project root, not the session's working directory. A nested workspace whose instruction files live closer to the cwd than the root marker is therefore described from the root.

### A failed probe costs the hint

The claim precedes the probes, so a filesystem that rejects the first probe leaves the session without a hint for its whole life. That trade keeps two concurrent steps from emitting duplicate hints; the alternative is a per-session timer or a lock this plugin does not need under normal operation.

### No published invariant

The plugin owns one projection flag and holds an in-process claim set with no durable counterpart. There is no second observation that could diverge from the flag, so no `./invariant` source is published; the projection registry cross-checks the unit it owns.
