/**
 * Loading-screen state for the desktop shell: one serializable snapshot the
 * main process pushes to the renderer over the preload bridge. The store is
 * pure bookkeeping — phases, the selected runtime, and a bounded log — so the
 * renderer stays a function of the latest snapshot.
 * @module @deepseek-ai/dsh-desktop-shell/shell-state
 */

import type { RuntimeSource } from './discovery.ts'

/** Where the connection pipeline currently is. */
type ShellPhase = 'preparing' | 'discovering' | 'launching' | 'connecting' | 'ready' | 'failed'

/** The selected runtime, shown in the connection UI. */
interface ShellRuntimeInfo {
  source: RuntimeSource
  version: string
}

/** Everything the loading screen renders. */
export interface ShellSnapshot {
  phase: ShellPhase
  detail: string
  runtime?: ShellRuntimeInfo
  url?: string
  logs: readonly string[]
  /**
   * When the current phase began, as epoch milliseconds.
   *
   * The screen counts up from this rather than being told an elapsed number,
   * so a phase that takes minutes — a first run unpacking the bundled runtime
   * under antivirus — keeps visibly moving between snapshots instead of
   * looking stuck.
   */
  since: number
}

/** Default log bound; older lines drop off the loading screen first. */
const MAX_LOGS = 200

/** Mutable store emitting a fresh snapshot on every change. */
export interface ShellState {
  snapshot(): ShellSnapshot
  phase(phase: ShellPhase, detail?: string): void
  runtime(info: ShellRuntimeInfo): void
  ready(url: string): void
  log(line: string): void
}

/**
 * Create one shell state store.
 * @param emit - invoked with the new snapshot after every change.
 * @param maxLogs - log-line bound (tests use small values).
 * @param now - clock for phase timestamps.
 * @returns the state store.
 */
export function createShellState(
  emit: (snapshot: ShellSnapshot) => void,
  maxLogs: number = MAX_LOGS,
  now: () => number = Date.now,
): ShellState {
  let snapshot: ShellSnapshot = { phase: 'discovering', detail: '', logs: [], since: now() }
  const publish = (): void => { emit({ ...snapshot, logs: [...snapshot.logs] }) }
  return {
    snapshot: () => ({ ...snapshot, logs: [...snapshot.logs] }),
    phase: (phase, detail) => {
      // Only a real phase change restarts the clock: a phase re-reported with
      // fresh detail (a retry countdown ticking down) is the same wait.
      const since = phase === snapshot.phase ? snapshot.since : now()
      snapshot = { ...snapshot, phase, detail: detail ?? '', since }
      publish()
    },
    runtime: (info) => {
      snapshot = { ...snapshot, runtime: info }
      publish()
    },
    ready: (url) => {
      snapshot = { ...snapshot, phase: 'ready', url, detail: '', since: now() }
      publish()
    },
    log: (line) => {
      snapshot = { ...snapshot, logs: [...snapshot.logs, line].slice(-maxLogs) }
      publish()
    },
  }
}
