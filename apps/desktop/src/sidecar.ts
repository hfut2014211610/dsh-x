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
  /** The connected URL: the launch-token URL for token runtimes, origin `/` otherwise. */
  url: string
  /** Whether the shell owns (and therefore kills) the runtime process. */
  owned: boolean
  pid: number | undefined
  /**
   * Browser-session cookie minted from the launch token, held so the health
   * watch can keep probing an authenticated runtime. Undefined for legacy
   * tokenless runtimes and attached instances.
   */
  cookie?: string
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
  const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(\/\?token=\S+)?(?=$| )/.exec(line)
  if (match === null) return undefined
  return match[1] + (match[2] ?? '')
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

/**
 * Exchange the printed launch token for the browser-session cookie.
 *
 * Since the web authenticated its browser API, the readiness URL carries a
 * single-use launch token: `GET`ting it mints the signed cookie (303 to `/`)
 * that authenticates every later request, including the readiness probe and
 * the spawn handshake below. Runtimes that print a bare URL predate
 * the exchange and keep the legacy tokenless probe.
 * @param tokenUrl - readiness URL as printed by `dsh web`, token included.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns The `name=value` cookie pair, or undefined when the exchange fails.
 */
async function exchangeBrowserCookie(tokenUrl: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  let response: Response
  try {
    response = await fetchImpl(tokenUrl, { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
  } catch {
    return undefined
  }
  if (response.status !== 303 && response.status !== 302) return undefined
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) return undefined
  const pair = setCookie.split(';', 1)[0]?.trim()
  if (pair === undefined || pair === '' || !pair.includes('=')) return undefined
  return pair
}

/**
 * Whether one origin serves this app's index to a held browser-session cookie.
 *
 * The readiness poll, the spawn handshake, and the health watch share it: the
 * spawned runtime prints a launch token (not credentials), the exchange mints
 * the cookie, and every later check presents it. Runtimes that print a bare
 * URL predate the web's browser authentication and keep the legacy tokenless
 * probe.
 * @param origin - served origin without credentials.
 * @param cookie - browser-session `name=value` pair, or undefined for legacy hosts.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns True on HTTP 200.
 */
export async function servesAuthenticatedIndex(
  origin: string,
  cookie: string | undefined,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${origin}/`, {
      ...(cookie === undefined ? {} : { headers: { cookie } }),
      signal: AbortSignal.timeout(2_000),
      redirect: 'follow',
    })
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

  const webUrl: string = url
  const hasToken = webUrl.includes('?token=')
  const origin = new URL(webUrl).origin
  let cookie: string | undefined
  const ready = await waitUntil(deps.now() + options.readyTimeoutMs, deps, options.pollIntervalMs, async () => {
    if (!hasToken) return servesIndex(`${webUrl}/`, deps)
    if (cookie === undefined) cookie = await exchangeBrowserCookie(webUrl, deps.fetchImpl)
    const sessionCookie: string | undefined = cookie
    return sessionCookie !== undefined && servesAuthenticatedIndex(origin, sessionCookie, deps.fetchImpl)
  })
  if (!ready) {
    child.killTree()
    throw new SidecarError(`dsh did not answer on ${webUrl} in time`, lines.slice(-20))
  }
  // The readiness poll already holds a fresh cookie-authenticated 200; confirm
  // it once more (not the retired `host.describe` endpoint) before showing the
  // window. The runtime version was validated at discovery.
  const handshakeCookie: string | undefined = cookie
  const handshake = hasToken
    ? handshakeCookie !== undefined && await servesAuthenticatedIndex(origin, handshakeCookie, deps.fetchImpl)
    : await describeOrigin(origin, deps.fetchImpl, deps.randomUuid, 2_000) !== undefined
  if (!handshake) {
    child.killTree()
    throw new SidecarError(`authenticated handshake failed against ${webUrl}`, lines.slice(-20))
  }
  return {
    url: hasToken ? webUrl : `${webUrl}/`,
    owned: true,
    pid: child.pid,
    ...(cookie === undefined ? {} : { cookie }),
    onExit: (listener) => { child.onExit(listener) },
    kill: () => { child.killTree() },
  }
}
