# Agent Note: Windows preset Git Bash preflight

Status: implemented

English | [中文](2026-08-25-preset-git-bash-preflight.zh.md)

## Problem

The Windows `custom-bash` plugins in the shipped `minimal` and `anchored-standard` presets published a `bash` tool before resolving its executable. A host with Git for Windows available through its usual `cmd` directory could therefore mount either preset and expose the tool while bare `bash` was absent from `PATH`; the first model tool call discovered the missing executable. The delayed failure spent a model step on a capability the preset could not provide, and a PATH-resolved WSL shim could be selected instead of Git Bash.

## Decision

Both self-contained preset copies resolve and verify Bash during their asynchronous plugin load, before registering the tool. An explicit non-empty `bashPath` is authoritative. Without one, the resolver derives candidates from the PATH-resolved `git`, then checks the standard machine-wide, per-user, and Scoop Git for Windows roots before the provider's bare `bash` lookup. Every candidate is validated in the subprocess provider's execution world rather than by the host filesystem.

The candidate order follows the community `dsh-anchored-standard` resolver. That source resolves lazily on the first tool call; this harness adaptation performs the same discovery during plugin load because the composition cannot provide its advertised bootstrap tool without a valid Bash executable.

The resolved executable path is retained for every tool call in that preset mount. Disposal aborts an in-flight lookup through the subprocess resolver's signal. If every candidate fails, plugin load rejects with an aggregate diagnostic that names the installation and `bashPath` remedies; no unusable tool is published. This remains a mount-time dependency check rather than preset roster health, consistent with the [broken-preset decision](2026-08-09-broken-preset-roster-rows.md): discovery validates the composition file, while mounting resolves runtime dependencies and rolls the composition back on failure.

## Verification

The Windows shell composition suite loads both shipped plugin copies with a controlled subprocess provider. It proves the Git installation candidate is selected when bare `bash` is unavailable, the canonical path is reused without another lookup at execution, and total lookup failure rejects before tool registration. The shipped Web composition e2e test exercises `anchored-standard` on a Windows host where `git` is on `PATH` but `bash` is not, then executes its bootstrap `bash` successfully. No snapshot changes because the tool name, schema, description, and successful result remain unchanged.

## Alternatives considered

**Resolve bare `bash` at load and only improve the error.** Rejected because the normal Git for Windows `cmd` PATH entry proves the installed shell is usable even when its binary directory is not globally exposed.

**Fall back to `pwsh` under the `bash` tool name.** Rejected because the command language would no longer match the published schema, and the anchored preset depends on the real Minimal `bash` schema and semantics for its first request.

**Keep discovery lazy until the first tool call.** Rejected for this harness adaptation because a missing executable leaves the advertised bootstrap capability unusable and spends a model step before reporting the configuration failure. Plugin remounting re-runs discovery after Git Bash is installed or moved.

## Consequences

A genuinely missing Git Bash now prevents the preset from mounting instead of failing after a model selects the tool. Installations that expose `git.exe` but not `bash.exe` on `PATH` work without editing process environment. The cached path means moving or removing Git Bash after mount is detected at execution by the spawn failure and requires a remount to re-resolve. The two plugin files remain duplicated so copied presets are self-contained; changes to this executable policy must keep both copies aligned.
