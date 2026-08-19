import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROBE_ORIGIN, discoverRuntime, parseVersionOutput, type DiscoveryDeps } from '../src/discovery.ts'

/** Deps recording every probed path; respond tables decide each probe's answer. */
function makeDeps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    fetchImpl: (async () => new Response('nope', { status: 502 })),
    execFile: async () => { throw new Error('not found') },
    readJson: async () => undefined,
    listDirs: async () => [],
    npxCacheDirs: [],
    bundledRoot: '',
    runtimeLauncher: { command: '/electron', args: [] },
    probeOrigin: DEFAULT_PROBE_ORIGIN,
    randomUuid: () => 'uuid-1',
    ...overrides,
  }
}

const describeResponse = (): Response =>
  new Response(JSON.stringify({ rpcId: 'uuid-1', result: { ok: true, value: { version: '0.9.0' } } }), { status: 200 })

describe('parseVersionOutput', () => {
  it('accepts plain and prerelease versions', () => {
    expect(parseVersionOutput('0.1.0\n')).toBe('0.1.0')
    expect(parseVersionOutput(' 1.2.3-rc.5 ')).toBe('1.2.3-rc.5')
  })
  it('rejects non-version output', () => {
    expect(parseVersionOutput('dsh 1.0')).toBeUndefined()
    expect(parseVersionOutput('')).toBeUndefined()
    expect(parseVersionOutput('help text')).toBeUndefined()
  })
})

describe('discoverRuntime', () => {
  it('attaches to an already-serving instance first', async () => {
    const outcome = await discoverRuntime(makeDeps({ fetchImpl: (async () => describeResponse()) }))
    expect(outcome.candidate).toEqual({ source: 'serving-instance', origin: DEFAULT_PROBE_ORIGIN, version: '0.9.0' })
    expect(outcome.trail[0]).toContain('serving-instance')
  })

  // An installed app disables the source outright rather than relying on the
  // probe missing: a runtime this shell did not spawn is one it must not stop,
  // and attaching to whatever happens to hold the port would leave a server
  // running after the user quits the app.
  it('never attaches when the probe origin is disabled, even with an instance serving there', async () => {
    const fetchImpl = vi.fn(async () => describeResponse())
    const outcome = await discoverRuntime(makeDeps({
      probeOrigin: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      execFile: async () => ({ stdout: '1.4.2', code: 0 }),
    }))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(outcome.candidate).toEqual({ source: 'path', spawn: { command: 'dsh', args: [] }, version: '1.4.2' })
    expect(outcome.trail[0]).toContain('disabled')
  })

  it('validates the PATH runtime through --version', async () => {
    const outcome = await discoverRuntime(makeDeps({ execFile: async () => ({ stdout: '1.4.2\n', code: 0 }) }))
    expect(outcome.candidate).toEqual({ source: 'path', spawn: { command: 'dsh', args: [] }, version: '1.4.2' })
  })

  it('skips a PATH binary whose --version is not a dsh version', async () => {
    const outcome = await discoverRuntime(makeDeps({
      execFile: async () => ({ stdout: 'some other cli', code: 0 }),
      readJson: async path => path === '/npx/a/node_modules/@deepseek-ai/dsh/package.json'
        ? { name: '@deepseek-ai/dsh', version: '2.0.0' }
        : undefined,
      listDirs: async path => path === '/npx' ? ['a'] : [],
      npxCacheDirs: ['/npx'],
      runtimeLauncher: { command: '/electron', args: [], env: { ELECTRON_RUN_AS_NODE: '1' } },
    }))
    expect(outcome.candidate?.source).toBe('npx-cache')
    expect(outcome.candidate?.source === 'npx-cache' && outcome.candidate.version).toBe('2.0.0')
  })

  it('picks the highest cached version across npx roots', async () => {
    const manifests: Record<string, unknown> = {
      '/npx/old/node_modules/@deepseek-ai/dsh/package.json': { name: '@deepseek-ai/dsh', version: '0.8.1' },
      '/npx/new/node_modules/@deepseek-ai/dsh/package.json': { name: '@deepseek-ai/dsh', version: '0.10.0' },
      '/npx/other/node_modules/@deepseek-ai/dsh/package.json': { name: 'unrelated', version: '9.9.9' },
    }
    const outcome = await discoverRuntime(makeDeps({
      readJson: async path => manifests[path],
      listDirs: async path => path === '/npx' ? ['old', 'new', 'other'] : [],
      npxCacheDirs: ['/npx'],
    }))
    expect(outcome.candidate?.source === 'npx-cache' && outcome.candidate.spawn.args).toEqual([
      '/npx/new/node_modules/@deepseek-ai/dsh/lib/bin.js',
    ])
  })

  it('falls to the bundled runtime root', async () => {
    const outcome = await discoverRuntime(makeDeps({
      bundledRoot: '/bundled',
      readJson: async path => path === '/bundled/node_modules/@deepseek-ai/dsh/package.json'
        ? { name: '@deepseek-ai/dsh', version: '3.1.0' }
        : undefined,
      runtimeLauncher: { command: '/electron', args: [], env: { ELECTRON_RUN_AS_NODE: '1' } },
    }))
    expect(outcome.candidate).toEqual({
      source: 'bundled',
      spawn: {
        command: '/electron',
        args: ['/bundled/node_modules/@deepseek-ai/dsh/lib/bin.js'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
      version: '3.1.0',
    })
  })

  it('reports an empty outcome with a full trail when nothing validates', async () => {
    const outcome = await discoverRuntime(makeDeps())
    expect(outcome.candidate).toBeUndefined()
    // The bundled source stays silent here: without a packaged resources dir
    // it is not part of this machine's chain.
    expect(outcome.trail).toHaveLength(3)
  })
})
