import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as UsageInvariant from '@deepseek-ai/dsh-client-ui-settings-usage/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { UsageSection } from '../src/client/UsageSection.tsx'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(UsageInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@deepseek-ai/dsh-client-ui-settings-usage')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('renders null until the shell injects the section dependencies', () => {
    expect(UsageSection({})).toBeNull()
  })
})
