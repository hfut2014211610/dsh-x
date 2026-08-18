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
  // A cold CI runner pays the whole first boot at once: extracting the
  // bundled runtime's ~33k small files under real-time antivirus scanning,
  // profile auto-init, and the Cordis tree — minutes, not seconds, so this
  // test carries its own bound well past the extraction's own.
  test('the packaged app boots from its bundled runtime', async () => {
    isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-home-'))
    const childEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key.toLowerCase() !== 'path') childEnv[key] = value
    }
    childEnv.DSH_DESKTOP_PROBE_ORIGIN = 'http://127.0.0.1:1'
    childEnv.DSH_HOME = isolatedHome
    // The GUI process detaches from the runner's console; Electron's logging
    // switch is the only way its own output reaches a captured pipe.
    childEnv.ELECTRON_ENABLE_LOGGING = '1'
    const electron = await _electron.launch({
      executablePath: packagedExe,
      args: [`--user-data-dir=${join(isolatedHome, 'electron')}`],
      env: childEnv,
    })
    /** Everything the app printed, so a CI failure names its cause. */
    const processOutput: string[] = []
    for (const stream of [electron.process().stdout, electron.process().stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text !== '') processOutput.push(text)
      })
    }
    try {
      const window = await electron.firstWindow()
      await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 900_000 }).catch(async (error: unknown) => {
        // The loading screen renders the shell's phase and log tail; both it
        // and the process output turn a remote timeout into a diagnosis.
        const screen = await window.textContent('#logs', { timeout: 5_000 }).catch(() => 'unavailable')
        const phase = await window.textContent('.stage', { timeout: 5_000 }).catch(() => 'unavailable')
        throw new Error(
          `the packaged app never served a URL — phase: ${phase ?? 'unavailable'}; `
          + `loading-screen logs:\n${screen ?? 'unavailable'}\nprocess output:\n${processOutput.join('\n') || '(none)'}`,
          { cause: error },
        )
      })
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
  }, 960_000)
})
