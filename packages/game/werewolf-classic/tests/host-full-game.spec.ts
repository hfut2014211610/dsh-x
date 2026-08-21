import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionGameService from '@deepseek-ai/dsh-game'
import { GameRequestId } from '@deepseek-ai/dsh-game'
import SubagentRuntime, { SubagentRunId, type ResolvedSubagentStartRequest, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import WerewolfRuntime, {
  WerewolfGameGateway,
  type WerewolfActionSpecJsonV1,
  type WerewolfHumanViewV1,
} from '@deepseek-ai/dsh-werewolf'
import * as werewolfClassic from '../src/index.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

function firstValue(spec: Exclude<WerewolfActionSpecJsonV1, { kind: 'compound' }>): unknown {
  if (spec.kind === 'player-target') return spec.targets[0] ?? null
  if (spec.kind === 'choice') return spec.options[0] ?? null
  return spec.allowSkip ? null : 'Pass'.slice(0, spec.maxChars)
}

function firstAction(spec: WerewolfActionSpecJsonV1): Record<string, unknown> {
  if (spec.kind !== 'compound') return { value: firstValue(spec) }
  return Object.fromEntries(spec.fields.map(field => [field.id, firstValue(field.spec)]))
}

describe('quick-7 Session Host', () => {
  it('plays a complete keyless game through fresh isolated children without a Host model call', async () => {
    const ctx = new Context()
    const root = await mkdtemp(join(tmpdir(), 'dsh-werewolf-game-loader-'))
    await mountAgentLoopTestDependencies(ctx)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent-loop'",
      '  config:',
      '    agents: []',
      "- name: '@deepseek-ai/dsh-subagent'",
      "- name: '@deepseek-ai/dsh-game'",
      "- name: '@deepseek-ai/dsh-werewolf'",
      '  config:',
      "    subagentProvider: 'scripted-game'",
      '    botAgent:',
      "      provider: 'mock'",
      "      model: 'mock'",
      '    botRetryLimit: 0',
      '    botDecisionTimeoutMs: 1000',
      '    maxConcurrentBots: 2',
      '    publicTimelineEntries: 12',
      "- name: '@deepseek-ai/dsh-werewolf-classic'",
      "- name: '@deepseek-ai/dsh-werewolf/host'",
      '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      ['@deepseek-ai/dsh-subagent', SubagentRuntime],
      ['@deepseek-ai/dsh-game', SessionGameService],
      ['@deepseek-ai/dsh-werewolf', WerewolfRuntime],
      ['@deepseek-ai/dsh-werewolf-classic', werewolfClassic],
      ['@deepseek-ai/dsh-werewolf/host', WerewolfGameGateway],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const adapter = new MockAdapter([])
    ctx.llm.registerAdapter(['mock'], adapter)

    const requests: ResolvedSubagentStartRequest[] = []
    const childIds: string[] = []
    let active = 0
    let maxActive = 0
    ctx.subagents.registerProvider({
      name: 'scripted-game',
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start(request) {
        requests.push(request)
        active += 1
        maxActive = Math.max(maxActive, active)
        const text = request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''
        const prompt = JSON.parse(text.slice(text.indexOf('{'))) as {
          legalAction: { spec: WerewolfActionSpecJsonV1 }
        }
        const id = `game-child-${requests.length}`
        childIds.push(id)
        const result = new Promise<Awaited<SubagentRun['result']>>((resolve) => {
          setTimeout(() => {
            active -= 1
            resolve({
              output: [],
              structured: { action: firstAction(prompt.legalAction.spec), contextDelta: {} },
              stopReason: 'completed',
            })
          }, 1)
        })
        return Promise.resolve({
          id: SubagentRunId(id) as never,
          localAgent: undefined,
          result,
          dispose: async () => {},
        })
      },
    })

    try {
      let projection = await ctx.werewolfGame.start({
        requestId: 'start-quick-7',
        expectedGameRevision: 0,
        ruleSetId: 'quick-7',
        ruleSetRevision: 1,
        seed: 20260821,
        humanSeatPreference: 1,
        playerNames: ['You', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5', 'Bot 6', 'Bot 7'],
      })
      expect(await ctx.werewolfGame.getView({ gameId: projection.gameId })).toEqual(projection)
      await expect(ctx.werewolfGame.getReplay({ gameId: projection.gameId })).rejects.toThrow(/only after the game ends/)
      let humanActions = 0
      while (projection.view.status !== 'ended' && humanActions < 100) {
        const form = projection.view.actionForm
        if (form === null) throw new Error(`running game stopped without a human action form at revision ${projection.gameRevision}`)
        humanActions += 1
        const actionRequest = {
          gameId: projection.gameId,
          requestId: `human-${humanActions}`,
          expectedGameRevision: projection.gameRevision,
          phaseInstanceId: form.phaseInstanceId,
          action: firstAction(form.spec) as never,
        }
        projection = await ctx.werewolfGame.submitAction(actionRequest)
        if (humanActions === 1) {
          const duplicate = await ctx.werewolfGame.submitAction(actionRequest)
          expect(duplicate.gameRevision).toBe(projection.gameRevision)
          await expect(ctx.werewolfGame.submitAction({ ...actionRequest, action: null })).rejects.toMatchObject({ code: 'GAME_IDEMPOTENCY_CONFLICT' })
        }
      }
      expect(projection.view.status).toBe('ended')
      const replay = await ctx.werewolfGame.getReplay({ gameId: projection.gameId })
      const host = ctx.games.getHostSession(projection.gameId)
      expect(host).toBeDefined()
      expect(adapter.requests).toHaveLength(0)
      expect(new Set(childIds).size).toBe(childIds.length)
      expect(requests.every(request => request.parent.id === host?.id)).toBe(true)
      expect(requests.every(request => request.toolFilter?.allow?.length === 0)).toBe(true)
      expect(maxActive).toBeLessThanOrEqual(2)
      const contextRevisions = requests.map((request) => {
        const text = request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''
        const prompt = JSON.parse(text.slice(text.indexOf('{'))) as { contextRevision: number }
        return prompt.contextRevision
      })
      expect({
        status: projection.view.status,
        result: projection.view.result?.outcome,
        finalRevision: projection.gameRevision,
        humanActions,
        botDecisions: requests.length,
        maxConcurrentChildren: maxActive,
        replayCheckpoints: replay.checkpoints.length,
        hostEventTypes: host?.events.map(event => event.type),
        contextRevisionRange: [Math.min(...contextRevisions), Math.max(...contextRevisions)],
        revealedRoles: projection.view.players.map(player => ({ seat: player.seat, role: player.revealedRole?.id })),
      }).toMatchSnapshot()

      const duplicate = await ctx.games.start<WerewolfHumanViewV1>({
        moduleId: 'werewolf',
        requestId: GameRequestId('start-quick-7'),
        expectedGameRevision: 0,
        input: {
          ruleSetId: 'quick-7', ruleSetRevision: 1, seed: 20260821, humanSeatPreference: 1,
          playerNames: ['You', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5', 'Bot 6', 'Bot 7'],
        },
      })
      expect(duplicate.gameRevision).toBe(projection.gameRevision)
      await expect(ctx.werewolfGame.resume({
        gameId: projection.gameId,
        requestId: 'resume-ended',
        expectedGameRevision: projection.gameRevision,
      })).rejects.toThrow(/not paused/)
      await expect(ctx.werewolfGame.abortGame({
        gameId: projection.gameId,
        requestId: 'abort-ended',
        expectedGameRevision: projection.gameRevision,
      })).rejects.toThrow(/already ended/)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
