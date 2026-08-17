/**
 * Assemble the desktop shell's bundled-runtime install manifest from packed
 * release tarballs: write one consumer `package.json` into the stage whose
 * dependencies carry the @deepseek-ai dependency closure of `@deepseek-ai/dsh`
 * as tarball file URLs, so a plain `npm install` inside the stage resolves the
 * whole runtime from the pack output instead of the npm registry.
 *
 * The desktop workflow's npm-registry path installs `@deepseek-ai/dsh@<version>`
 * and therefore requires that version to be published. A release cut before
 * publication — or one whose runtime must match the commit exactly — packs the
 * dsh and vendor families and installs from those bytes instead, the same
 * hermetic-consumer discipline as verify-packed-install: external dependencies
 * still come from the registry, and the caller's install flags omit optional
 * platform packages (so optionalDependencies stay outside the closure).
 *
 * Only the closure is mapped, never every packed tarball: the family also
 * carries packages the runtime never requires (the desktop shell itself, whose
 * dependencies would pull Electron into the runtime stage).
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { capture, isEntry } from './process.ts'

/**
 * The tar that reads packed manifests. On Windows resolved by absolute path
 * to the SYSTEM bsdtar: a PATH `tar` may be GNU tar (MSYS), which rejects
 * `D:` drive-letter arguments as remote-host syntax — the same resolution the
 * desktop shell's extractor applies.
 */
const TAR = process.platform === 'win32'
  ? join(process.env.SystemRoot ?? 'C:\\Windows', 'system32', 'tar.exe')
  : 'tar'

/** The runtime's entry package: the closure is computed from its dependencies. */
const ENTRY_PACKAGE = '@deepseek-ai/dsh'

/** One packed tarball's identity and its @deepseek-ai dependency edges. */
interface PackedNode {
  readonly url: string
  readonly edges: ReadonlySet<string>
}

/** Read one tarball's manifest straight out of the archive. */
function packedManifest(tarball: string): { name: string; dependencies: Record<string, string>; peerDependencies: Record<string, string> } {
  const manifest: unknown = JSON.parse(capture(TAR, ['-xOzf', tarball, 'package/package.json']))
  if (manifest === null || typeof manifest !== 'object') throw new Error(`${tarball} has no manifest`)
  const { name, dependencies, peerDependencies } = manifest as Record<string, unknown>
  if (typeof name !== 'string') throw new Error(`${tarball} manifest lacks a name`)
  const stringMap = (value: unknown): Record<string, string> =>
    typeof value === 'object' && value !== null ? value as Record<string, string> : {}
  return { name, dependencies: stringMap(dependencies), peerDependencies: stringMap(peerDependencies) }
}

/** Every packed tarball under the `--from` directories, keyed by package name. */
function packedGraph(directories: readonly string[]): Map<string, PackedNode> {
  const graph = new Map<string, PackedNode>()
  for (const directory of directories) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      const tarball = join(directory, filename)
      const { name, dependencies, peerDependencies } = packedManifest(tarball)
      if (graph.has(name)) throw new Error(`${name} packed twice: ${graph.get(name)?.url} and ${filename}`)
      const edges = new Set(
        [...Object.keys(dependencies), ...Object.keys(peerDependencies)]
          .filter(edge => edge.startsWith('@deepseek-ai/')),
      )
      graph.set(name, { url: pathToFileURL(tarball).href, edges })
    }
  }
  return graph
}

/** Compute and map the entry package's @deepseek-ai dependency closure. */
function main(): void {
  const { values } = parseArgs({
    options: { from: { type: 'string', multiple: true }, stage: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.from === undefined || values.from.length === 0 || values.stage === undefined) {
    throw new Error('usage: desktop-runtime.ts --from <packed directory> [--from ...] --stage <stage directory>')
  }
  const root = process.cwd()
  const stage = resolve(root, values.stage)
  const graph = packedGraph(values.from.map(entry => resolve(root, entry)))

  const closure = new Set<string>()
  const visit = (name: string): void => {
    if (closure.has(name)) return
    const node = graph.get(name)
    if (node === undefined) {
      throw new Error(`${name} is required by the runtime closure but not among the packed tarballs`)
    }
    closure.add(name)
    for (const edge of node.edges) visit(edge)
  }
  visit(ENTRY_PACKAGE)

  const dependencies = [...closure].sort().flatMap((name) => {
    const node = graph.get(name)
    return node === undefined ? [] : [[name, node.url] as const]
  })
  mkdirSync(stage, { recursive: true })
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({
    name: 'dsh-desktop-runtime-stage',
    version: '0.0.0',
    private: true,
    dependencies: Object.fromEntries(dependencies),
  }, null, 2)}\n`)
  console.log(`desktop runtime: ${String(closure.size)} of ${String(graph.size)} packed package(s) mapped into ${values.stage}`)
}

if (isEntry(import.meta.url)) main()
