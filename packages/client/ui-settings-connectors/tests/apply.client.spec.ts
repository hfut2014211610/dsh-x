/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { ConnectorsSectionInjected } from '../src/client/ConnectorsSection.tsx'
import type { FeishuCardFace } from '../src/client/feishu-card-controller.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const describeSettings = vi.fn(() => Promise.resolve({ rpcId: 's', result: { ok: false, error: {} } }))
  // The card binds its scope through the Settings surface's service, and
  // forwarded host events reach it through the same `$dispatch` handoff the
  // connection sink makes.
  new TestRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: { settings: { describe: describeSettings } },
  } as never)
  await ctx.plugin(SettingsScopeBinder).await()
  // The card's switch reads the plugin tree and writes it; both namespaces are
  // separate services, so a fiber that declares them waits for both.
  const listPlugins = vi.fn(() => Promise.resolve({ ok: true, value: { entries: [] } }))
  const setEnabled = vi.fn(() => Promise.resolve({ ok: true, value: { found: true, enabled: true } }))
  ctx.provide('remote.pluginInventory', { list: listPlugins } as never)
  ctx.provide('remote.pluginControl', { setEnabled } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeSettings, listPlugins, setEnabled }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-connectors apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'connection', 'remote', 'settingsScope',
      'remote.pluginInventory', 'remote.pluginControl',
    ])
  })

  it('registers one Connectors section and declares the card seat', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'connectors', order: 18 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('连接器')
    expect(slots.spec('settings.connector.item')).toMatchObject({ kind: 'list', scope: 'root' })
  })

  it('ships the Feishu channel as the first card', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(slots.entries('settings.connector.item').map(entry => entry.options.id)).toEqual(['feishu'])
  })

  it('injects the live card count and the channel card face', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect((section.inject as unknown as () => ConnectorsSectionInjected)()).toEqual({ cardCount: 1 })

    const card = slots.entries('settings.connector.item')[0]!
    const face = (card as { inject?: () => unknown }).inject?.() as FeishuCardFace
    expect(Object.keys(face.hooks)).toEqual(['feishuCard'])
    // A deployment that composes no Feishu plugin serves no section, and the
    // card says so rather than offering controls it cannot write.
    expect(face.hooks.feishuCard.getSnapshot()).toMatchObject({ status: 'loading' })
    expect(typeof face.save).toBe('function')
  })

  it('reads the section count again when another connector registers a card', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = slots.entries('settings.section')[0]!

    slots.register({ name: 'settings.connector.item', id: 'dingtalk' } as never, () => null)

    expect((section.inject as unknown as () => ConnectorsSectionInjected)()).toEqual({ cardCount: 2 })
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.connector.item')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.spec('settings.connector.item')).toBeUndefined()
  })
})
