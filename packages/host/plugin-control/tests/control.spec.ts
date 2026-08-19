import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import PluginControlGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const subject: Plugin.Function = () => {}

async function harness(): Promise<{
  ctx: Context
  control: PluginControlGateway
  /**
   * Whether the entry has a live root Fiber.
   *
   * This is the Loader's own notion of a plugin running, and the same one the
   * inventory projects as `fiberPhase`. A disposal hook inside the plugin
   * would be asserting on cordis's callback vocabulary instead.
   */
  running: () => boolean
  entryId: () => PluginEntryId
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.subject = subject
  await ctx.loader.create({ name: 'cordis:subject' })
  await ctx.plugin(PluginControlGateway)
  const control = ctx.get('pluginControl') as PluginControlGateway
  const entry = () => {
    const found = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'cordis:subject')
    if (found === undefined) throw new Error('the fixture entry vanished')
    return found
  }
  return {
    ctx,
    control,
    running: () => entry().fiber !== undefined,
    entryId: () => entry().id as PluginEntryId,
  }
}

describe('PluginControlGateway', () => {
  it('publishes one direct setEnabled method under the pluginControl namespace', async () => {
    const { control } = await harness()
    expect(control.typertRemote).toMatchObject({
      serviceKey: 'pluginControl',
      namespace: 'pluginControl',
    })
    expect(remoteMethods(control)).toEqual([
      { method: 'setEnabled', invocation: { kind: 'direct' } },
    ])
  })

  // The point of the service: a settings page can stop a plugin and start it
  // again, which until now was a command-line-only operation.
  it('stops and restarts the entry it is asked to', async () => {
    const { control, running, entryId } = await harness()
    expect(running()).toBe(true)

    expect(await control.setEnabled({ entryId: entryId(), enabled: false })).toEqual({ found: true, enabled: false })
    expect(running()).toBe(false)

    expect(await control.setEnabled({ entryId: entryId(), enabled: true })).toEqual({ found: true, enabled: true })
    expect(running()).toBe(true)
  })

  // Disabling twice must not be an error or a second teardown: a settings page
  // may send the state it wants rather than the transition it believes in.
  it('is idempotent in both directions', async () => {
    const { control, running, entryId } = await harness()

    await control.setEnabled({ entryId: entryId(), enabled: false })
    await control.setEnabled({ entryId: entryId(), enabled: false })
    expect(running()).toBe(false)

    await control.setEnabled({ entryId: entryId(), enabled: true })
    await control.setEnabled({ entryId: entryId(), enabled: true })
    expect(running()).toBe(true)
  })

  // The caller acts on a snapshot it read moments earlier. An entry removed in
  // between is an ordinary race the page can re-read past, not a fault worth
  // throwing at it.
  it('reports a missing entry instead of throwing', async () => {
    const { control } = await harness()
    expect(await control.setEnabled({ entryId: 'no-such-entry' as PluginEntryId, enabled: true }))
      .toEqual({ found: false, enabled: false })
  })

  // The Loader owns the profile as well as the tree, so the change has to be
  // in the configuration it would write back — not only in the live fiber.
  it('writes the change into the entry configuration, not just the fiber', async () => {
    const { ctx, control, entryId } = await harness()
    await control.setEnabled({ entryId: entryId(), enabled: false })

    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'cordis:subject')
    expect(entry?.options.disabled).toBe(true)
  })
})
