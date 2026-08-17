// Packaged-artifact smoke: launch the electron-builder win-unpacked executable
// (not the dev checkout) and prove the bundled runtime alone can serve the
// window — no PATH dsh, no npx cache. Runs only in the release workflow, which
// sets DSH_DESKTOP_PACKAGED_EXE; everywhere else it self-skips. The probe
// origin is forced dead and DSH_HOME isolated so the bundled source is the
// only path and the machine's own profile cannot break the boot.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron } from 'playwright'
import { afterAll, describe, expect, test } from 'vitest'

const packagedExe = process.env.DSH_DESKTOP_PACKAGED_EXE ?? ''

/** Isolated home; removed in afterAll. */
let isolatedHome = ''

afterAll(() => {
  if (isolatedHome !== '') rmSync(isolatedHome, { recursive: true, force: true })
})

describe.skipIf(packagedExe === '' || !existsSync(packagedExe))('packaged app smoke', () => {
  // A cold CI runner pays the whole first boot at once: archive extraction
  // (530 files), profile auto-init, and the Cordis tree — well over the lane's
  // 180s default, so this test carries its own generous bound.
  test('the packaged app boots from its bundled runtime', async () => {
    isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-home-'))
    const childEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key.toLowerCase() !== 'path') childEnv[key] = value
    }
    childEnv.DSH_DESKTOP_PROBE_ORIGIN = 'http://127.0.0.1:1'
    childEnv.DSH_HOME = isolatedHome
    const electron = await _electron.launch({ executablePath: packagedExe, env: childEnv })
    try {
      const window = await electron.firstWindow()
      await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 360_000 })
      expect(window.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
      await expect.poll(() => window.title(), { timeout: 60_000 }).toBe('DeepSeek Harness')
      const url = window.url()
      await electron.close()
      await expect.poll(async () => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
          return response.status
        } catch {
          return 'gone'
        }
      }, { timeout: 30_000, interval: 500 }).toBe('gone')
    } finally {
      await electron.close().catch(() => undefined)
    }
  }, 420_000)
})
