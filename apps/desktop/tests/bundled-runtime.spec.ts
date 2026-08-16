import { describe, expect, it } from 'vitest'
import { ensureBundledRuntime, type BundledRuntimeDeps } from '../src/bundled-runtime.ts'

/** In-memory filesystem + extractor recorder. */
/** Normalized map key: path.join uses backslashes on Windows. */
const key = (path: string): string => path.replaceAll('\\', '/')

function makeDeps(archive: string) {
  // An empty archive argument means "no archive ships": the file is absent.
  const files = new Map<string, string>(archive === '' ? [] : [['/res/dsh-runtime.zip', archive]])
  const extracted: string[] = []
  const deps: BundledRuntimeDeps = {
    archivePath: '/res/dsh-runtime.zip',
    targetDir: '/data/dsh-runtime',
    exists: async path => files.has(key(path)),
    readFile: async (path) => {
      const value = files.get(key(path))
      if (value === undefined) throw new Error('ENOENT')
      return Buffer.from(value, 'utf8')
    },
    removeDir: async (path) => {
      for (const entry of [...files.keys()]) {
        if (entry.startsWith(`${key(path)}/`)) files.delete(entry)
      }
    },
    makeDir: async () => {},
    writeFile: async (path, contents) => { files.set(key(path), contents) },
    extract: async (archivePath, dir) => {
      extracted.push(archivePath)
      files.set(`${dir}/node_modules/@deepseek-ai/dsh/package.json`, '{"name":"@deepseek-ai/dsh","version":"0.1.0-rc.6"}')
    },
  }
  return { deps, files, extracted }
}

describe('ensureBundledRuntime', () => {
  it('returns undefined when no archive ships', async () => {
    const { deps } = makeDeps('')
    await expect(ensureBundledRuntime(deps)).resolves.toBeUndefined()
  })

  it('extracts on first run and records the archive checksum', async () => {
    const { deps, extracted } = makeDeps('archive-bytes-v1')
    const result = await ensureBundledRuntime(deps)
    expect(result).toEqual({ root: '/data/dsh-runtime', version: '0.1.0-rc.6' })
    expect(extracted).toEqual(['/res/dsh-runtime.zip'])
    // Second run with the same archive extracts nothing.
    await ensureBundledRuntime(deps)
    expect(extracted).toHaveLength(1)
  })

  it('re-extracts when the archive content changed', async () => {
    const { deps, files, extracted } = makeDeps('archive-bytes-v1')
    await ensureBundledRuntime(deps)
    files.set('/res/dsh-runtime.zip', 'archive-bytes-v2')
    await ensureBundledRuntime(deps)
    expect(extracted).toHaveLength(2)
  })

  it('fails loud when the archive yields no dsh tree', async () => {
    const { deps } = makeDeps('not-a-runtime')
    // Replace the extractor with one that writes nothing.
    deps.extract = async () => {}
    await expect(ensureBundledRuntime(deps)).rejects.toThrow('did not yield a dsh tree')
  })
})
