/**
 * custom-bash — a Windows-capable `bash` tool that registers under the SAME
 * name (`bash`) as the official persistent bash, with a Minimal-compatible
 * description, but executes through the `ctx.subprocess` spawn seam instead of
 * a PTY.
 *
 * Ported from the community preset `dsh-anchored-standard` (MIT).
 *
 * WHY: the PTY seam this harness ships is linux/darwin-only in its local
 * implementation — `subprocess-local`'s process inspector rejects win32
 * ("terminal inspection is unsupported on platform win32"), so the persistent
 * shell cannot serve Windows. A custom tool that presents the same name and a
 * Minimal-like description but spawns Git Bash through the ordinary
 * (cross-platform) subprocess seam keeps the schema anchor without the PTY
 * dependency.
 *
 * Executable resolution happens while the preset mounts, before the tool is
 * published. An explicit config `bashPath` is authoritative. Otherwise the
 * plugin derives Git Bash from the PATH-resolved `git`, probes conventional
 * machine-wide and per-user roots, then resolves a bare `bash` from PATH.
 *
 * Semantics mirror the official bash tool's surface: `bash -c <command>` in a
 * fresh process, bounded output, non-zero exit reported not thrown. No OS
 * sandbox confinement on Windows (the sandbox backends are linux/ACL-scoped);
 * the tool description says so. Each call runs stateless in a fresh shell.
 */

import { posix, win32 } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'custom-bash'

/** The subprocess and tools services must exist before this tool can register. */
export const inject = ['subprocess', 'tools']

const DEFAULT_MAX_OUTPUT_BYTES = 64000

function executionPath(gitExecutable) {
  return gitExecutable.includes('\\') || /^[A-Za-z]:/.test(gitExecutable) ? win32 : posix
}

/**
 * Return Git Bash candidates in discovery order.
 * @param {NodeJS.ProcessEnv} env
 * @param {string | undefined} gitExecutable
 * @returns {string[]}
 */
export function bashCandidates(env, gitExecutable) {
  const candidates = []
  if (gitExecutable !== undefined && /[/\\]/.test(gitExecutable)) {
    const paths = executionPath(gitExecutable)
    const gitDirectory = paths.dirname(gitExecutable)
    const installRoot = paths.dirname(gitDirectory)
    const bashName = gitExecutable.toLowerCase().endsWith('.exe') ? 'bash.exe' : 'bash'
    candidates.push(
      paths.join(installRoot, 'bin', bashName),
      paths.join(gitDirectory, bashName),
      paths.join(paths.dirname(installRoot), 'bin', bashName),
    )
  }

  const environmentRoots = [
    [env.ProgramFiles, 'Git', 'bin', 'bash.exe'],
    [env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'],
    [env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'],
    [env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'],
  ]
  for (const [root, ...segments] of environmentRoots) {
    if (typeof root !== 'string' || root.length === 0) continue
    candidates.push(executionPath(root).join(root, ...segments))
  }

  return [...new Set(candidates)]
}

function gitBashCandidates(gitExecutable) {
  return bashCandidates(process.env, gitExecutable)
}

async function resolveCandidate(subprocess, command, signal) {
  try {
    const executable = await subprocess.resolveExecutable(command, undefined, signal)
    signal?.throwIfAborted()
    return executable
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  }
}

/**
 * Resolve and verify the executable before a `bash` tool can be registered.
 * @param {{ resolveExecutable(command: string, env?: object, signal?: AbortSignal): Promise<string> }} subprocess
 * @param {string | undefined} configuredPath
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<string>}
 */
export async function resolveBashExecutable(subprocess, configuredPath, signal) {
  if (configuredPath !== undefined) {
    try {
      return await resolveCandidate(subprocess, configuredPath, signal)
    } catch (error) {
      signal?.throwIfAborted()
      throw new AggregateError(
        [error],
        `custom-bash: configured bashPath ${JSON.stringify(configuredPath)} is not executable; point bashPath at Git Bash's bash.exe`,
      )
    }
  }

  const failures = []
  try {
    const git = await resolveCandidate(subprocess, 'git', signal)
    for (const candidate of gitBashCandidates(git)) {
      try {
        return await resolveCandidate(subprocess, candidate, signal)
      } catch (error) {
        signal?.throwIfAborted()
        failures.push(error)
      }
    }
  } catch (error) {
    signal?.throwIfAborted()
    failures.push(error)
  }

  try {
    return await resolveCandidate(subprocess, 'bash', signal)
  } catch (error) {
    signal?.throwIfAborted()
    failures.push(error)
  }
  throw new AggregateError(
    failures,
    'custom-bash: Git Bash is unavailable; install Git for Windows with git or bash on PATH, or set bashPath to an absolute bash.exe path',
  )
}

/** Tool parameter schema for the model-facing command. */
const commandSchema = {
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

/** Register the model-facing `bash` tool after its executable passes the mount-time preflight. */
export async function apply(ctx, config) {
  const bashPath = typeof config?.bashPath === 'string' && config.bashPath.length > 0 ? config.bashPath : undefined
  const maxOutputBytes = Number.isSafeInteger(config?.maxOutputBytes) && config.maxOutputBytes > 0 ? config.maxOutputBytes : DEFAULT_MAX_OUTPUT_BYTES
  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error('custom-bash setup disposed'))
    }
  })
  let shell
  try {
    shell = await resolveBashExecutable(ctx.subprocess, bashPath, setupAbort.signal)
  } finally {
    stopSetupCancellation()
  }

  ctx.tools.register({
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
    parameters: commandSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const signal = exec?.signal
      // The spawn seam takes no defaults: name the working directory explicitly.
      const workdir = typeof args.workdir === 'string' && args.workdir.length > 0
        ? args.workdir
        : exec?.agent?.session?.header?.cwd ?? process.cwd()
      const handle = ctx.subprocess.spawn({
        argv: [shell, '-c', args.command],
        cwd: workdir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: maxOutputBytes },
        },
        ...signal !== undefined ? { signal } : {},
        graceMs: 3000,
      })
      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        // A spawn-level failure (bad executable, EPERM) surfaces as a throw,
        // which the runtime turns into an isError result.
        throw new Error(`bash spawn failed: ${String(error)}`)
      }
      let stdout = ''
      let stderr = ''
      try {
        stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      } catch {
        // Collected readers may be unavailable on some backends; tolerate.
      }
      const text = [stdout, stderr].filter((part) => part.length > 0).join('\n')
      const tail = text.length > 0 ? text : `exit code: ${String(outcome.exitCode)} (no output)`
      if (outcome.exitCode !== 0) {
        // Non-zero exit is a reported failure, not a throw: the model sees the
        // command output plus the exit code.
        throw new Error(tail)
      }
      return { text: tail }
    },
  })
}
