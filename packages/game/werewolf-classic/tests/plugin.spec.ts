import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WerewolfRuntime, { parseWerewolfRuleSetInput } from '@deepseek-ai/dsh-werewolf'
import * as werewolfClassic from '../src/index.ts'
import { QUICK_7_RULE_SET } from '../src/index.ts'

describe('quick-7 rule set', () => {
  it('parses through the core rule-set parser unchanged', () => {
    expect(parseWerewolfRuleSetInput(QUICK_7_RULE_SET)).toEqual(QUICK_7_RULE_SET)
  })
})

describe('werewolf-classic plugin', () => {
  it('registers quick-7 and compiles it with a stable digest', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime)
    await ctx.plugin(werewolfClassic)
    expect(ctx.werewolf.listRuleSets().has('quick-7@1')).toBe(true)
    const first = ctx.werewolf.resolveRuleSet(QUICK_7_RULE_SET)
    const second = ctx.werewolf.resolveRuleSet(QUICK_7_RULE_SET)
    expect(second.digest).toBe(first.digest)
    expect(first.roles.has('wolf@1')).toBe(true)
    expect(first.roles.has('witch@1')).toBe(true)
    expect(first.cycle.night.map(occurrence => occurrence.phaseId)).toEqual([
      'night.wolf-kill', 'night.seer-inspect', 'night.witch',
    ])
    expect(first.cycle.day.map(occurrence => occurrence.phaseId)).toEqual([
      'day.announce', 'day.discussion', 'day.vote',
    ])
    expect(first.victory.map(entry => entry.definition.id)).toEqual(['faction-elimination', 'wolf-parity'])
  })

  it('rejects a duplicate registration with the typed duplicate error', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime)
    await ctx.plugin(werewolfClassic)
    await expect(ctx.plugin(werewolfClassic)).rejects.toMatchObject({
      code: 'WEREWOLF_DUPLICATE_REGISTRATION',
    })
  })

  it('clears registrations on dispose and reloads cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime)
    const fiber = await ctx.plugin(werewolfClassic)
    expect(ctx.werewolf.listRuleSets().size).toBe(1)
    await fiber.dispose()
    expect(ctx.werewolf.listRuleSets().size).toBe(0)
    let unresolved: unknown
    try {
      ctx.werewolf.resolveRuleSet(QUICK_7_RULE_SET)
    } catch (error) {
      unresolved = error
    }
    expect(unresolved).toMatchObject({ code: 'WEREWOLF_UNKNOWN_DEFINITION' })
    await ctx.plugin(werewolfClassic)
    expect(ctx.werewolf.listRuleSets().has('quick-7@1')).toBe(true)
  })
})
