/**
 * The record one launch leaves behind about the runtime it owns, and the reap
 * that consumes it on the next launch.
 *
 * A normal quit kills the spawned tree, but a shell that is killed outright —
 * task manager, a crash, a power cut — never runs that path, and the runtime
 * it spawned keeps serving with nothing left to stop it. The next launch is
 * the only place that orphan can still be recognized, so each launch writes
 * down what it owns and reads that note back before spawning anything.
 *
 * Identity is checked twice before anything is killed, because a pid alone is
 * not an identity: the operating system reuses pids, and killing a reused one
 * would take down a process this shell never started. The note therefore
 * carries the origin the runtime served, and the reap kills only when the
 * recorded pid is still alive AND a dsh still answers on that recorded origin.
 * Passing both by accident needs pid reuse and an unrelated dsh on the same
 * OS-assigned port at the same moment.
 * @module @deepseek-ai/dsh-desktop-shell/owned-runtime
 */

/** What a launch writes down about the runtime it spawned. */
export interface OwnedRuntimeRecord {
  /** The spawned process id, root of the tree to kill. */
  pid: number
  /** The loopback origin it served, the second half of the identity check. */
  origin: string
}

/** Environment collaborators; every one is a seam the tests replace. */
export interface ReapDeps {
  /** The previous launch's record, or undefined when there is none. */
  readRecord: () => Promise<OwnedRuntimeRecord | undefined>
  /** Drop the record; called on every path, including the ones that kill nothing. */
  clearRecord: () => Promise<void>
  /** Whether a dsh answers `host.describe` on that origin. */
  describes: (origin: string) => Promise<boolean>
  /** Whether the pid still names a live process. */
  alive: (pid: number) => boolean
  /** Kill the whole tree rooted at that pid. */
  killTree: (pid: number) => void
}

/**
 * Reap the runtime a previous launch owned and did not get to stop.
 *
 * Every outcome clears the record: a note kept past its launch would be
 * re-examined forever, and each re-examination is another chance for the pid
 * it names to have been reused by something else.
 * @param deps - environment collaborators.
 * @returns one trail line for the connection log, or undefined when no
 * previous launch left a record to act on.
 */
export async function reapOwnedRuntime(deps: ReapDeps): Promise<string | undefined> {
  const record = await deps.readRecord()
  if (record === undefined) return undefined
  try {
    if (!deps.alive(record.pid)) {
      return `previous runtime (pid ${String(record.pid)}) had already exited`
    }
    if (!await deps.describes(record.origin)) {
      // Alive but not serving what it served: this pid belongs to something
      // else now. Walking away is the only safe move.
      return `previous runtime pid ${String(record.pid)} was reused by another process; left alone`
    }
    deps.killTree(record.pid)
    return `stopped an orphaned runtime (pid ${String(record.pid)}) still serving ${record.origin}`
  } finally {
    await deps.clearRecord()
  }
}
