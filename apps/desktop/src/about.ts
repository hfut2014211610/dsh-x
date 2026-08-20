/**
 * The "About" facts, composed apart from the dialog that shows them.
 *
 * The version alone is the least interesting thing this window can say. The
 * shell either attaches to a dsh already serving or starts one of its own, and
 * which of those happened decides what a confusing session means: a stale
 * runtime someone left running looks exactly like a fresh one until something
 * behaves a version behind. So the runtime, where it came from, and the origin
 * the window is actually pointed at are the body of the message, and the
 * shell's own version is the title.
 *
 * Pure on purpose — `main.ts` has no unit tests, and the wording is the part
 * worth pinning.
 * @module @deepseek-ai/dsh-desktop-shell/about
 */

import type { RuntimeSource } from './discovery.ts'

/** Everything the About dialog reports, gathered from the live shell. */
export interface AboutFacts {
  /** The shell's own version; the fork version in a packaged build. */
  appVersion: string
  /** The runtime the shell settled on. Absent until discovery finishes. */
  runtime?: { source: RuntimeSource; version: string }
  /** The origin the window is pointed at. Absent until the runtime is ready. */
  url?: string
  /** Electron, Chromium and Node versions, as `process.versions` reports them. */
  versions: { electron: string; chrome: string; node: string }
}

/** The two strings a `dialog.showMessageBox` About takes. */
export interface AboutMessage {
  message: string
  detail: string
}

/**
 * How the shell came by the runtime it is talking to.
 *
 * `serving-instance` is the one worth spelling out: the shell did not start
 * that process and will not stop it, so its version is whatever the person who
 * started it had checked out.
 */
const SOURCES: Record<RuntimeSource, string> = {
  'serving-instance': 'already serving — this shell attached to it and will leave it running',
  path: 'found on PATH',
  'npx-cache': 'from the npx cache',
  bundled: 'bundled with this app',
}

/**
 * Compose the About dialog's message and detail from the live shell facts.
 * @param facts - the shell's own version, the selected runtime, and the origin.
 * @returns the dialog's title line and its body.
 */
export function aboutMessage(facts: AboutFacts): AboutMessage {
  const rows: string[] = []
  rows.push(facts.runtime === undefined
    ? 'Runtime   still being discovered'
    : `Runtime   dsh ${facts.runtime.version} · ${SOURCES[facts.runtime.source]}`)
  if (facts.url !== undefined) rows.push(`Serving   ${facts.url}`)
  const { electron, chrome, node } = facts.versions
  rows.push(`Shell     Electron ${electron} · Chromium ${chrome} · Node ${node}`)
  return {
    message: `DeepSeek Harness ${facts.appVersion}`,
    detail: rows.join('\n'),
  }
}

/** How many lines of a release's notes the update dialog shows before eliding. */
const RELEASE_NOTES_LINES = 12

/**
 * The body of the update offer: what you are on, what happens if you say yes,
 * and what changed.
 *
 * The notes are the release's own, not a file in the tree — the release is
 * what the person is being offered, and a changelog committed at some other
 * moment describes some other build. They are capped because a dialog is not
 * a document: a release whose notes run for pages would push the buttons off
 * a short screen, and the button is the thing the dialog is for.
 * @param current - the version now running.
 * @param notes - the release's published notes, possibly empty.
 * @returns the dialog's detail text.
 */
export function releaseDetail(current: string, notes: string): string {
  const head = `You are running ${current}. The update downloads in the background and installs when you quit.`
  const trimmed = notes.trim()
  if (trimmed === '') return head
  const lines = trimmed.split('\n')
  const shown = lines.slice(0, RELEASE_NOTES_LINES).join('\n')
  return lines.length > RELEASE_NOTES_LINES
    ? `${head}\n\n${shown}\n…`
    : `${head}\n\n${shown}`
}
