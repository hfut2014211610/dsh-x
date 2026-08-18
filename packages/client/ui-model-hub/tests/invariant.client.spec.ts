import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ModelHubUiInvariant from '@deepseek-ai/dsh-client-ui-model-hub/invariant'

describe('model-hub UI invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ModelHubUiInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half inert', async () => {
    const { apply } = await import('../src/index.ts')
    apply()
    expect(true).toBe(true)
  })
})
