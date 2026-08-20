// Web e2e scenario: agent-preset selection. The roster's `roots` is an
// assembly fact the CLI entry resolves and patches in, so every other lane
// boots with an empty roster and no preset surface at all; this is the one
// lane that mounts the SHIPPED presets and puts them in front of a browser.
//
// Two surfaces, one host rule: a session's composition is fixed when the
// session starts. Before that, the new-session chip stages the choice beside
// the workspace picker — the only screen where it still works. After it, the
// session header names what the session runs and offers no control at all,
// because the host answers `agent-preset-locked` to anything else.
//
// Zero model calls: no replay fixture mounts, so a stray stream fails loud.
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  SESSION_FORMAT_VERSION, SessionId as sessionId, type SessionEvent, type SessionId,
} from '@deepseek-ai/dsh-session'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-preset-selection', import.meta.url))
const HERO_EXPECTED = join(SNAPSHOT_DIR, 'hero.expected.md')
const MENU_EXPECTED = join(SNAPSHOT_DIR, 'menu.expected.md')
const WRITING_EXPECTED = join(SNAPSHOT_DIR, 'writing.expected.md')
const WRITING_OUTLINE_EXPECTED = join(SNAPSHOT_DIR, 'writing-outline.expected.md')
const UED_EXPECTED = join(SNAPSHOT_DIR, 'ued.expected.md')
const HEADER_EXPECTED = join(SNAPSHOT_DIR, 'header.expected.md')
/** The shipped roster, beside the composition that names it. */
const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'agent-preset-selection-web-e2e'
/** A project skill only a preset that mounts `skill-filesystem` can discover. */
const SKILL_NAME = 'preset-catalog-demo'
const OUTLINE_DOCUMENT = 'outline-navigation.md'
const PROTOTYPE_DOCUMENT = 'prototype.html'

/**
 * Seed one project skill under the connected workspace.
 *
 * Local skill discovery is a PRESET row, so this file is visible through
 * `standard` and invisible through `minimal` — which makes the '/' menu's
 * skill group a statement about the session's composition.
 * @param workspaceCwd - the scaffold's temp project parent.
 */
async function seedWorkspaceSkill(workspaceCwd: string): Promise<void> {
  const directory = join(workspaceCwd, 'workspace', '.agents', 'skills', SKILL_NAME)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), [
    '---',
    `name: ${SKILL_NAME}`,
    'description: Prove the slash catalog follows the session composition',
    '---',
    '',
    'Body.',
    '',
  ].join('\n'))
}

/** Seed a long Markdown document whose final headings require visible scrolling. */
async function seedOutlineDocument(workspaceCwd: string): Promise<void> {
  const filler = Array.from({ length: 24 }, (_, index) => `Paragraph ${String(index + 1)} keeps the target below the fold.`)
  await writeFile(join(workspaceCwd, 'workspace', OUTLINE_DOCUMENT), [
    '# Opening',
    '',
    ...filler.flatMap(line => [line, '']),
    '## Repeated title',
    '',
    ...filler.flatMap(line => [line, '']),
    '## Repeated title',
    '',
    '## Final target',
    '',
    'The outline must reveal this heading.',
    '',
  ].join('\n'))
}

/** Seed one self-contained prototype for the design view to render. */
async function seedPrototype(workspaceCwd: string): Promise<void> {
  await writeFile(join(workspaceCwd, 'workspace', PROTOTYPE_DOCUMENT), [
    '<!doctype html>',
    '<html lang="en"><head><title>Prototype</title></head>',
    '<body><h1>Sign in</h1><script>document.title = "ran"</script></body></html>',
    '',
  ].join('\n'))
}

/**
 * A settled one-turn session with no model content: this lane asserts chrome
 * around a conversation, not a conversation, and a recorded turn would tie
 * the golden to a provider's wording for no gain.
 * @returns a tokenized session log ending on a closed turn.
 */
function seedLog(): string {
  const time = 1784974100000
  const at = (index: number, event: Record<string, unknown>): string =>
    JSON.stringify({ ...event, seq: index, time: time + index })
  return [
    JSON.stringify({ type: 'session', version: 0, id: '{{sessionId}}', createdAt: time, cwd: '{{cwd}}/workspace' }),
    at(0, { type: 'turn/start', data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'seed' } } } }),
    at(1, {
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Seeded turn.' }], source: { kind: 'user', rpcId: 'seed' } },
      surfaceOp: 'append',
    }),
    at(2, { type: 'session/title', data: { title: 'Seeded turn', messageSeqs: [1], source: { kind: 'fallback' } } }),
    at(3, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('\n')
}

/**
 * Persist one child so the assembled header snapshot exercises both action
 * contributors whose relative order is the product contract under test.
 * @param scaffold - the booted Web scaffold.
 * @param parentId - the seeded session whose header the browser opens.
 */
async function seedSubagent(scaffold: WebScaffold, parentId: SessionId): Promise<void> {
  const childId = sessionId('agent-preset-selection-child')
  const createdAt = 1784974100100
  await scaffold.ctx.sessionPersistence.create({
    version: SESSION_FORMAT_VERSION,
    id: childId,
    createdAt,
    cwd: scaffold.workspaceCwd,
    parentSession: parentId,
    origin: 'subagent',
    delegationDepth: 1,
    agentPreset: 'minimal',
  })
  await scaffold.ctx.sessionPersistence.append(childId, [
    {
      type: 'turn/start',
      seq: 0,
      time: createdAt,
      data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    {
      type: 'user/message',
      seq: 1,
      time: createdAt + 1,
      data: {
        content: [{ type: 'text', text: 'Check the session-header action order.' }],
        source: { kind: 'user' },
      },
      surfaceOp: 'append',
    },
    {
      type: 'subagent/descriptor',
      seq: 2,
      time: createdAt + 2,
      data: snapshotSubagentDescriptor({
        mode: 'one-shot', provider: 'spawn', label: 'header order probe',
      }),
    },
    {
      type: 'turn/end',
      seq: 3,
      time: createdAt + 3,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ] as SessionEvent[])
  await scaffold.ctx.sessionProjectionCache.coldSnapshot(childId)
}

/**
 * The preset the host reports for the blank session the workspace connect
 * produced. Addressed by id rather than by scanning the serialized list: the
 * seeded session records `minimal` too, so a substring match over the whole
 * list answers before the switch has landed.
 * @param baseUrl - the scaffold's origin.
 * @returns the live session's preset, or undefined before it is listed.
 */
async function livePreset(baseUrl: string): Promise<string | undefined> {
  const response = await fetch(`${baseUrl}/api/session.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'agent-preset-live', method: 'session.list', payload: {},
    }),
  })
  const body = await response.json() as {
    result: { value?: { items: { sessionId: string; agentPreset?: string }[] } }
  }
  return body.result.value?.items.find(item => item.sessionId !== SEED_ID)?.agentPreset
}

/** Every option label the trigger menu currently lists. */
async function menuOptions(page: Page): Promise<string[]> {
  const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
  await menu.waitFor({ timeout: 10_000 })
  return await menu.getByRole('option').allTextContents()
}

describe('web e2e: agent-preset selection', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      agentPresets: { roots: [{ path: SHIPPED_PRESETS, trust: 'system' }], default: 'standard' },
    })
    // A resumed session runs what it was created with; seeding one that
    // records `minimal` is what makes the header label a claim about the
    // session rather than an echo of the current default.
    const seededId = await seedSession(scaffold, seedLog(), SEED_ID, 'minimal')
    await seedSubagent(scaffold, seededId)
    await seedWorkspaceSkill(scaffold.workspaceCwd)
    await seedOutlineDocument(scaffold.workspaceCwd)
    await seedPrototype(scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('offers the chip on the new-session screen, beside the workspace picker', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-hero'))
    await connectFreshWorkspace(page, scaffold.workspaceCwd)

    const snapshot = await captureStableAria(page, '[class*="heroWorkspaceRow"]', scaffold.workspaceCwd)

    await compareOrRefreshGolden(HERO_EXPECTED, snapshot, MODE)
    // The chip opens on the deployment default, by the name that preset
    // publishes rather than its directory name.
    expect(snapshot).toContain('Standard mode')
  })

  it('names every preset and what it is for', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-menu'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)

    await compareOrRefreshGolden(MENU_EXPECTED, snapshot, MODE)
    // Every shipped preset, each with the sentence saying what it composes —
    // the id alone never said what a preset does.
    expect(snapshot).toContain('Minimal mode')
    expect(snapshot).toContain('Creator mode')
    await page.keyboard.press('Escape')
  })

  it('applies the staged pick to the blank session, and the host honors it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-stage'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /Minimal mode/ }).click()

    // The chip stages; the blank session the workspace connect produced is
    // what the stage lands on. The host's own answer is what comes back.
    await expect.poll(() => livePreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('minimal')
  })

  it('re-reads the slash catalog through the composition the switch installed', async () => {
    // Continues the previous case: the chip has already applied `minimal` to
    // the blank session, and this one reads the menu that switch left behind.
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-slash-catalog'))
    const composer = page.locator('textarea:enabled').last()

    // `minimal` mounts neither the compaction group nor plan mode nor local
    // skill discovery, so the catalog the composer warmed under the
    // deployment default must not survive the switch.
    await composer.fill('/')
    await expect.poll(() => menuOptions(page), { timeout: 15_000 })
      .not.toEqual(expect.arrayContaining([expect.stringContaining(SKILL_NAME)]))
    const onMinimal = await menuOptions(page)
    expect(onMinimal.some(option => option.startsWith('compact'))).toBe(false)
    expect(onMinimal.some(option => option.startsWith('plan'))).toBe(false)
    // The host-plane commands and the client's own contribution are the
    // floor: they belong to no preset and never move.
    expect(onMinimal.some(option => option.startsWith('goal'))).toBe(true)
    expect(onMinimal.some(option => option.startsWith('model'))).toBe(true)
    await composer.fill('')

    // Switching back up reaches the host at all — the chip compares the pick
    // against its list row, so a row that never reprojected the first switch
    // answers "already standard" and sends nothing — and restores the catalog
    // instead of leaving the session reading the narrower composition.
    await page.getByRole('button', { name: 'Minimal mode' }).click()
    await page.getByRole('menuitem', { name: /^Standard mode/ }).first().click()
    await expect.poll(() => livePreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('standard')

    await composer.fill('/')
    await expect.poll(() => menuOptions(page), { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining(SKILL_NAME)]))
    const onStandard = await menuOptions(page)
    expect(onStandard.some(option => option.startsWith('compact'))).toBe(true)
    expect(onStandard.some(option => option.startsWith('plan'))).toBe(true)
    await composer.fill('')
  }, 90_000)

  it('enters the writing workspace immediately and restores the Hero on exit', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-writing'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /Writing mode/ }).click()
    await expect.poll(() => livePreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('writing')

    // The view lands with its tool rail collapsed, so the tree is a click away
    // rather than the first thing the workspace shows. The pointer leaves the
    // rail afterwards: it would sit on the button long enough for the tooltip
    // to open, and a tooltip in the golden records where a mouse was, not what
    // the workspace looks like.
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    await page.mouse.move(0, 0)
    const writingTree = page.getByRole('tree', { name: 'Workspace document tree' })
    await writingTree.waitFor({ timeout: 15_000 })
    await page.getByRole('complementary', { name: 'Assistant' }).waitFor()
    const snapshot = await captureStableAria(page, '[data-phase="active"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WRITING_EXPECTED, snapshot, MODE)

    await page.getByRole('button', { name: OUTLINE_DOCUMENT, exact: true }).click()
    const preview = page.getByRole('article', { name: 'Document preview' })
    await preview.waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Outline', exact: true }).click()
    await page.getByRole('button', { name: /Final target/ }).click()
    const previewPosition = await preview.evaluate((article) => {
      const target = [...article.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .find(heading => heading.textContent?.trim() === 'Final target')
      if (target === undefined) throw new Error('Final target heading was not rendered')
      const viewport = article.getBoundingClientRect()
      const heading = target.getBoundingClientRect()
      return { scrollTop: article.scrollTop, targetTop: heading.top - viewport.top, clientHeight: article.clientHeight }
    })
    expect(previewPosition.scrollTop).toBeGreaterThan(0)
    expect(previewPosition.targetTop).toBeGreaterThanOrEqual(0)
    expect(previewPosition.targetTop).toBeLessThan(previewPosition.clientHeight)
    expect(await page.getByRole('textbox', { name: 'Document editor' }).count()).toBe(0)
    const outlineSnapshot = await captureStableAria(page, '[class*="editorHeader"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WRITING_OUTLINE_EXPECTED, outlineSnapshot, MODE)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Document editor' })
    await page.getByRole('button', { name: /Final target/ }).click()
    await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await editor.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('Document editor is not a textarea')
      return element.value.slice(element.selectionStart, element.selectionEnd)
    })).toBe('Final target')

    // The assistant column starts at whatever the CSS default resolves to for
    // this viewport and the separator owns it from there. Only a real browser
    // proves that chain: the starting width is a measurement of a laid-out
    // panel, and the gesture reads its travel against the column that sits
    // AFTER the handle, so dragging toward the editor is what widens it.
    const assistant = page.getByRole('complementary', { name: 'Assistant' })
    const separator = page.getByRole('separator', { name: 'Resize the assistant column' })
    const beforeWidth = (await assistant.boundingBox())?.width ?? 0
    expect(beforeWidth).toBeGreaterThan(0)
    const grip = await separator.boundingBox()
    if (grip === null) throw new Error('the assistant separator rendered without a box to drag')
    const gripY = grip.y + grip.height / 2
    await page.mouse.move(grip.x + grip.width / 2, gripY)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 - 120, gripY, { steps: 8 })
    await page.mouse.up()
    // Bounded rather than exact: the starting width is a fractional layout
    // measurement that the drag range rounds, so the assertion pins the
    // direction and the travel, not a pixel.
    await expect.poll(async () => (await assistant.boundingBox())?.width ?? 0)
      .toBeGreaterThan(beforeWidth + 100)
    expect((await assistant.boundingBox())?.width ?? 0).toBeLessThan(beforeWidth + 140)

    // The blank-session selector moves into the active header, so entering a
    // preferred workspace never strands the user without a way back.
    await page.getByRole('button', { name: 'Writing mode' }).click()
    await page.getByRole('menuitem', { name: /^Standard mode/ }).first().click()
    await expect.poll(() => livePreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('standard')
    await page.getByText('Into the Unknown').waitFor({ timeout: 15_000 })
    expect(await page.locator('[data-writing-view]').count()).toBe(0)
    expect(await page.locator('[data-phase="hero"]').count()).toBe(1)
  })

  it('renders a prototype in a frame the host is fenced off from', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-ued'))
    await page.getByRole('button', { name: 'Standard mode' }).click()
    await page.getByRole('menuitem', { name: /Design mode/ }).click()
    await expect.poll(() => livePreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('ued')

    await page.getByRole('complementary', { name: 'Prototypes' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: PROTOTYPE_DOCUMENT, exact: true }).click()
    const frame = page.locator('iframe[srcdoc]')
    await frame.waitFor({ timeout: 15_000 })

    // The isolation asserted where it actually ships. Its failure is silent —
    // the preview renders identically with the boundary gone — so the grant is
    // pinned exactly, and the policy is checked to sit after the doctype, since
    // a meta ahead of it would drop the prototype into quirks mode.
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts')
    const srcdoc = await frame.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain("default-src 'none'")
    expect(srcdoc).toContain("connect-src 'none'")
    expect(srcdoc.toLowerCase().indexOf('<!doctype')).toBe(0)

    const snapshot = await captureStableAria(page, '[data-phase="active"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UED_EXPECTED, snapshot, MODE)

    await page.getByRole('button', { name: 'Design mode' }).click()
    await page.getByRole('menuitem', { name: /^Standard mode/ }).first().click()
    await expect.poll(() => livePreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('standard')
  }, 90_000)

  it('labels a resumed session with the preset it was created under', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-preset-header'))
    // The seeded session's cwd is the scaffold root rather than the connected
    // workspace, so it lists under Ungrouped; the group collapses by default.
    await page.getByRole('treeitem', { name: /^Ungrouped/ }).click()
    await page.locator('[role="treeitem"]').last().click()
    await page.getByText('Seeded turn.').waitFor({ timeout: 15_000 })

    const snapshot = await captureStableAria(page, '[class*="titleRow"]', scaffold.workspaceCwd)

    await compareOrRefreshGolden(HEADER_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Minimal mode')
    expect(snapshot).toContain('button "1 subagent"')
    expect(snapshot.indexOf('Minimal mode')).toBeLessThan(snapshot.indexOf('button "1 subagent"'))
    expect(snapshot.indexOf('button "1 subagent"')).toBeLessThan(snapshot.indexOf('button "Session log"'))
    // Static chrome, not a control: the header can only report a composition
    // the host would refuse to change.
    expect(snapshot).not.toContain('button "Minimal mode"')
  })

  it('drove every surface without a page error or a stream warning', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
