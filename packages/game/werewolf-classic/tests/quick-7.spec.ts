import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WerewolfRuntime from '@deepseek-ai/dsh-werewolf'
import {
  abortWerewolfGame,
  driveWerewolfGame,
  startWerewolfGame,
  type WerewolfBotActionRequest,
  type WerewolfEngineIds,
} from '@deepseek-ai/dsh-werewolf'
import * as werewolfClassic from '../src/index.ts'
import { QUICK_7_RULE_SET, VILLAGER_ROLE, WEREWOLF_CLASSIC_FACTIONS, WITCH_ROLE, WOLF_ROLE } from '../src/index.ts'
import type { WerewolfGameStateV1 } from '@deepseek-ai/dsh-werewolf'
import type { WerewolfContextLimitsV1, WerewolfPlayerId } from '@deepseek-ai/dsh-werewolf'
import type { JsonValue } from '@deepseek-ai/dsh-session'

const limits = (): WerewolfContextLimitsV1 => ({
  memorySummaryChars: 200,
  beliefBasisChars: 120,
  commitmentChars: 120,
  strategyChars: 160,
  maxCommitments: 8,
})

function counterIds(): () => number {
  let n = 0
  return () => ++n
}

function deterministicIds(): WerewolfEngineIds {
  const next = counterIds()
  const of = (prefix: string): string => `${prefix}${next()}`
  return {
    game: () => of('g') as never,
    player: () => of('p') as never,
    phaseInstance: () => of('i') as never,
    decision: () => of('d') as never,
    humanAction: () => of('h') as never,
  }
}

async function compiledQuick7(): Promise<ReturnType<WerewolfRuntime['resolveRuleSet']>> {
  const ctx = new Context()
  await ctx.plugin(WerewolfRuntime)
  await ctx.plugin(werewolfClassic)
  return ctx.werewolf.resolveRuleSet(QUICK_7_RULE_SET)
}

type Envelope = { action: JsonValue; publicSpeech?: string; contextDelta: unknown }

/** Faction-aware scripts: villagers push wolf votes; wolves push villager votes and kill villagers. */
function scripts(state: WerewolfGameStateV1, mode: 'village' | 'wolf'): {
  bot: (request: WerewolfBotActionRequest) => Envelope
  human: (request: Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>) => JsonValue
} {
  const factions = new Map(state.players.map(player => [player.playerId as string, player.faction]))
  const enemyOf = (playerId: WerewolfPlayerId, targets: readonly WerewolfPlayerId[]): WerewolfPlayerId | null => {
    const actorIsWolf = factions.get(playerId) === WEREWOLF_CLASSIC_FACTIONS.wolf
    const enemyFaction = mode === 'wolf' || actorIsWolf
      ? WEREWOLF_CLASSIC_FACTIONS.village
      : WEREWOLF_CLASSIC_FACTIONS.wolf
    const preferred = targets.find(target => factions.get(target) === enemyFaction)
    if (preferred !== undefined) return preferred
    if (mode === 'wolf') return targets.find(target => factions.get(target) === WEREWOLF_CLASSIC_FACTIONS.village) ?? targets[0] ?? null
    return targets[0] ?? null
  }
  const pick = (request: WerewolfBotActionRequest | Omit<WerewolfBotActionRequest, 'decisionId' | 'priorContext'>): JsonValue => {
    const spec = request.spec
    if (spec.kind === 'player-target') {
      return { value: spec.targets.length > 0 ? enemyOf(request.playerId, spec.targets) : null }
    }
    if (spec.kind === 'compound') {
      const action: Record<string, JsonValue> = {}
      const context = request.context as { victim?: string | null } | undefined
      for (const field of spec.fields) {
        if (field.id === 'antidote') {
          const selfSaveBlocked = factions.get(request.playerId) === WEREWOLF_CLASSIC_FACTIONS.village
            && context?.victim === request.playerId
          action[field.id] = mode === 'wolf' && !selfSaveBlocked && context?.victim != null ? 'use' : 'skip'
          if (field.spec.kind === 'choice' && !(field.spec.options).includes(action[field.id] as string)) {
            action[field.id] = 'skip'
          }
          continue
        }
        const target = enemyOf(request.playerId, field.spec.kind === 'player-target' ? field.spec.targets : [])
        action[field.id] = mode === 'wolf' && field.id === 'poison' && target !== null ? target : null
      }
      return action
    }
    if (spec.kind === 'text') return { value: 'I am a plain villager.' }
    return { value: null }
  }
  return {
    bot: request => ({ action: pick(request), contextDelta: {} }),
    human: pick,
  }
}

describe('classic quick-7 integration', () => {
  it('compiles quick-7 through the real runtime and classic plugin', async () => {
    const rules = await compiledQuick7()
    expect(rules.input.id).toBe('quick-7')
    expect(rules.digest.length).toBe(64)
    expect(rules.input.policies.voteTie).toBe('revote-once')
  })

  it('completes a village win end to end with deterministic replay', async () => {
    const rules = await compiledQuick7()
    const run = () => {
      const { state } = startWerewolfGame({ ruleSet: rules, seed: 2026, ids: deterministicIds() })
      const cast = scripts(state, 'village')
      return driveWerewolfGame(state, rules, { ...cast, limits: limits(), ids: deterministicIds() })
    }
    const first = run()
    const second = run()
    expect(first.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'faction', factionId: 'village' } } })
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events))
    const phases = first.events.filter(event => event.type === 'werewolf/phase-opened')
    expect(phases.some(event => event.data.phaseId === 'night.witch')).toBe(true)
    expect(phases.some(event => event.data.phaseId === 'day.announce')).toBe(true)
    const deaths = first.state.players.filter(player => !player.alive)
    expect(deaths.length).toBeGreaterThan(0)
    expect(first.state.result?.evidence[0]?.conditionId).toBe('faction-elimination')
  })

  it('completes a wolf win once parity removes the village', async () => {
    const rules = await compiledQuick7()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 77, ids: deterministicIds() })
    const cast = scripts(state, 'wolf')
    const driven = driveWerewolfGame(state, rules, { ...cast, limits: limits(), ids: deterministicIds() })
    expect(driven.stop).toMatchObject({ kind: 'ended', result: { outcome: { kind: 'faction', factionId: 'wolf' } } })
    const alive = driven.state.players.filter(player => player.alive)
    const wolves = alive.filter(player => player.faction === WEREWOLF_CLASSIC_FACTIONS.wolf)
    expect(wolves.length).toBeGreaterThan(0)
    expect(wolves.length).toBeGreaterThanOrEqual(alive.length - wolves.length)
  })

  it('stops for the human turn and resumes without a parent model', async () => {
    const rules = await compiledQuick7()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 5, ids: deterministicIds() })
    const cast = scripts(state, 'village')
    let stopped = driveWerewolfGame(state, rules, { bot: cast.bot, limits: limits(), ids: deterministicIds() })
    let guard = 0
    while (stopped.stop.kind === 'awaiting-human' && guard++ < 200) {
      stopped = driveWerewolfGame(stopped.state, rules, { ...cast, limits: limits(), ids: deterministicIds() })
    }
    expect(stopped.stop.kind).toBe('ended')
  })

  it('aborts a running game with a terminal aborted result', async () => {
    const rules = await compiledQuick7()
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 9, ids: deterministicIds() })
    const stopped = driveWerewolfGame(state, rules, { bot: scripts(state, 'village').bot, limits: limits(), ids: deterministicIds() })
    const aborted = abortWerewolfGame(stopped.state, { requestId: 'r1', digest: 'd1' })
    expect(aborted.state.status).toBe('ended')
    expect(aborted.state.result?.outcome).toEqual({ kind: 'aborted' })
  })

  it('reuses the classic role definitions under their exact versions', async () => {
    expect(WOLF_ROLE.id).toBe('wolf')
    expect(VILLAGER_ROLE.id).toBe('villager')
    expect(WITCH_ROLE.id).toBe('witch')
    const rules = await compiledQuick7()
    expect(rules.roles.has('wolf@1')).toBe(true)
    expect(rules.roles.has('witch@1')).toBe(true)
  })
})
