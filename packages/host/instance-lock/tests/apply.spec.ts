// The plugin around the decision: it has to actually write the claim, actually
// refuse, and actually let go on the way out. A guard that decides correctly
// and then starts anyway is not a guard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, CLAIM_FILE } from '../src/index.ts'
import { formatClaim } from '../src/claim.ts'

let home: string
let ctx: Context
let exits: number[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-instance-lock-'))
  ctx = new Context()
  exits = []
  ctx.provide('appExit', (code: number) => { exits.push(code) })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const claimPath = (): string => join(home, CLAIM_FILE)

describe('apply', () => {
  it('records the claim, and drops it when the tree goes away', async () => {
    const fiber = await ctx.plugin({ apply, name: 'instance-lock' }, { dshHome: home, profile: 'web' })

    const written: unknown = JSON.parse(readFileSync(claimPath(), 'utf8'))
    expect(written).toMatchObject({ pid: process.pid, profile: 'web' })
    expect(exits).toEqual([])

    await fiber.dispose()
    expect(existsSync(claimPath())).toBe(false)
  })

  // The whole point. A refusal that only logs would let the second runtime
  // come up and write into the session directory anyway.
  it('asks the launcher to exit when a live runtime holds the home', async () => {
    writeFileSync(claimPath(), formatClaim({ pid: process.pid + 0, profile: 'web', startedAt: 'earlier' }), 'utf8')
    // A pid that is alive and is not us: the parent of this process will do,
    // and stubbing the check keeps the test off the real process table.
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    writeFileSync(claimPath(), formatClaim({ pid: 999_001, profile: 'web', startedAt: 'earlier' }), 'utf8')
    try {
      await ctx.plugin({ apply, name: 'instance-lock' }, { dshHome: home, profile: 'web' })
    } finally {
      kill.mockRestore()
    }

    expect(exits).toEqual([1])
    // And it must not have taken the home from the runtime it just refused.
    expect(JSON.parse(readFileSync(claimPath(), 'utf8'))).toMatchObject({ pid: 999_001 })
  })

  it('takes over a claim whose process is gone', async () => {
    writeFileSync(claimPath(), formatClaim({ pid: 999_002, profile: 'web', startedAt: 'earlier' }), 'utf8')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH') })
    try {
      await ctx.plugin({ apply, name: 'instance-lock' }, { dshHome: home, profile: 'web' })
    } finally {
      kill.mockRestore()
    }

    expect(exits).toEqual([])
    expect(JSON.parse(readFileSync(claimPath(), 'utf8'))).toMatchObject({ pid: process.pid })
  })

  // A deployment that genuinely wants two runtimes on one home should be able
  // to say so, and saying so must leave no claim behind either.
  it('does nothing at all when enforcement is off', async () => {
    await ctx.plugin({ apply, name: 'instance-lock' }, { dshHome: home, profile: 'web', enforce: false })

    expect(existsSync(claimPath())).toBe(false)
    expect(exits).toEqual([])
  })

  // Disposal must not delete a claim that belongs to whoever came next.
  it('leaves a claim that is no longer ours', async () => {
    const fiber = await ctx.plugin({ apply, name: 'instance-lock' }, { dshHome: home, profile: 'web' })
    writeFileSync(claimPath(), formatClaim({ pid: 999_003, profile: 'web', startedAt: 'later' }), 'utf8')

    await fiber.dispose()

    expect(JSON.parse(readFileSync(claimPath(), 'utf8'))).toMatchObject({ pid: 999_003 })
  })
})
