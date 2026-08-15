// Web e2e scenario: the Model usage settings page end to end through the real
// wire. A seeded three-request session (two on deepseek-v4-flash — one with a
// usage-chunk sample settled by its message — and one, behind a route change,
// on deepseek-v4-pro) is folded and checkpointed with run-relative timestamps
// (eight days back), so the settings Usage section reads the session-list
// row's usageStats projection value and renders the GLOBAL view: the summary
// strip, the day-dot heatmap with per-dot hover tooltips, and one aggregate
// row per model — and the statistics-window selector re-aggregates offline,
// where the 7-day window filters the eight-day-old seed out entirely. Zero
// model calls: the page is a pure read over session.list, so there is no
// replay fixture and a stray stream would fail loud because the adapter
// registry is empty.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/usage-settings', import.meta.url))
const SEED_FIXTURE = join(SNAPSHOT_DIR, 'seed.jsonl')
const OVERVIEW_EXPECTED = join(SNAPSHOT_DIR, 'overview.expected.md')
const HEATMAP_WINDOW_DAYS = 28
const SEED_ID = SessionId('usage-e2e-seed-session')
const MODE = webSnapshotMode()

describe('web e2e: Model usage settings page reads the folded projection rows', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED_FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders the windowed global view with dot tooltips and re-aggregates on window switch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-usage-overview'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '用量' }).click()
    await dialog.getByRole('heading', { name: '模型用量' }).waitFor({ timeout: 10_000 })

    // Default 28-day window: the summary strip carries the seed's three
    // requests (27 input, 2 cache read, 17 output, one reasoning token).
    await dialog.getByText('deepseek-v4-flash').waitFor({ timeout: 10_000 })
    const summary = dialog.locator('dl')
    await expect.poll(async () => summary.locator('dd').allTextContents(), { timeout: 10_000 })
      .toEqual(['1', '3', '27', '2', '—', '17', '1', '1.7 s'])
    // One aggregate row per model, flash first by request count.
    await expect.poll(async () => dialog.locator('tbody tr').count(), { timeout: 10_000 }).toBe(2)
    expect(await dialog.getByText('deepseek-v4-pro').count()).toBe(1)
    // The heatmap carries one dot per window day; the seed's requests sit
    // eight days back, so exactly one cell is lit at full intensity.
    const heatmap = dialog.getByRole('img', { name: '每日 token 用量点阵图，颜色越深当日消耗越大' })
    await expect.poll(async () => heatmap.locator('[data-level]').count(), { timeout: 10_000 })
      .toBe(HEATMAP_WINDOW_DAYS)
    await expect.poll(async () => heatmap.locator('[data-level="4"]').count(), { timeout: 10_000 }).toBe(1)

    // Hovering a dot shows its day and buckets; move off the grid before the
    // golden capture so the bubble does not ride into it.
    await heatmap.locator('[data-level="4"]').hover()
    await dialog.getByText('8 天前 · 输入+缓存 29 · 输出 17').waitFor({ timeout: 10_000 })
    await dialog.getByRole('heading', { name: '模型用量' }).hover()

    // Switching to the 7-day window re-aggregates offline: the seed ages out
    // and the empty notice takes the content column.
    await dialog.getByRole('button', { name: '7 天' }).click()
    await dialog.getByText('所选区间内尚无模型用量记录。').waitFor({ timeout: 10_000 })
    // Back on the 28-day window, the numbers return without any wire change.
    await dialog.getByRole('button', { name: '28 天' }).click()
    await dialog.getByText('deepseek-v4-flash').waitFor({ timeout: 10_000 })
    await expect.poll(async () => summary.locator('dd').allTextContents(), { timeout: 10_000 })
      .toEqual(['1', '3', '27', '2', '—', '17', '1', '1.7 s'])

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(OVERVIEW_EXPECTED, snapshot, MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['seed.jsonl', 'overview.expected.md'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
