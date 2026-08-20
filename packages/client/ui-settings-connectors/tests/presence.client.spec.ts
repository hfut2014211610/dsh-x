/** The plugin-tree half of a connector card: what it reads, and what it writes. */

import { describe, expect, it, vi } from 'vitest'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { ConnectorPresenceController, type ConnectorPluginFace } from '../src/client/connector-presence.ts'

const MODULE = '@deepseek-ai/dsh-feishu'

/** One inventory snapshot holding the channel's entry in the given state. */
function tree(enabled: boolean, moduleName = MODULE): PluginInventorySnapshot {
  return {
    entries: [
      { entryId: 'other', moduleName: '@deepseek-ai/dsh-base', enabled: true, fiberPhase: 'active' },
      { entryId: 'feishu-entry', moduleName, enabled, fiberPhase: enabled ? 'active' : null },
    ],
  } as unknown as PluginInventorySnapshot
}

function bench(face: Partial<ConnectorPluginFace> = {}) {
  const list = vi.fn(async () => tree(true))
  const setEnabled = vi.fn(async () => ({ found: true }))
  const controller = new ConnectorPresenceController(MODULE, {
    list: face.list ?? list, setEnabled: face.setEnabled ?? setEnabled,
  })
  return { controller, list, setEnabled, state: () => controller.store.getSnapshot() }
}

describe('ConnectorPresenceController', () => {
  it('starts without a claim about the plugin', () => {
    expect(bench().state()).toEqual({ presence: 'unknown', busy: false, failed: false })
  })

  it('finds the channel by the module its entry imports', async () => {
    const b = bench()
    await b.controller.refresh()
    expect(b.state().presence).toBe('enabled')
  })

  // The distinction the card exists to make: configured-but-off is not absent.
  it('separates a disabled entry from a missing one', async () => {
    const off = bench({ list: async () => tree(false) })
    await off.controller.refresh()
    expect(off.state().presence).toBe('disabled')

    const elsewhere = bench({ list: async () => tree(true, '@someone/other-channel') })
    await elsewhere.controller.refresh()
    expect(elsewhere.state().presence).toBe('missing')
  })

  // Reporting "not installed" because a call failed would hand the reader a
  // command to install something they already have.
  it('does not read a failed call as an absent plugin', async () => {
    const b = bench({ list: async () => { throw new Error('offline') } })
    await b.controller.refresh()
    expect(b.state()).toEqual({ presence: 'unknown', busy: false, failed: true })
  })

  it('switches the entry it found and re-reads the tree afterwards', async () => {
    let enabled = true
    const b = bench({
      list: async () => tree(enabled),
      setEnabled: async (_entryId, next) => { enabled = next; return { found: true } },
    })
    await b.controller.refresh()

    await b.controller.setEnabled(false)
    expect(b.state()).toEqual({ presence: 'disabled', busy: false, failed: false })
  })

  it('does nothing when there is no entry to switch', async () => {
    const b = bench({ list: async () => tree(true, '@someone/other-channel') })
    await b.controller.refresh()
    await b.controller.setEnabled(true)
    expect(b.setEnabled).not.toHaveBeenCalled()
  })

  // A refused switch may still have landed, so the card shows what the tree
  // reports rather than the state that was asked for.
  it('shows the tree, not the request, when the host is unreachable', async () => {
    const b = bench({
      list: async () => tree(true),
      setEnabled: async () => { throw new Error('refused') },
    })
    await b.controller.refresh()

    await b.controller.setEnabled(false)
    expect(b.state()).toEqual({ presence: 'enabled', busy: false, failed: true })
  })

  // The host answering "it would not start, here is why" is a different thing
  // from the host not answering, and only one of them names something to fix.
  it('keeps the refusal the plugin itself gave, so the page can show it', async () => {
    const b = bench({
      list: async () => tree(false),
      setEnabled: async () => ({ found: true, failure: 'the channel could not reach its bridge' }),
    })
    await b.controller.refresh()

    await b.controller.setEnabled(true)
    expect(b.state()).toEqual({
      presence: 'disabled',
      busy: false,
      failed: true,
      reason: 'the channel could not reach its bridge',
    })
  })

  it('drops a stale refusal once a later read succeeds', async () => {
    let broken = true
    const b = bench({
      list: async () => tree(!broken),
      setEnabled: async () => broken ? { found: true, failure: 'bridge unreachable' } : { found: true },
    })
    await b.controller.refresh()
    await b.controller.setEnabled(true)
    expect(b.state().reason).toBe('bridge unreachable')

    broken = false
    await b.controller.refresh()
    expect(b.state()).toEqual({ presence: 'enabled', busy: false, failed: false })
  })

  it('refuses a second switch while one is in flight', async () => {
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const switching = vi.fn(async () => { await gate; return { found: true } })
    const b = bench({ setEnabled: switching })
    await b.controller.refresh()

    const first = b.controller.setEnabled(false)
    await b.controller.setEnabled(true)
    expect(switching).toHaveBeenCalledTimes(1)

    release()
    await first
  })

  // Two reads racing must not let the older one land last, or the card settles
  // on a tree that has already been replaced.
  it('drops a read overtaken by a later one', async () => {
    const releases: Array<() => void> = []
    const trees = [tree(true), tree(false)]
    const b = bench({
      list: async () => {
        const index = releases.length
        await new Promise<void>((resolve) => { releases.push(resolve) })
        return trees[index]!
      },
    })

    const stale = b.controller.refresh()
    const fresh = b.controller.refresh()
    // Settle the newer read first, then the older one.
    releases[1]!()
    await fresh
    releases[0]!()
    await stale

    expect(b.state().presence).toBe('disabled')
  })
})
