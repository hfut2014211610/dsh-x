/**
 * First-run materialization of the bundled dsh runtime: the installer ships
 * the runtime as one archive under `extraResources` (this electron-builder
 * build strips node_modules from resource copies, and one archive also keeps
 * the installer small); the shell extracts it into its writable userData once
 * per archive checksum. Discovery then treats the extracted tree exactly like
 * any on-disk runtime root.
 * @module @deepseek-ai/dsh-desktop-shell/bundled-runtime
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Where the extracted runtime's manifest and entry live. */
const RUNTIME_MANIFEST = 'node_modules/@deepseek-ai/dsh/package.json'

/** Environment-injected collaborators; every one is a seam the tests replace. */
export interface BundledRuntimeDeps {
  /** Archive shipped beside the app (for example `resources/dsh-runtime.zip`). */
  archivePath: string
  /** Writable directory the runtime extracts into (userData). */
  targetDir: string
  exists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<Buffer>
  /** Removes the target dir recursively. */
  removeDir: (path: string) => Promise<void>
  makeDir: (path: string) => Promise<void>
  /** Writes the archive-checksum marker after a successful extraction. */
  writeFile: (path: string, contents: string) => Promise<void>
  /**
   * Archive extractor. `tar -xf` reads zip archives on Windows (bsdtar) and
   * macOS; `unzip -q` is the Linux fallback.
   */
  extract: (archivePath: string, targetDir: string) => Promise<void>
}

/** The marker file recording which archive content the target dir holds. */
const CHECKSUM_MARKER = '.extracted-archive-sha256'

/** Whether an already-extracted runtime sits in the target dir. */
async function extractedVersion(deps: BundledRuntimeDeps): Promise<string | undefined> {
  const manifest = await deps.readFile(join(deps.targetDir, RUNTIME_MANIFEST)).then(
    value => JSON.parse(value.toString('utf8')) as { name?: unknown; version?: unknown },
    () => undefined,
  )
  if (manifest?.name !== '@deepseek-ai/dsh' || typeof manifest.version !== 'string') return undefined
  return manifest.version
}

/**
 * Ensure the bundled runtime is extracted and current.
 *
 * Returns nothing when no archive ships (development runs); re-extracts when
 * the archive checksum changed (an upgrade replaced the installer's runtime).
 * @param deps - environment collaborators.
 * @returns the extracted runtime root and its version, or undefined when this
 * build ships no bundled runtime.
 */
export async function ensureBundledRuntime(deps: BundledRuntimeDeps): Promise<{ root: string; version: string } | undefined> {
  if (!await deps.exists(deps.archivePath)) return undefined
  const checksum = createHash('sha256').update(await deps.readFile(deps.archivePath)).digest('hex')
  const markerPath = join(deps.targetDir, CHECKSUM_MARKER)
  const markerMatches = await deps.readFile(markerPath).then(
    value => value.toString('utf8').trim() === checksum,
    () => false,
  )
  if (!markerMatches) {
    await deps.removeDir(deps.targetDir)
    await deps.makeDir(deps.targetDir)
    await deps.extract(deps.archivePath, deps.targetDir)
    if (await extractedVersion(deps) === undefined) {
      throw new Error(`bundled runtime archive ${deps.archivePath} did not yield a dsh tree`)
    }
    await deps.writeFile(markerPath, `${checksum}\n`)
  }
  const version = await extractedVersion(deps)
  if (version === undefined) return undefined
  return { root: deps.targetDir, version }
}
