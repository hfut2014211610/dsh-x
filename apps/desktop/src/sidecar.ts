/**
 * The sidecar lifecycle: spawn a validated dsh runtime as a child process,
 * observe its readiness (URL line → HTTP 200 → `host.describe` handshake), and
 * own its teardown (process-tree kill). An attached serving instance skips the
 * spawn and is never killed by the shell.
 * @module @deepseek-ai/dsh-desktop-shell/sidecar
 */

import type { RuntimeCandidate, RuntimeSpawn } from './discovery.ts'
import { describeOrigin } from './rpc-probe.ts'

/**
 * The web arguments the shell always passes: loopback only, OS-assigned port,
 * and no browser — the Electron window is this product's only surface, and the
 * runtime's default "open the default browser" would put a second copy of the
 * UI on screen at every launch.
 */
const WEB_ARGS = ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'] as const

/** A spawned runtime as the sidecar sees it; every member is a test seam. */
export interface RuntimeProcess {
  pid: number | undefined
  onLine: (listener: (line: string) => void) => void
  onExit: (listener: (code: number | null) => void) => void
  /** Kill the whole process tree (Windows `taskkill /T`, POSIX process group). */
  killTree: () => void
}

/** Environment-injected collaborators. */
export interface SidecarDeps {
  spawn: (spawn: RuntimeSpawn, args: readonly string[]) => RuntimeProcess
  fetchImpl: typeof fetch
  randomUuid: () => string
  sleep: (ms: number) => Promise<void>
  now: () => number
}

/** Tunables for one sidecar start. */
export interface SidecarOptions {
  /** Deadline for the `dsh web:` URL line. */
  urlTimeoutMs: number
  /** Deadline for HTTP 200 plus the handshake. */
  readyTimeoutMs: number
  /** Poll interval while waiting for HTTP 200. */
  pollIntervalMs: number
}

/** One connected runtime. */
export interface SidecarHandle {
  /** The connected URL (`http://127.0.0.1:<port>/`). */
  url: string
  /** Whether the shell owns (and therefore kills) the runtime process. */
  owned: boolean
  pid: number | undefined
  /** Forwarded exit signal for owned runtimes; attached instances never emit. */
  onExit: (listener: (code: number | null) => void) => void
  kill: () => void
}

/**
 * Parse one stdout line of `dsh web` for its readiness URL.
 * @param line - one stdout line, verbatim.
 * @returns the loopback URL, or undefined when the line is not the URL line.
 */
export function parseWebUrlLine(line: string): string | undefined {
  const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)\b/.exec(line)
  return match?.[1]
}

/** Await a condition with a deadline, sleeping between attempts. */
async function waitUntil(
  deadlineAt: number,
  deps: SidecarDeps,
  pollIntervalMs: number,
  attempt: () => Promise<boolean>,
): Promise<boolean> {
  while (deps.now() < deadlineAt) {
    if (await attempt()) return true
    await deps.sleep(pollIntervalMs)
  }
  return false
}

/** Whether the served index responds HTTP 200. */
async function servesIndex(url: string, deps: SidecarDeps): Promise<boolean> {
  try {
    const response = await deps.fetchImpl(url, { signal: AbortSignal.timeout(2_000), redirect: 'follow' })
    return response.ok
  } catch {
    return false
  }
}

/** Error carrying the runtime's output tail for the loading screen. */
export class SidecarError extends Error {
  /** Last stdout/stderr lines before the failure. */
  readonly outputTail: readonly string[]
  /**
   * @param message - what failed.
   * @param outputTail - the runtime's final output lines, newest last.
   */
  constructor(message: string, outputTail: readonly string[]) {
    super(message)
    this.name = 'SidecarError'
    this.outputTail = outputTail
  }
}

/**
 * Connect this window to a runtime: spawn it when the candidate is spawnable
 * and walk the readiness chain, or attach to a serving instance.
 *
 * On any failure before readiness the spawned process is killed and the error
 * carries its output tail, so the loading screen can show why.
 * @param candidate - the validated runtime from discovery.
 * @param deps - environment collaborators.
 * @param options - deadlines and poll interval.
 * @returns the connected sidecar handle.
 */
export async function startSidecar(
  candidate: RuntimeCandidate,
  deps: SidecarDeps,
  options: SidecarOptions,
): Promise<SidecarHandle> {
  if (candidate.source === 'serving-instance') {
    const url = `${candidate.origin}/`
    const ready = await waitUntil(deps.now() + options.readyTimeoutMs, deps, options.pollIntervalMs, async () => servesIndex(url, deps))
    if (!ready) throw new SidecarError(`serving instance at ${candidate.origin} stopped answering`, [])
    return { url, owned: false, pid: undefined, onExit: () => {}, kill: () => {} }
  }

  const child = deps.spawn(candidate.spawn, WEB_ARGS)
  const lines: string[] = []
  child.onLine((line) => { lines.push(line) })
  let exitCode: number | null | undefined
  const exited = new Promise<number | null>((resolve) => { child.onExit((code) => { exitCode = code; resolve(code) }) })

  const urlDeadline = deps.now() + options.urlTimeoutMs
  let url: string | undefined
  child.onLine((line) => {
    const parsed = parseWebUrlLine(line)
    if (parsed !== undefined) url = parsed
  })
  while (url === undefined && exitCode === undefined && deps.now() < urlDeadline) {
    await Promise.race([deps.sleep(options.pollIntervalMs), exited])
  }
  if (url === undefined) {
    child.killTree()
    if (exitCode !== undefined) {
      throw new SidecarError(`dsh exited with code ${String(exitCode)} before serving`, lines.slice(-20))
    }
    throw new SidecarError('dsh did not print its serving URL in time', lines.slice(-20))
  }

  const indexUrl = `${url}/`
  const ready = await waitUntil(deps.now() + options.readyTimeoutMs, deps, options.pollIntervalMs, async () => servesIndex(indexUrl, deps))
  if (!ready) {
    child.killTree()
    throw new SidecarError(`dsh did not answer on ${url} in time`, lines.slice(-20))
  }
  const handshake = await describeOrigin(url, deps.fetchImpl, deps.randomUuid, 2_000)
  if (handshake === undefined) {
    child.killTree()
    throw new SidecarError(`host.describe handshake failed against ${url}`, lines.slice(-20))
  }
  return {
    url: indexUrl,
    owned: true,
    pid: child.pid,
    onExit: (listener) => { child.onExit(listener) },
    kill: () => { child.killTree() },
  }
}
