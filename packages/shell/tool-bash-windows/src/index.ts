/**
 * tool-bash-windows — a Windows-capable `bash` tool that registers under the
 * SAME name (`bash`) as the official persistent bash, with a
 * Minimal-compatible description, but executes through the `ctx.subprocess`
 * spawn seam instead of a PTY.
 *
 * WHY: the PTY seam this harness ships is linux/darwin-only in its local
 * implementation — `subprocess-local`'s process inspector rejects win32, so the
 * persistent shell cannot serve Windows. A custom tool that presents the same
 * name and a Minimal-like description but spawns Git Bash through the ordinary
 * cross-platform subprocess seam keeps the schema anchor without the PTY
 * dependency.
 *
 * Executable resolution happens while the plugin mounts, before the tool is
 * published. An explicit config `bashPath` is authoritative. Otherwise the
 * plugin derives Git Bash from the PATH-resolved `git`, probes conventional
 * machine-wide and per-user roots, then resolves a bare `bash` from PATH.
 *
 * Semantics mirror the official bash tool's surface: `bash -c <command>` in a
 * fresh process, bounded output, and a non-zero exit reported rather than
 * thrown. There is no OS sandbox confinement on Windows — the sandbox backends
 * are linux- and ACL-scoped — and the tool description says so. Each call runs
 * stateless in a fresh shell.
 *
 * @module @deepseek-ai/dsh-tool-bash-windows
 */

import { posix, win32 } from 'node:path'
import type { PlatformPath } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-bash-windows'

/** The subprocess and tools services must exist before this tool can register. */
export const inject = ['subprocess', 'tools']

/** Per-stream output cap when the deployment does not choose one. */
const DEFAULT_MAX_OUTPUT_BYTES = 64000

/** Drain window after exit, used by the provider's termination escalation. */
const GRACE_MS = 3000

/** Arguments the model-facing `bash` tool accepts. */
const COMMAND_PARAMETERS = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'The bash command to execute (`bash -c` string domain).',
    },
    workdir: {
      type: 'string',
      description: 'Optional working directory; defaults to the session cwd.',
    },
  },
  required: ['command'],
  additionalProperties: false,
}

/** The one canonical output field this tool produces: the combined streams. */
const OUTPUT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
}

/** Bash executable resolution. Invalid values fail plugin load. */
export interface Config {
  /** Absolute path to Git Bash's `bash.exe`. Overrides every discovered candidate. */
  bashPath?: string
  /** Per-stream output cap in bytes. */
  maxOutputBytes?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  bashPath: z.string(),
  maxOutputBytes: z.natural().min(1),
})

/**
 * Reject a config this plugin cannot act on. Schemastery passes unknown keys
 * through, so a preset typo would otherwise go unnoticed.
 *
 * @param config - the raw plugin config.
 * @throws when a key is unknown or `maxOutputBytes` is not positive.
 */
function rejectInvalidKeys(config: Config): void {
  const allowed = ['bashPath', 'maxOutputBytes']
  const unknown = Object.keys(config).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...allowed].join(', ')}`,
    )
  }
}

/**
 * Pick the path flavor a discovered root uses.
 *
 * @param root - an absolute path or drive-qualified executable path.
 * @returns the Windows or POSIX path implementation for it.
 */
function pathFlavor(root: string): PlatformPath {
  return root.includes('\\') || /^[A-Za-z]:/.test(root) ? win32 : posix
}

/**
 * Return Git Bash candidates in discovery order.
 *
 * A PATH-resolved `git` yields three relatives of its own directory first, then
 * the conventional machine-wide and per-user roots, deduplicated in that order.
 *
 * @param env - the environment mapping the roots are read from.
 * @param gitExecutable - the PATH-resolved `git`, when one was found.
 * @returns the absolute candidates, most specific first.
 */
export function bashCandidates(
  env: Readonly<Record<string, string | undefined>>,
  gitExecutable: string | undefined,
): string[] {
  const candidates: string[] = []
  if (gitExecutable !== undefined && /[/\\]/.test(gitExecutable)) {
    const paths = pathFlavor(gitExecutable)
    const gitDirectory = paths.dirname(gitExecutable)
    const installRoot = paths.dirname(gitDirectory)
    const bashName = gitExecutable.toLowerCase().endsWith('.exe') ? 'bash.exe' : 'bash'
    candidates.push(
      paths.join(installRoot, 'bin', bashName),
      paths.join(gitDirectory, bashName),
      paths.join(paths.dirname(installRoot), 'bin', bashName),
    )
  }

  const environmentRoots: readonly (readonly string[])[] = [
    [env.ProgramFiles ?? '', 'Git', 'bin', 'bash.exe'],
    [env['ProgramFiles(x86)'] ?? '', 'Git', 'bin', 'bash.exe'],
    [env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'],
    [env.USERPROFILE ?? '', 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'],
  ]
  for (const [root, ...segments] of environmentRoots) {
    if (root === undefined || root.length === 0) continue
    candidates.push(pathFlavor(root).join(root, ...segments))
  }

  return [...new Set(candidates)]
}

/**
 * The one subprocess operation this plugin needs while resolving its
 * executable. Narrower than the service, so resolution is testable without
 * standing up a provider.
 */
export interface ExecutableLookup {
  /** Resolve an absolute path or bare PATH name to a canonical executable path. */
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
}

/**
 * Resolve one candidate, letting an aborted lookup surface as an abort rather
 * than as a resolution failure.
 *
 * @param lookup - the seam the resolution runs against.
 * @param command - absolute path or bare PATH name.
 * @param signal - aborts the lookup.
 * @returns the canonical executable path.
 */
async function resolveCandidate(
  lookup: ExecutableLookup,
  command: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    return await lookup.resolveExecutable(command, undefined, signal)
  } catch (error: unknown) {
    signal.throwIfAborted()
    throw error
  }
}

/**
 * Resolve and verify the bash executable before the `bash` tool is registered.
 *
 * @param lookup - the seam the resolution runs against.
 * @param configuredPath - explicit `bashPath`, when the deployment set one.
 * @param env - environment the conventional roots are read from.
 * @param signal - aborts the lookup.
 * @returns the canonical bash executable path.
 * @throws when the configured path is unusable, or when no candidate resolves.
 */
export async function resolveBashExecutable(
  lookup: ExecutableLookup,
  configuredPath: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
): Promise<string> {
  if (configuredPath !== undefined) {
    try {
      return await resolveCandidate(lookup, configuredPath, signal)
    } catch (error: unknown) {
      signal.throwIfAborted()
      throw new AggregateError(
        [error],
        `${name}: configured bashPath ${JSON.stringify(configuredPath)} is not executable; point bashPath at Git Bash's bash.exe`,
      )
    }
  }

  const failures: unknown[] = []
  try {
    const git = await resolveCandidate(lookup, 'git', signal)
    for (const candidate of bashCandidates(env, git)) {
      try {
        return await resolveCandidate(lookup, candidate, signal)
      } catch (error: unknown) {
        signal.throwIfAborted()
        failures.push(error)
      }
    }
  } catch (error: unknown) {
    signal.throwIfAborted()
    failures.push(error)
  }

  try {
    return await resolveCandidate(lookup, 'bash', signal)
  } catch (error: unknown) {
    signal.throwIfAborted()
    failures.push(error)
  }
  throw new AggregateError(
    failures,
    `${name}: Git Bash is unavailable; install Git for Windows with git or bash on PATH, or set bashPath to an absolute bash.exe path`,
  )
}

/**
 * Read the tool's rendered text out of its canonical output value.
 *
 * @param value - the canonical output value.
 * @returns its `text` field.
 */
function renderedText(value: JsonValue): string {
  const { text } = value as { readonly text: string }
  return text
}

/**
 * Read the `command` argument out of one parsed call.
 *
 * Arguments are model-produced JSON, a boundary this tool validates itself: a
 * missing or non-string command runs nothing, which the shell reports as its own
 * usage text.
 *
 * @param args - the losslessly snapshotted call arguments.
 * @returns the command string, or the empty string.
 */
function readCommand(args: unknown): string {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ''
  const { command } = args as { readonly command?: unknown }
  return typeof command === 'string' ? command : ''
}

/**
 * Read the optional `workdir` argument out of one parsed call.
 *
 * @param args - the losslessly snapshotted call arguments.
 * @returns the working directory, or `undefined` to use the session's.
 */
function readWorkdir(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const { workdir } = args as { readonly workdir?: unknown }
  return typeof workdir === 'string' && workdir.length > 0 ? workdir : undefined
}

/**
 * Read both collected streams after the child settled.
 *
 * A backend may leave a collected reader unavailable, so an unreadable stream
 * contributes nothing rather than failing a command that already ran.
 *
 * @param handle - the settled subprocess handle.
 * @returns stdout and stderr, either possibly empty.
 */
function readStreams(handle: SubprocessHandle): { stdout: string; stderr: string } {
  let stdout = ''
  let stderr = ''
  try {
    stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  } catch (error: unknown) {
    void error
  }
  try {
    stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  } catch (error: unknown) {
    void error
  }
  return { stdout, stderr }
}

/**
 * Register the model-facing `bash` tool after its executable passes the
 * mount-time preflight.
 *
 * @param ctx - the plugin context; the tool is an effect of its fiber.
 * @param config - bash executable and output cap.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  rejectInvalidKeys(config)
  const bashPath = config.bashPath
  const maxOutputBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new Error(`${name}: the subprocess service is required`)
  }

  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error(`${name} setup disposed`))
    }
  })
  let shell: string
  try {
    shell = await resolveBashExecutable(subprocess, bashPath, process.env, setupAbort.signal)
  } finally {
    stopSetupCancellation()
  }

  ctx.effect(() => ctx.tools.register({
    name: 'bash',
    description: [
      'Run commands in a bash shell (Git Bash on Windows)',
      '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
      "* You don't have access to the internet via this tool.",
      '* You do have access to a mirror of common linux and python packages via apt and pip.',
      '* State does NOT persist across command calls: each call runs in a fresh shell.',
      "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
      '* Please avoid commands that may produce a very large amount of output.',
      '* NOTE: runs without OS sandbox confinement on Windows (no landlock); treat output as untrusted.',
    ].join('\n'),
    parameters: COMMAND_PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: JsonValue): ContentBlock[] => [{ type: 'text', text: renderedText(value) }],
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const { signal } = exec
      // The spawn seam takes no defaults: name the working directory explicitly.
      const workdir = readWorkdir(args) ?? exec.agent?.session.header.cwd ?? process.cwd()
      const handle = subprocess.spawn({
        argv: [shell, '-c', readCommand(args)],
        cwd: workdir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: maxOutputBytes },
        },
        signal,
        graceMs: GRACE_MS,
      })
      let outcome: { readonly exitCode: number | null }
      try {
        outcome = await handle.done
      } catch (error: unknown) {
        // A spawn-level failure (bad executable, EPERM) surfaces as a throw,
        // which the runtime turns into an isError result.
        throw new Error(`bash spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      const { stdout, stderr } = readStreams(handle)
      const combined = [stdout, stderr].filter(part => part.length > 0).join('\n')
      const tail = combined.length > 0 ? combined : `exit code: ${String(outcome.exitCode)} (no output)`
      if (outcome.exitCode !== 0) {
        // Non-zero exit is a reported failure, not a throw: the model sees the
        // command output plus the exit code.
        throw new Error(tail)
      }
      return { text: tail }
    },
  }))
}
