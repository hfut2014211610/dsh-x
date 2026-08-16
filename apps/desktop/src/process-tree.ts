/**
 * Process-tree plumbing for the sidecar: the real `node:child_process` spawn
 * behind {@link RuntimeProcess} and the platform tree kill (Windows
 * `taskkill /T`, POSIX process-group signal). Kept apart from the Electron
 * glue so the kill discipline is unit-testable.
 * @module @deepseek-ai/dsh-desktop-shell/process-tree
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type { RuntimeSpawn } from './discovery.ts'
import type { RuntimeProcess } from './sidecar.ts'

/** Platform collaborators for {@link killProcessTree}; tests replace both. */
export interface ProcessTreeDeps {
  platform: NodeJS.Platform
  /** Windows tree kill executor; POSIX code paths never call it. */
  taskkill: (args: readonly string[]) => void
  /** Signal delivery; must throw for a dead pid the way `process.kill` does. */
  signalProcess: (pid: number, signal: NodeJS.Signals) => void
}

/** Real collaborators for the running process. */
const hostProcessTreeDeps: ProcessTreeDeps = {
  platform: process.platform,
  taskkill: (args) => { spawnSync('taskkill', args) },
  signalProcess: (pid, signal) => { process.kill(pid, signal) },
}

/**
 * Kill one spawned runtime and every descendant it created.
 *
 * On Windows the shell wrapper owns the tree, so `taskkill /T /F` walks it; on
 * POSIX the runtime was spawned detached as its own process-group leader, so
 * the group signal reaches descendants it forked. A pid that already exited is
 * success, not an error.
 * @param pid - the spawned process id.
 * @param deps - platform collaborators.
 */
export function killProcessTree(pid: number, deps: ProcessTreeDeps): void {
  if (deps.platform === 'win32') {
    deps.taskkill(['/PID', String(pid), '/T', '/F'])
    return
  }
  try {
    deps.signalProcess(-pid, 'SIGTERM')
  } catch (error) {
    // Group gone: the leader alone may remain (or nothing at all). Try the
    // bare pid so a leader that dropped its group still dies; ESRCH then means
    // the tree is already gone.
    try {
      deps.signalProcess(pid, 'SIGTERM')
    } catch (alreadyGone) {
      if (!(alreadyGone instanceof Error) || alreadyGone.message.includes('ESRCH')) return
      throw error
    }
  }
}

/**
 * Spawn one runtime under the real child_process and adapt it to
 * {@link RuntimeProcess}: stdout/stderr split into lines, exit forwarded,
 * tree kill wired.
 *
 * The environment is the shell's own environment merged with the candidate's
 * additions: `DSH_HOME` (and every other setting) reaches the runtime exactly
 * as this shell received it — the desktop surface shares the browser surface's
 * data root and creates no second one.
 * @param spec - launcher command, entry args, and environment additions.
 * @param args - the runtime's own arguments (`web --host 127.0.0.1 --port 0`).
 * @returns the adapted process.
 */
export function spawnRuntimeProcess(spec: RuntimeSpawn, args: readonly string[]): RuntimeProcess {
  const lineListeners = new Set<(line: string) => void>()
  const exitListeners = new Set<(code: number | null) => void>()
  const argv = [...spec.args, ...args]
  if (process.platform === 'win32') {
    // Windows resolves a PATH `dsh` through its shim only under a shell, and a
    // shell form receives one RAW command line: quote every element ourselves,
    // or a path with spaces (`DeepSeek Harness.exe`, an APPDATA username)
    // splits mid-path. The quoted shim name still resolves through PATHEXT.
    const quoted = [spec.command, ...argv].map(value => `"${value.replaceAll('"', '""')}"`).join(' ')
    const child: ChildProcess = spawn(quoted, {
      shell: true,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return adaptProcess(child, lineListeners, exitListeners)
  }
  // POSIX spawns the shebang directly, detached so the runtime leads its own
  // process group for the group signal teardown.
  const child: ChildProcess = spawn(spec.command, argv, {
    detached: true,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return adaptProcess(child, lineListeners, exitListeners)
}

/** Wire line splitting and exit forwarding onto one spawned child. */
function adaptProcess(
  child: ChildProcess,
  lineListeners: Set<(line: string) => void>,
  exitListeners: Set<(code: number | null) => void>,
): RuntimeProcess {
  let buffer = ''
  const emitLine = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8')
    let boundary: number
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary).replace(/\r$/, '')
      buffer = buffer.slice(boundary + 1)
      for (const listener of lineListeners) listener(line)
    }
  }
  child.stdout?.on('data', emitLine)
  child.stderr?.on('data', emitLine)
  let exited = false
  const emitExit = (code: number | null): void => {
    if (exited) return
    exited = true
    for (const listener of exitListeners) listener(code)
  }
  child.once('exit', (code) => { emitExit(code) })
  child.once('error', () => { emitExit(null) })
  return {
    pid: child.pid,
    onLine: (listener) => { lineListeners.add(listener) },
    onExit: (listener) => { exitListeners.add(listener) },
    killTree: () => {
      if (child.pid !== undefined) killProcessTree(child.pid, hostProcessTreeDeps)
      else child.kill()
    },
  }
}
