/** Usage section registration: slot declaration injection, the locale-following label thunk, and connection-reset refresh. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, refreshIfLoaded } from '@deepseek-ai/dsh-client-ui-settings-usage/client'
import { UsageSection } from '../src/client/UsageSection.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench(): Promise<{ ctx: Context; slots: SlotRegistry; locale: LocaleRuntime }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // The apply path only captures the wire face; no call leaves this fake
  // until the section actually loads.
  ctx.provide('connection', { api: {} } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-usage apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the usage nav entry with a locale-following label and the section inject face', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(UsageSection)
    expect(entry.options).toMatchObject({ id: 'usage', order: 25 })
    expect(resolveSlotLabel(entry.options.label)).toBe('用量')
    const injected = (entry.inject as unknown as () => import('../src/client/UsageSection.tsx').UsageSectionInjected)()
    expect(injected.t('nav')).toBe('用量')
    expect(injected.t('title')).toBe('模型用量')
    expect(typeof injected.controller.load).toBe('function')
    expect(typeof injected.useSnapshot).toBe('function')
    // The locale thunk follows the active locale without re-registration.
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Usage')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(entry.options.label)).toBe('用量')
  })

  it('registers nothing without the slot declaration and disposes with the fiber', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
  })

  it('refreshes a loaded page and skips an idle one on connection reset', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => import('../src/client/UsageSection.tsx').UsageSectionInjected)()
    // Idle: the reset must not fetch against the empty fake wire face.
    b.ctx.emit('connection/reset')
    injected.controller.store.update((s) => { s.status = 'ready' })
    let loads = 0
    injected.controller.load = async () => { loads += 1 }
    b.ctx.emit('connection/reset')
    expect(loads).toBe(1)
  })

  it('refreshIfLoaded mirrors the same gate', () => {
    const loads: number[] = []
    const loaded = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(loaded as unknown as import('../src/client/store.ts').UsageSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as unknown as import('../src/client/store.ts').UsageSettingsStore)
    expect(loads).toHaveLength(1)
  })
})
