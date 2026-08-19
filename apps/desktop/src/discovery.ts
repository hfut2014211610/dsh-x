/**
 * Runtime discovery for the desktop shell: the ordered chain that resolves
 * which `dsh` installation serves this window. Every source is validated
 * before it can be launched — an already-serving instance answers
 * `host.describe`, a PATH binary must answer `--version`, and an on-disk
 * runtime must present `@deepseek-ai/dsh`'s own package.json — so a same-named
 * unrelated binary is never spawned.
 * @module @deepseek-ai/dsh-desktop-shell/discovery
 */

import { describeOrigin } from './rpc-probe.ts'
import { compareVersions } from './version.ts'

/**
 * The loopback origin the serving-instance source probes: this deployment's
 * default `dsh web` port (the home-level webserver patch may override the
 * shipped 3080, for example to 13080). A miss costs one refused connection —
 * the chain then spawns its own runtime on an OS-assigned port.
 *
 * An installed app does not probe at all (see `probeOrigin` on
 * {@link DiscoveryDeps}): attaching would hand it a runtime it may not stop,
 * and a desktop app that leaves a server running after the user quits it is
 * not one the user is in control of. Probing stays the development default,
 * where a `dsh web` left running in a terminal is the point.
 */
export const DEFAULT_PROBE_ORIGIN = 'http://127.0.0.1:13080'

/** How each source was found; shown in the connection UI. */
export type RuntimeSource = 'serving-instance' | 'path' | 'npx-cache' | 'bundled'

/** A spawnable runtime: a node executable running the dsh CLI entry script. */
export interface RuntimeSpawn {
  command: string
  args: readonly string[]
  /** Merged over the shell environment before spawn (for example ELECTRON_RUN_AS_NODE). */
  env?: Readonly<Record<string, string>>
}

/** One validated dsh runtime, ready to attach to or launch. */
export type RuntimeCandidate =
  | { source: 'serving-instance'; origin: string; version: string }
  | { source: 'path' | 'npx-cache' | 'bundled'; spawn: RuntimeSpawn; version: string }

/** The dsh CLI entry every on-disk runtime launches. */
const RUNTIME_ENTRY = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
/** The manifest every on-disk runtime is validated through. */
const RUNTIME_MANIFEST = 'node_modules/@deepseek-ai/dsh/package.json'

/** Environment-injected collaborators; every one is a seam the tests replace. */
export interface DiscoveryDeps {
  fetchImpl: typeof fetch
  /** Runs `<command> --version`; resolves even on nonzero exit. */
  execFile: (command: string, args: readonly string[]) => Promise<{ stdout: string; code: number }>
  /** Reads and parses a JSON file, or resolves undefined when absent or unreadable. */
  readJson: (path: string) => Promise<unknown>
  /** Lists child directory names, or an empty list when the directory is absent. */
  listDirs: (path: string) => Promise<readonly string[]>
  /** npx cache roots to scan (`~/.npm/_npx`, `%LOCALAPPDATA%\npm-cache\_npx`). */
  npxCacheDirs: readonly string[]
  /** Extracted bundled runtime root; empty string disables the bundled source. */
  bundledRoot: string
  /** Launcher that runs dsh entry scripts (system node, or Electron as node). */
  runtimeLauncher: RuntimeSpawn
  /**
   * Origin the serving-instance source probes (the deployment's default port).
   * An empty string disables the source outright, as `bundledRoot` does for
   * the bundled one, so the chain can only select a runtime this shell spawns
   * and therefore owns.
   */
  probeOrigin: string
  randomUuid: () => string
}

/** Outcome of one chain run: the first validated candidate plus a human-readable trail. */
export interface DiscoveryOutcome {
  candidate?: RuntimeCandidate
  trail: readonly string[]
}

/**
 * Whether a stdout line is a dsh version string (`0.1.0-rc.5`, `1.2.3`).
 * @param stdout - verbatim `--version` output.
 */
export function parseVersionOutput(stdout: string): string | undefined {
  const value = stdout.trim()
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : undefined
}

/** Read and validate one on-disk runtime root; undefined when it is not a dsh runtime. */
async function readRuntime(deps: DiscoveryDeps, root: string): Promise<{ version: string } | undefined> {
  const manifest = await deps.readJson(`${root}/${RUNTIME_MANIFEST}`)
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const { name, version } = manifest as Record<string, unknown>
  if (name !== '@deepseek-ai/dsh' || typeof version !== 'string' || version === '') return undefined
  return { version }
}

/** The spawn for one on-disk runtime root under the configured launcher. */
function runtimeSpawn(deps: DiscoveryDeps, root: string): RuntimeSpawn {
  return {
    command: deps.runtimeLauncher.command,
    args: [...deps.runtimeLauncher.args, `${root}/${RUNTIME_ENTRY}`],
    ...(deps.runtimeLauncher.env === undefined ? {} : { env: deps.runtimeLauncher.env }),
  }
}

/**
 * Walk the discovery chain in order: serving instance → PATH → npx cache →
 * bundled runtime. The first validated source wins; the trail records every
 * source examined so the connection UI can show why.
 * @param deps - environment collaborators.
 * @returns the selected candidate (or none) and the per-source trail lines.
 */
export async function discoverRuntime(deps: DiscoveryDeps): Promise<DiscoveryOutcome> {
  const trail: string[] = []

  if (deps.probeOrigin === '') {
    trail.push('serving-instance: disabled — this shell only runs a runtime it owns')
  } else {
    const serving = await describeOrigin(deps.probeOrigin, deps.fetchImpl, deps.randomUuid, 2_000)
    if (serving !== undefined) {
      trail.push(`serving-instance: ${deps.probeOrigin} (dsh ${serving.version})`)
      return { candidate: { source: 'serving-instance', origin: deps.probeOrigin, version: serving.version }, trail }
    }
    trail.push(`serving-instance: no dsh answers on ${deps.probeOrigin}`)
  }

  try {
    const { stdout, code } = await deps.execFile('dsh', ['--version'])
    const version = code === 0 ? parseVersionOutput(stdout) : undefined
    if (version !== undefined) {
      trail.push(`path: dsh on PATH (${version})`)
      return { candidate: { source: 'path', spawn: { command: 'dsh', args: [] }, version }, trail }
    }
    trail.push(`path: dsh on PATH failed validation (exit ${String(code)})`)
  } catch (error) {
    trail.push(`path: no runnable dsh on PATH (${error instanceof Error ? error.message : String(error)})`)
  }

  let best: { root: string; version: string } | undefined
  for (const cacheDir of deps.npxCacheDirs) {
    for (const entry of ['', ...await deps.listDirs(cacheDir)]) {
      const root = entry === '' ? cacheDir : `${cacheDir}/${entry}`
      const runtime = await readRuntime(deps, root)
      if (runtime === undefined) continue
      if (best === undefined || compareVersions(runtime.version, best.version) > 0) best = { root, version: runtime.version }
    }
  }
  if (best !== undefined) {
    trail.push(`npx-cache: ${best.root} (dsh ${best.version})`)
    return { candidate: { source: 'npx-cache', spawn: runtimeSpawn(deps, best.root), version: best.version }, trail }
  }
  trail.push('npx-cache: no cached dsh installation')

  if (deps.bundledRoot !== '') {
    const runtime = await readRuntime(deps, deps.bundledRoot)
    if (runtime !== undefined) {
      trail.push(`bundled: ${deps.bundledRoot} (dsh ${runtime.version})`)
      return { candidate: { source: 'bundled', spawn: runtimeSpawn(deps, deps.bundledRoot), version: runtime.version }, trail }
    }
    trail.push(`bundled: no dsh runtime under ${deps.bundledRoot}`)
  }

  return { trail }
}
