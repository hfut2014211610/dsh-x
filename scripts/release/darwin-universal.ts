/**
 * Make one assembled desktop-runtime stage carry both darwin architectures.
 *
 * The macOS runner is arm64 and builds one runtime archive that both dmg
 * architectures embed, but the stage's `npm install` resolves for the host
 * alone: koffi and sharp deliver natives as per-arch prebuilt packages
 * (`@koromix/koffi-darwin-x64`, `@img/sharp-darwin-x64`), and node-pty's
 * install copies its host prebuild into `build/Release` — which its loader
 * prefers over the dual-arch `prebuilds/` directory the tarball also ships.
 * An x64 process then finds no native of its own: koffi's loader throws
 * before any plugin finishes loading and the whole runtime exits.
 *
 * The fix is additive and deterministic: pack the missing x64 prebuilt
 * packages from the registry into the stage at their loader-expected paths,
 * and remove node-pty's host-arch `build/` so loading falls through to the
 * per-arch `prebuilds/` that already covers both darwin architectures.
 *
 * @module scripts/release/darwin-universal
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { capture, isEntry, TAR } from './process.ts'

/** Side effects the universalization performs; tests replace every member. */
export interface UniversalOps {
  /** `npm pack` one registry spec into a directory; returns the tarball path. */
  pack(spec: string, destination: string): string
  /** Extract one tarball's `package/` root into a target directory. */
  extract(tarball: string, target: string): void
  /** Remove one directory tree. */
  removeTree(path: string): void
}

/** The real effect set: npm and tar through the release process helpers. */
const hostOps: UniversalOps = {
  pack(spec, destination) {
    const stdout = capture('npm', ['pack', '--pack-destination', destination, spec])
    const filename = stdout.split(/\r?\n/).filter(line => line.trim() !== '').at(-1)
    if (filename === undefined) throw new Error(`npm pack printed no tarball name for ${spec}`)
    return join(destination, filename)
  },
  extract(tarball, target) {
    mkdirSync(target, { recursive: true })
    capture(TAR, ['-xzf', tarball, '-C', target, '--strip-components=1'])
  },
  removeTree(path) { rmSync(path, { recursive: true, force: true }) },
}

/**
 * Read one installed package's version out of the stage.
 * @param stage - the runtime stage directory.
 * @param name - the package whose manifest is read.
 * @returns its version.
 * @throws when the package is missing — the caller assembled a stage without
 * the very dependency whose prebuilts this step exists to complete.
 */
function stageVersion(stage: string, name: string): string {
  let raw: string
  try {
    raw = readFileSync(join(stage, 'node_modules', name, 'package.json'), 'utf8')
  } catch {
    throw new Error(`${name} is not installed in the stage; cannot pick its darwin prebuilt version`)
  }
  const version = (JSON.parse(raw) as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    throw new Error(`${name} is not installed in the stage; cannot pick its darwin prebuilt version`)
  }
  return version
}

/**
 * Pack one prebuilt package and unpack it into the stage's loader-expected
 * path.
 * @param ops - the effect set.
 * @param stage - the runtime stage directory.
 * @param workdir - where npm pack writes the tarball.
 * @param name - the registry package name, scope included.
 * @param version - the exact version to pin.
 * @returns the directory the package was unpacked into.
 */
function addPrebuilt(ops: UniversalOps, stage: string, workdir: string, name: string, version: string): string {
  const tarball = ops.pack(`${name}@${version}`, workdir)
  const target = join(stage, 'node_modules', ...name.split('/'))
  ops.extract(tarball, target)
  return target
}

/**
 * Complete one stage so both darwin architectures can load every native.
 * @param stage - the runtime stage directory, installed for the arm64 host.
 * @param ops - the effect set.
 */
export function makeStageUniversal(stage: string, ops: UniversalOps): void {
  const workdir = mkdtempSync(join(tmpdir(), 'dsh-darwin-universal-'))
  try {
    addPrebuilt(ops, stage, workdir, '@koromix/koffi-darwin-x64', stageVersion(stage, 'koffi'))
    // sharp's arch package may declare the shared-lib package as its own
    // optional dependency; read it from the just-unpacked manifest so the
    // lib ships whatever the arch package declares, not a hardcoded guess.
    const sharpTarget = addPrebuilt(ops, stage, workdir, '@img/sharp-darwin-x64', stageVersion(stage, 'sharp'))
    const manifest: unknown = JSON.parse(readFileSync(join(sharpTarget, 'package.json'), 'utf8'))
    const optional = (manifest as { optionalDependencies?: Record<string, string> } | null)?.optionalDependencies
    for (const [name, range] of Object.entries(optional ?? {})) {
      if (name.startsWith('@img/')) addPrebuilt(ops, stage, workdir, name, range)
    }
    // node-pty's install put the host prebuild at build/Release, which its
    // loader tries before prebuilds/; without this the x64 process would load
    // the arm64 binary. prebuilds/ carries both darwin arches.
    ops.removeTree(join(stage, 'node_modules', 'node-pty', 'build'))
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

function main(): void {
  const { values } = parseArgs({ options: { stage: { type: 'string' } }, allowPositionals: false })
  if (values.stage === undefined) throw new Error('usage: darwin-universal.ts --stage <stage directory>')
  makeStageUniversal(values.stage, hostOps)
  console.log('darwin universal: x64 prebuilts added, node-pty on its dual-arch prebuilds')
}

if (isEntry(import.meta.url)) main()
