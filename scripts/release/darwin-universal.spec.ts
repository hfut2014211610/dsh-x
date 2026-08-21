/** Making the desktop-runtime stage carry both darwin architectures. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeStageUniversal, type UniversalOps } from './darwin-universal.ts'

/** One recorded effect and the fake package it drops into the stage. */
interface Recorded {
  readonly packed: string[]
  readonly extracted: string[]
  readonly removed: string[]
}

/**
 * Fake effects that record every call; `extract` also drops the manifest the
 * real registry tarball would carry, so the sharp lib-package follow-up reads
 * what the fake shipped.
 * @param recorded - where calls land.
 * @param manifests - package name → manifest JSON the fake extract writes.
 * @returns the effect set.
 */
function fakeOps(recorded: Recorded, manifests: Record<string, unknown> = {}): UniversalOps {
  return {
    pack(spec, destination) {
      recorded.packed.push(spec)
      return join(destination, 'packed.tgz')
    },
    extract(_tarball, target) {
      recorded.extracted.push(target)
      const name = target.split(/[\\/]/).slice(-2).join('/')
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifests[name] ?? { name }, null, 2)}\n`)
    },
    removeTree(path) { recorded.removed.push(path) },
  }
}

/** A minimal stage holding the installed packages the subject reads. */
function stageWith(packages: Record<string, string>): string {
  const stage = mkdtempSync(join(tmpdir(), 'dsh-universal-spec-'))
  for (const [name, version] of Object.entries(packages)) {
    const dir = join(stage, 'node_modules', ...name.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, version }, null, 2)}\n`)
  }
  return stage
}

const stages: string[] = []

afterEach(() => {
  for (const stage of stages.splice(0)) rmSync(stage, { recursive: true, force: true })
})

describe('makeStageUniversal', () => {
  it('packs the x64 koffi and sharp prebuilts into their loader-expected paths', () => {
    const stage = stageWith({ koffi: '3.1.1', sharp: '0.35.3' })
    stages.push(stage)
    const recorded: Recorded = { packed: [], extracted: [], removed: [] }
    makeStageUniversal(stage, fakeOps(recorded))
    expect(recorded.packed).toEqual(['@koromix/koffi-darwin-x64@3.1.1', '@img/sharp-darwin-x64@0.35.3'])
    expect(recorded.extracted).toEqual([
      join(stage, 'node_modules', '@koromix', 'koffi-darwin-x64'),
      join(stage, 'node_modules', '@img', 'sharp-darwin-x64'),
    ])
  })

  it('follows the sharp arch package into whatever lib package it declares', () => {
    const stage = stageWith({ koffi: '3.1.1', sharp: '0.35.3' })
    stages.push(stage)
    const recorded: Recorded = { packed: [], extracted: [], removed: [] }
    makeStageUniversal(stage, fakeOps(recorded, {
      '@img/sharp-darwin-x64': { name: '@img/sharp-darwin-x64', optionalDependencies: { '@img/sharp-libdarwin-x64': '1.2.3' } },
    }))
    expect(recorded.packed).toContain('@img/sharp-libdarwin-x64@1.2.3')
    expect(recorded.extracted).toContain(join(stage, 'node_modules', '@img', 'sharp-libdarwin-x64'))
  })

  it('points node-pty back at its dual-arch prebuilds by dropping the host build', () => {
    const stage = stageWith({ koffi: '3.1.1', sharp: '0.35.3' })
    stages.push(stage)
    const recorded: Recorded = { packed: [], extracted: [], removed: [] }
    makeStageUniversal(stage, fakeOps(recorded))
    expect(recorded.removed).toEqual([join(stage, 'node_modules', 'node-pty', 'build')])
  })

  it('refuses a stage whose koffi install is missing', () => {
    const stage = stageWith({ sharp: '0.35.3' })
    stages.push(stage)
    expect(() => makeStageUniversal(stage, fakeOps({ packed: [], extracted: [], removed: [] })))
      .toThrow(/koffi is not installed in the stage/)
  })
})
