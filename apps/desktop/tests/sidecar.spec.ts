import { describe, expect, it } from 'vitest'
import { parseWebUrlLine, SidecarError, startSidecar, type RuntimeProcess, type SidecarDeps } from '../src/sidecar.ts'
import type { RuntimeSpawn } from '../src/discovery.ts'

/** A runtime process the test drives by hand; the spawn hook schedules its behavior. */
interface FakeRuntime {
  process: RuntimeProcess
  lines: (line: string) => void
  exit: (code: number | null) => void
  killed: boolean
}

function fakeRuntime(): FakeRuntime {
  const lineListeners = new Set<(line: string) => void>()
  const exitListeners = new Set<(code: number | null) => void>()
  const runtime: FakeRuntime = {
    killed: false,
    lines: (line) => { for (const listener of lineListeners) listener(line) },
    exit: (code) => { for (const listener of exitListeners) listener(code) },
    process: {
      pid: 4321,
      onLine: (listener) => { lineListeners.add(listener) },
      onExit: (listener) => { exitListeners.add(listener) },
      killTree: () => { runtime.killed = true },
    },
  }
  return runtime
}

/**
 * Deps over a manual clock that advances on every sleep, so poll deadlines
 * arrive deterministically after a fixed number of iterations.
 */
function makeDeps(spawn: SidecarDeps['spawn'], fetchImpl: typeof fetch): SidecarDeps {
  let clock = 0
  return {
    spawn,
    fetchImpl,
    randomUuid: () => 'rpc-1',
    sleep: async (ms) => { clock += ms },
    now: () => clock,
  }
}

const options = { urlTimeoutMs: 500, readyTimeoutMs: 500, pollIntervalMs: 100 }
const describeOk = (): Response =>
  new Response(JSON.stringify({ rpcId: 'rpc-1', result: { ok: true, value: { version: '1.0.0' } } }), { status: 200 })

/** URL string of a fetch input without falling back to Object stringification. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('parseWebUrlLine', () => {
  it('reads the loopback URL from the readiness line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:4312')).toBe('http://127.0.0.1:4312')
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:4312 (LAN: http://192.168.1.4:4312)'))
      .toBe('http://127.0.0.1:4312')
  })
  it('ignores every other line', () => {
    expect(parseWebUrlLine('profile web loaded')).toBeUndefined()
    expect(parseWebUrlLine('dsh web: http://0.0.0.0:4312')).toBeUndefined()
    expect(parseWebUrlLine('xdsh web: http://127.0.0.1:1')).toBeUndefined()
  })
})

describe('startSidecar', () => {
  it('attaches to a serving instance without spawning or owning it', async () => {
    let spawned = false
    const deps = makeDeps(() => { spawned = true; return fakeRuntime().process },
      (async () => new Response('ok', { status: 200 })))
    const handle = await startSidecar({ source: 'serving-instance', origin: 'http://127.0.0.1:3080', version: '1.0.0' }, deps, options)
    expect(spawned).toBe(false)
    expect(handle).toMatchObject({ url: 'http://127.0.0.1:3080/', owned: false })
    handle.kill()
  })

  it('spawns, waits for the URL line, the index, and the handshake', async () => {
    const runtime = fakeRuntime()
    const spawnedSpecs: RuntimeSpawn[] = []
    let indexAnswers = false
    const deps = makeDeps((spec) => {
      spawnedSpecs.push(spec)
      // The runtime prints its URL line once running; its index starts
      // answering one poll round later.
      queueMicrotask(() => {
        runtime.lines('profile web loaded')
        runtime.lines('dsh web: http://127.0.0.1:7777')
        queueMicrotask(() => { indexAnswers = true })
      })
      return runtime.process
    }, (async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === 'http://127.0.0.1:7777/') return indexAnswers ? new Response('ok', { status: 200 }) : new Response('no', { status: 503 })
      if (url === 'http://127.0.0.1:7777/api/host.describe') return describeOk()
      throw new Error(`unexpected fetch ${url}`)
    }))
    const handle = await startSidecar({ source: 'path', spawn: { command: 'dsh', args: [] }, version: '1.0.0' }, deps, options)
    expect(spawnedSpecs).toEqual([{ command: 'dsh', args: [] }])
    expect(handle).toMatchObject({ url: 'http://127.0.0.1:7777/', owned: true, pid: 4321 })
    expect(runtime.killed).toBe(false)
  })

  it('kills the child and reports the output tail when it exits before serving', async () => {
    const runtime = fakeRuntime()
    const deps = makeDeps(() => {
      queueMicrotask(() => {
        runtime.lines('loading profile')
        runtime.exit(3)
      })
      return runtime.process
    }, (async () => new Response('ok', { status: 200 })))
    const failure = await startSidecar({ source: 'path', spawn: { command: 'dsh', args: [] }, version: '1.0.0' }, deps, options)
      .then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(SidecarError)
    expect((failure as SidecarError).message).toContain('exited with code 3')
    expect((failure as SidecarError).outputTail).toEqual(['loading profile'])
    expect(runtime.killed).toBe(true)
  })

  it('fails when the URL line never arrives', async () => {
    const runtime = fakeRuntime()
    const deps = makeDeps(() => runtime.process, (async () => new Response('ok', { status: 200 })))
    await expect(startSidecar({ source: 'bundled', spawn: { command: 'n', args: ['b.js'] }, version: '1.0.0' }, deps, options))
      .rejects.toThrow('did not print its serving URL')
    expect(runtime.killed).toBe(true)
  })

  it('fails when the index never answers after the URL line', async () => {
    const runtime = fakeRuntime()
    const deps = makeDeps(() => {
      queueMicrotask(() => { runtime.lines('dsh web: http://127.0.0.1:9999') })
      return runtime.process
    }, (async () => { throw new Error('refused') }))
    await expect(startSidecar({ source: 'npx-cache', spawn: { command: 'n', args: ['b.js'] }, version: '1.0.0' }, deps, options))
      .rejects.toThrow('did not answer')
    expect(runtime.killed).toBe(true)
  })

  it('fails when host.describe does not echo the rpcId', async () => {
    const runtime = fakeRuntime()
    const deps = makeDeps(() => {
      queueMicrotask(() => { runtime.lines('dsh web: http://127.0.0.1:8888') })
      return runtime.process
    }, (async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === 'http://127.0.0.1:8888/') return new Response('ok', { status: 200 })
      return new Response(JSON.stringify({ rpcId: 'other', result: { ok: true, value: { version: '9' } } }), { status: 200 })
    }))
    await expect(startSidecar({ source: 'path', spawn: { command: 'dsh', args: [] }, version: '1.0.0' }, deps, options))
      .rejects.toThrow('handshake failed')
    expect(runtime.killed).toBe(true)
  })

  it('forwards later exits to registered listeners', async () => {
    const runtime = fakeRuntime()
    const deps = makeDeps(() => {
      queueMicrotask(() => { runtime.lines('dsh web: http://127.0.0.1:7777') })
      return runtime.process
    }, (async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === 'http://127.0.0.1:7777/') return new Response('ok', { status: 200 })
      return describeOk()
    }))
    const handle = await startSidecar({ source: 'path', spawn: { command: 'dsh', args: [] }, version: '1.0.0' }, deps, options)
    const exits: Array<number | null> = []
    handle.onExit((code) => { exits.push(code) })
    runtime.exit(1)
    expect(exits).toEqual([1])
  })
})
