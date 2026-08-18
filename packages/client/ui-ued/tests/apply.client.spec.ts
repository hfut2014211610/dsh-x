/**
 * What the browser half registers, which sessions it claims, and the documents
 * callbacks the view reads through.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import type { UedViewInjected } from '../src/client/UedView.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

type PreferredView = (sessionId: string) => string | null
type CompanionView = (sessionId: string, activeViewId: string) => { id: string; label: string } | null

async function bench(sessions: Record<string, { agentPreset?: string }> = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: sessions }) } } as never)
  const remote = new TestRemote(ctx)
  const list = vi.fn(() => Promise.resolve({ ok: true, value: { entries: [] } }))
  const read = vi.fn(() => Promise.resolve({ ok: true, value: { content: '<p/>' } }))
  // The view reads through `ctx.remote.documents`, and the plugin waits on the
  // service path: the double has to be both a property of the remote face and
  // a registered nested service.
  const documents = { list, read }
  const documentsHost = ctx.remote as unknown as { documents: unknown }
  documentsHost.documents = documents
  ctx.provide('remote.documents', documents as never)
  let preferred: PreferredView | undefined
  let companion: CompanionView | undefined
  ctx.provide('conversation', {
    declarePreferredView: (fn: PreferredView) => { preferred = fn; return () => { preferred = undefined } },
    declareCompanionView: (fn: CompanionView) => { companion = fn; return () => { companion = undefined } },
  } as never)
  return {
    ctx,
    remote,
    list,
    read,
    slots: ctx.get('slots') as SlotRegistry,
    preferred: () => preferred,
    companion: () => companion,
  }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-ued apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'conversation', 'sessions', 'remote', 'remote.documents', 'locale'])
  })

  it('registers one design view tab', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('conversation.view')[0]!
    expect(entry.options).toMatchObject({ id: 'ued', order: 6 })
    expect(resolveSlotLabel(entry.options.label)).toBe('设计')
  })

  it('claims the view only for design sessions, and offers the assistant back beside it', async () => {
    const { ctx, slots, preferred, companion } = await bench({
      design: { agentPreset: 'ued' },
      writing: { agentPreset: 'writing' },
    })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(preferred()?.('design')).toBe('ued')
    // The gate is the preset: a session on another preset, and one this client
    // has never seen, both keep whatever view they had.
    expect(preferred()?.('writing')).toBeNull()
    expect(preferred()?.('unknown')).toBeNull()

    expect(companion()?.('design', 'ued')).toEqual({ id: 'chat', label: '助手' })
    // Already on the chat tab: nothing to offer back.
    expect(companion()?.('design', 'chat')).toBeNull()
    expect(companion()?.('writing', 'ued')).toBeNull()
  })

  it('reads listings and prototypes through the documents Remote', async () => {
    const { ctx, slots, list, read } = await bench({ design: { agentPreset: 'ued' } })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry as unknown as { inject?: (id: string) => unknown }).inject?.('design') as UedViewInjected

    await face.list()
    await face.list('pages')
    await face.load('home.html')

    // The root listing carries no path at all rather than an empty one, which
    // the Remote would read as a directory named ''.
    expect(list.mock.calls).toEqual([[{ sessionId: 'design' }], [{ sessionId: 'design', path: 'pages' }]])
    expect(read.mock.calls).toEqual([[{ sessionId: 'design', path: 'home.html' }]])
  })

  it('hands the failure message the host gave to the view, not a generic one', async () => {
    const { ctx, slots, list, read } = await bench({ design: { agentPreset: 'ued' } })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry as unknown as { inject?: (id: string) => unknown }).inject?.('design') as UedViewInjected
    list.mockResolvedValueOnce({ ok: false, error: { message: 'no workspace' } } as never)
    read.mockResolvedValueOnce({ ok: false, error: { message: 'gone' } } as never)

    expect(await face.list()).toEqual({ error: 'no workspace' })
    expect(await face.load('home.html')).toEqual({ error: 'gone' })
  })

  it('delivers a document change only to the session that owns it', async () => {
    const { ctx, slots } = await bench({ design: { agentPreset: 'ued' }, other: { agentPreset: 'ued' } })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const faceFor = (id: string): UedViewInjected =>
      (entry as unknown as { inject?: (id: string) => unknown }).inject?.(id) as UedViewInjected
    const mine = vi.fn()
    const alsoMine = vi.fn()
    const theirs = vi.fn()
    const stop = faceFor('design').subscribeChanged(mine)
    // Two views on one session share the session's listener set; the second
    // must join it rather than replace it.
    const stopSecond = faceFor('design').subscribeChanged(alsoMine)
    faceFor('other').subscribeChanged(theirs)

    ctx.remote.$dispatch('documents/changed', [{ sessionId: 'design', path: 'home.html' }])
    // A session nobody is watching must not throw its way out of the fan-out.
    ctx.remote.$dispatch('documents/changed', [{ sessionId: 'ghost', path: 'x.html' }])

    expect(mine).toHaveBeenCalledTimes(1)
    expect(alsoMine).toHaveBeenCalledTimes(1)
    expect(theirs).not.toHaveBeenCalled()

    stop()
    stopSecond()
    ctx.remote.$dispatch('documents/changed', [{ sessionId: 'design', path: 'home.html' }])
    expect(mine).toHaveBeenCalledTimes(1)
    expect(alsoMine).toHaveBeenCalledTimes(1)
  })

  it('registers into a declaration that arrives after apply, and leaves with the fiber', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    declareRoot(slots)
    await vi.waitFor(() => { expect(slots.entries('conversation.view')).toHaveLength(1) })

    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })
})
