# @deepseek-ai/dsh-host-instance-lock

English | [中文](README.zh.md)

Refuse to start a second `dsh` runtime against a harness home that already has one.

Everything a runtime owns under `$DSH_HOME` is written as though it is the only one. The settings document takes a writer lock per write, but the session directory has a single sequence per log and no lock at all. Two runtimes there do not fight over a file — they interleave numbering, which is how an 18,000-event conversation once became unreadable: a second runtime opened a log the first was still streaming, decided the turn had been interrupted, and wrote three closers at sequence numbers the first was about to use. The reader was later taught to recover from that; nothing stopped it happening.

## The guard is deliberately the blunt one

Making session ownership visible across processes is the thorough answer, and a much larger one: it needs an ownership protocol with a defined writer, release point, and crash recovery. Refusing to start a second runtime removes the situation instead of managing it.

A one-shot command that never boots this row — `dsh plugin`, `dsh --dump-config` — is unaffected, because it is not a runtime and writes no sessions.

## Refusing means `ctx.appExit`

Not a thrown `apply`. A plugin that throws leaves its own entry failed and lets the rest of the tree come up, which is the one outcome a guard must not have: the runtime would be running, without its guard, against a home someone else holds. `ctx.appExit` is the launcher's bounded exit — it disposes the tree and stops.

## The claim is a file, honoured only while its pid is alive

`instance.json` in the harness home carries the pid, the profile that booted, and a start timestamp for the refusal message. A pid alone is not an identity: the operating system reuses them, and a claim left behind by a machine that lost power names a number that now belongs to anything at all. So a dead claim is taken over rather than obeyed — refusing to start over a note left by a crash would be worse than the collision it was meant to prevent.

`src/claim.ts` decides all of this as a pure function over a parsed claim, this process's pid, and a liveness predicate. The caller owns the filesystem and the process table, which is what lets every branch be tested without either.

## Configuration

| Key | Default | What it does |
|---|---|---|
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Which home to guard. |
| `profile` | `unknown` | The profile name a refusal reports, so the message names something real. |
| `enforce` | `true` | Off is for a deployment that genuinely wants two runtimes on one home and accepts what that does to a shared session log. |

## Model Experience

None, as this package guards process startup and registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The claim is advisory, not a lock** — between reading the existing claim and writing its own, a second runtime starting at the same instant can pass the same check. The window is one file write wide and the situation it guards is a person launching twice, not a race; closing it properly means the ownership protocol this package exists to avoid needing.
- **A live pid on another machine reads as live here** — the claim carries no machine identity, so a shared network home would honour a claim whose pid happens to match a local process. Harness homes are local; a shared one would need a host field.
- **Refusal is all-or-nothing per home** — the boundary is the harness home, not the session directory, so two runtimes that would never touch the same session are still refused. Drawing it at the session directory is the larger answer noted above.
