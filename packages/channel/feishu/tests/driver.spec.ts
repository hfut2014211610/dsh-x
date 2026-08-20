import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionDriver } from '../src/driver.ts'
import type { SessionRouter } from '../src/router.ts'

describe('SessionDriver', () => {
  it('reuses a bound live agent after the plugin memory map is rebuilt', async () => {
    const live = { id: 'session-live' } as unknown as Agent
    const resume = vi.fn()
    const touch = vi.fn(async () => {})
    const ctx = {
      agents: {
        get: vi.fn(() => live),
        resume,
      },
      agentDefaultModel: {
        currentSelection: vi.fn(() => ({ provider: 'mock', model: 'mock' })),
      },
      get: vi.fn(() => undefined),
    } as unknown as Context
    const router = {
      lookup: vi.fn(() => ({
        sessionId: 'session-live',
        cwd: 'D:\\work',
        createdAt: 1,
        lastUsedAt: 1,
      })),
      touch,
    } as unknown as SessionRouter
    const driver = new SessionDriver({
      ctx,
      router,
      sink: {
        open: vi.fn(async () => undefined),
        update: vi.fn(),
        close: vi.fn(),
      },
      cwd: () => 'D:\\work',
      now: () => 2,
    })

    await expect(driver.ensureAgent('chat')).resolves.toBe(live)
    expect(ctx.agents.get).toHaveBeenCalledWith('session-live')
    expect(resume).not.toHaveBeenCalled()
    expect(touch).toHaveBeenCalledWith('chat', 2)
  })
})
