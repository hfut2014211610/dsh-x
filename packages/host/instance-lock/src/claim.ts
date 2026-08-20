/**
 * Whether another live runtime already owns this harness home.
 *
 * Two runtimes sharing one home share its session directory, and a session
 * directory has one numbering. That is not hypothetical: an 18,000-event
 * conversation once failed to load because a second runtime opened a log the
 * first was still streaming, decided the turn had been interrupted, and wrote
 * three closers at sequence numbers the first was about to use. The reader was
 * taught to recover from that; nothing stopped it happening.
 *
 * The claim is a file. A pid alone is not an identity — the operating system
 * reuses them, and a stale claim from a machine that lost power names a number
 * that now belongs to anything at all — so a claim is only honoured while the
 * pid it names is alive. A dead claim is taken over rather than obeyed,
 * because refusing to start over a note left by a crash would be worse than
 * the collision it was meant to prevent.
 *
 * Pure: it reads a claim and decides. The caller owns the filesystem and the
 * process table, which is what lets every branch be tested without either.
 * @module @deepseek-ai/dsh-host-instance-lock/claim
 */

/** What a running instance writes down about itself. */
export interface InstanceClaim {
  /** The runtime's process id. */
  pid: number
  /** Which profile it booted, so a refusal can say what is holding the home. */
  profile: string
  /** When it started, as an ISO timestamp; only ever shown to a person. */
  startedAt: string
}

/** What to do about the claim that is already there. */
export type ClaimVerdict =
  | { kind: 'take'; reason: string }
  | { kind: 'refuse'; held: InstanceClaim; reason: string }

/**
 * Decide whether this runtime may claim the home.
 *
 * @param existing - the claim already on disk, or undefined when there is none.
 * @param self - this runtime's pid, so a re-entrant claim is recognized rather
 *   than treated as a rival.
 * @param alive - whether a pid still names a live process.
 * @returns whether to take the home, and what to say either way.
 */
export function decideClaim(
  existing: InstanceClaim | undefined,
  self: number,
  alive: (pid: number) => boolean,
): ClaimVerdict {
  if (existing === undefined) return { kind: 'take', reason: 'no other runtime holds this harness home' }
  // Re-entering our own claim: a reload rewrites it rather than refusing to
  // start against itself.
  if (existing.pid === self) return { kind: 'take', reason: 'this runtime already held it' }
  if (!alive(existing.pid)) {
    return {
      kind: 'take',
      reason: `taking over the claim left by pid ${String(existing.pid)}, which is no longer running`,
    }
  }
  return {
    kind: 'refuse',
    held: existing,
    reason: `another dsh runtime already has this harness home: pid ${String(existing.pid)}, profile "${existing.profile}", started ${existing.startedAt}`,
  }
}

/**
 * Read a claim written by {@link formatClaim}.
 *
 * A file that is missing, unreadable, or not the shape this writes is read as
 * no claim at all. The alternative is refusing to start over a damaged note,
 * and a note is not worth that.
 * @param text - the file's contents, or undefined when there is no file.
 * @returns the claim, or undefined.
 */
export function parseClaim(text: string | undefined): InstanceClaim | undefined {
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { pid, profile, startedAt } = parsed as Record<string, unknown>
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined
    if (typeof profile !== 'string' || typeof startedAt !== 'string') return undefined
    return { pid, profile, startedAt }
  } catch {
    return undefined
  }
}

/**
 * Render a claim for the file.
 * @param claim - what to write down.
 * @returns the file's contents, newline-terminated.
 */
export function formatClaim(claim: InstanceClaim): string {
  return `${JSON.stringify(claim, undefined, 2)}\n`
}
