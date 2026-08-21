// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as ClientInvariant, inject, name } from '../src/invariant.ts'

describe('ui-werewolf invariant companion', () => {
  it('registers an empty installer under the package name', async () => {
    expect(name).toBe('client-ui-werewolf-invariant')
    expect(inject).toEqual(['invariants'])
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ClientInvariant).then(() => undefined)).resolves.toBeUndefined()
    await expect(Promise.reject(new Error('probe'))).rejects.toThrow()
  })
})
