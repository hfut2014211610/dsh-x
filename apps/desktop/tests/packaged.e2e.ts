// Packaged-artifact smoke: launch the electron-builder win-unpacked executable
// (not the dev checkout) and prove the bundled runtime alone can serve the
// window — no PATH dsh, no npx cache. Runs only in the release workflow, which
// sets DSH_DESKTOP_PACKAGED_EXE; everywhere else it self-skips.
import { existsSync } from 'node:fs'
import { _electron } from 'playwright'
import { describe, expect, test } from 'vitest'

const packagedExe = process.env.DSH_DESKTOP_PACKAGED_EXE ?? ''

describe.skipIf(packagedExe === '' || !existsSync(packagedExe))('packaged app smoke', () => {
  test('the packaged app boots from its bundled runtime', async () => {
    const electron = await _electron.launch({ executablePath: packagedExe })
    try {
      const window = await electron.firstWindow()
      await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 })
      expect(window.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
      await expect.poll(() => window.title(), { timeout: 30_000 }).toBe('DeepSeek Harness')
      const url = window.url()
      await electron.close()
      await expect.poll(async () => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
          return response.status
        } catch {
          return 'gone'
        }
      }, { timeout: 15_000, interval: 500 }).toBe('gone')
    } finally {
      await electron.close().catch(() => undefined)
    }
  })
})
