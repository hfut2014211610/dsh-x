// Desktop shell smoke: launch the real Electron main, watch the window swap
// from the loading screen to the official web UI, then quit and prove the
// lifecycle contract. Keyless — reaching the web boot surface needs no model
// credential.
//
// The smoke adapts to the serving-instance probe (the deployment's default web
// origin, 13080 here): when a dsh already answers there, the shell must ATTACH
// — the window reaches it and quitting leaves that instance alive, because an
// attached runtime is not ours to kill. When nothing answers, the shell must
// SPAWN `dsh web` itself — the window reaches a fresh loopback port and
// quitting tears the runtime down with no orphan listener. The repo's
// node_modules carries no `dsh` shim (the root package does not depend on the
// CLI), so the lane stages one temporary shim directory the way an npm global
// install would; the spawned runtime gets an isolated DSH_HOME so a
// developer's personal profile plugins cannot break the boot.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import * as nodeZlib from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { DEFAULT_PROBE_ORIGIN } from '../src/discovery.ts'
import { describeOrigin } from '../src/rpc-probe.ts'

const HERE = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const MAIN_ENTRY = join(HERE, 'lib', 'main.js')
const DSH_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')

const hasShell = existsSync(MAIN_ENTRY)
const hasBuiltRuntime = existsSync(DSH_BIN) && existsSync(join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html'))
/** The probe origin both the pre-probe and the shell child agree on. */
const probeOrigin = process.env.DSH_DESKTOP_PROBE_ORIGIN ?? DEFAULT_PROBE_ORIGIN
/**
 * Whether this lane's node can boot the built runtime at all: session
 * persistence imports node:zlib's zstd API, which predates Node 22.15. A
 * machine on an older node can still run the attach branch against a serving
 * instance; only the spawn branch needs the capable node.
 */
const nodeBootsRuntime = typeof nodeZlib.createZstdDecompress === 'function'

/** Staged shim directory + isolated home; removed in afterAll. */
let shimDir = ''
let isolatedHome = ''

beforeAll(() => {
  shimDir = join(tmpdir(), `dsh-desktop-shim-${String(process.pid)}`)
  mkdirSync(shimDir, { recursive: true })
  // An npm-style launcher: the shell must discover and validate `dsh` exactly
  // as it would on a developer machine with a global install.
  writeFileSync(join(shimDir, 'dsh.cmd'), `@"${process.execPath}" "${DSH_BIN}" %*\r\n`)
  writeFileSync(join(shimDir, 'dsh'), `#!/bin/sh\nexec "${process.execPath}" "${DSH_BIN}" "$@"\n`)
  chmodSync(join(shimDir, 'dsh'), 0o755)
})

afterAll(() => {
  if (shimDir !== '') rmSync(shimDir, { recursive: true, force: true })
  if (isolatedHome !== '') rmSync(isolatedHome, { recursive: true, force: true })
})

describe.skipIf(!hasShell || !hasBuiltRuntime)('desktop shell smoke', () => {
  test('the shell attaches to a serving runtime or spawns and reaps its own', ({ skip }) => {
    return (async () => {
      const attached = await describeOrigin(probeOrigin, fetch, () => crypto.randomUUID(), 2_000)
      if (attached === undefined && !nodeBootsRuntime) {
        skip('no serving instance to attach to and this node predates the runtime\'s node:zlib requirement (need >= 22.19)')
      }
      const pathVariable = process.platform === 'win32' ? 'Path' : 'PATH'
      const childEnv: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) {
      // Drop every case-variant of PATH here: a child env block carrying both
      // `PATH` and `Path` lets cmd resolve the unmodified one, hiding the shim.
        if (value !== undefined && key.toLowerCase() !== 'path') childEnv[key] = value
      }
      childEnv[pathVariable] = shimDir + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '')
      childEnv.DSH_DESKTOP_PROBE_ORIGIN = probeOrigin
      if (attached === undefined) {
        isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-home-'))
        childEnv.DSH_HOME = isolatedHome
      }

      const electron = await _electron.launch({ args: [MAIN_ENTRY], env: childEnv })
      try {
        const window = await electron.firstWindow()
        await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 })
        expect(window.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
        await expect.poll(() => window.title(), { timeout: 30_000 }).toBe('DeepSeek Harness')
        const url = window.url()

        await electron.close()
        if (attached !== undefined) {
        // Attached: the pre-existing instance is not ours; it must survive.
          expect(url).toBe(`${probeOrigin}/`)
          const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
          expect(response.ok).toBe(true)
        } else {
        // Spawned: quitting must leave no orphaned runtime behind.
          await expect.poll(async () => {
            try {
              const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
              return response.status
            } catch {
              return 'gone'
            }
          }, { timeout: 15_000, interval: 500 }).toBe('gone')
        }
      } finally {
        await electron.close().catch(() => undefined)
      }
    })()
  })
})
