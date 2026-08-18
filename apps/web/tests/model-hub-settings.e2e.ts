// Web e2e scenario: the shipped Model Hub host and client plugins load from
// the real Web composition, the settings section reaches its host RPC gateway,
// and an empty document renders as an editable provider/model authoring page.
// No model call or stored credential is involved.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/model-hub-settings', import.meta.url))
const EMPTY_EXPECTED = join(SNAPSHOT_DIR, 'empty.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: shipped Model Hub registration', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the editable empty authoring page through the host gateway', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-hub-empty'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '模型中心', exact: true }).click()
    await dialog.getByRole('heading', { name: '供应商', exact: true }).waitFor({ timeout: 10_000 })
    await dialog.getByRole('heading', { name: '模型', exact: true }).waitFor({ timeout: 10_000 })
    await expect.poll(async () => dialog.getByRole('button', { name: '新增供应商' }).isEnabled()).toBe(true)
    await expect.poll(async () => dialog.getByRole('button', { name: '新增模型' }).isEnabled()).toBe(true)
    expect(await dialog.getByText('暂无内容。', { exact: true }).count()).toBe(2)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EMPTY_EXPECTED, snapshot, MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['empty.expected.md'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
