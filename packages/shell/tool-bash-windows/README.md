# @deepseek-ai/dsh-tool-bash-windows

English | [中文](README.zh.md)

## Summary

`tool-bash-windows` registers a `bash` tool under the SAME name as the official persistent bash, with a Minimal-compatible description, but executes through the cross-platform subprocess seam instead of a PTY.

The PTY seam this harness ships is linux/darwin-only in its local implementation, so the persistent shell cannot serve Windows. Spawning Git Bash through the ordinary subprocess seam keeps the schema anchor without the PTY dependency.

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Mount-time preflight](#mount-time-preflight)
- [Understand the implementation](#understand-the-implementation)
  - [Executable discovery](#executable-discovery)
  - [One command per call](#one-command-per-call)
  - [Exit codes](#exit-codes)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The bash tool](#the-bash-tool)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [No Windows sandbox confinement](#no-windows-sandbox-confinement)
  - [State does not persist](#state-does-not-persist)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

Mount it in place of, not alongside, the persistent bash row on a Windows deployment. Both register under the name `bash`, so mounting both leaves the outcome to registration order.

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash-windows'
```

### Configuration

| Key | Default | Effect |
| --- | --- | --- |
| `bashPath` | discovered | Absolute path to Git Bash's `bash.exe`. Overrides every discovered candidate. |
| `maxOutputBytes` | `64000` | Per-stream output cap. |

An unknown key fails when the row mounts.

### Mount-time preflight

The bash executable is resolved and verified BEFORE the tool is published, so a deployment that cannot find Git Bash fails at mount with a fixable message rather than publishing a tool whose every call would fail.

Resolution order:

1. the configured `bashPath`
2. three candidates relative to the PATH-resolved `git` — its install root's `bin`, its own directory, and its parent's `bin`
3. the conventional roots: `Program Files`, `Program Files (x86)`, `LOCALAPPDATA\Programs`, and the Scoop shim
4. a bare `bash` from `PATH`

A configured path that does not resolve is an error naming the field. Every other failure collects into one `AggregateError` naming Git for Windows.

## Understand the implementation

### Executable discovery

A `git` carrying a path separator yields its relative candidates; a bare PATH name yields none, because its install location is unknown. Each root is joined with the path flavor that root itself uses, so a Windows drive path and a POSIX path both produce correct results, and the whole list is deduplicated preserving discovery order.

The resolution runs against a one-method seam rather than the whole subprocess service, which is what lets the discovery rules be tested without standing up a provider.

### One command per call

Each call spawns `bash -c <command>` in a fresh process with the working directory named explicitly — the spawn seam applies no defaults, so the tool passes the argument it chooses or the session's own cwd. Both streams are collected under the configured cap, then combined in order.

A backend may leave a collected reader unavailable; an unreadable stream contributes nothing rather than failing a command that already ran.

### Exit codes

A zero exit returns the combined streams, or `exit code: N (no output)` when the command printed nothing. A non-zero exit is reported as a tool failure carrying the same text, so the model sees the command's own output and exit status rather than an opaque exception. A spawn-level failure surfaces as a distinct message, because that one means the executable itself did not start.

## Further Exploration

- The subprocess seam: `packages/subprocess/subprocess`
- The tool bootstrap that keeps `bash` resident: `packages/tool/tool-bootstrap`
- The official persistent bash this replaces on Windows: `packages/shell/tool-bash-persistent`

## Model Experience

### The bash tool

The model sees a `bash` tool with a Minimal-shaped description: a shell command runs and nothing persists between calls. The description states plainly that there is no internet access through it, that state does not survive a call, and that on Windows the command runs without OS sandbox confinement.

### Token effect

The tool description is roughly eight short lines and is resident for the whole session, so its cost is paid once per request. Output is capped per stream at 64KB by default, which bounds what a single call can add.

### KV Cache effect

None beyond the tool schema being resident. A stateless `bash -c` call adds its output to the messages of that request rather than changing the prefix.

## Known Limitations and Deferred Work

### No Windows sandbox confinement

The sandbox backends this harness ships are linux- and ACL-scoped, so nothing confines a Windows command. The tool description says so, but a model that ignores the description is not stopped by anything.

### State does not persist

Each call is a fresh shell: no `cd`, no exported variable, and no background process survives. This matches the official bash tool's stateless contract and is what keeps one request's prefix stable, but it also means multi-step shell work must restate its own directory.

### No published invariant

The plugin resolves one executable, caches it, and registers one tool. There is no second observation of the cached path that could diverge, so no `./invariant` source is published; the subprocess seam owns the resolution it performs.