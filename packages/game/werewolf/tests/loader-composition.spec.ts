/**
 * Real Loader composition proof for the stage-2 model boundary. The package,
 * agent loop, and subagent runtime boot through YAML; a scripted provider then
 * captures the complete first and retry requests without a network key.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime, {
  SubagentRunId,
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import WerewolfRuntime, { runWerewolfBotDecision } from '../src/index.ts'
import { buildWerewolfBotRequests, openNextWerewolfPhase, startWerewolfGame } from '../src/engine.ts'
import { counterIds, miniRuleSet } from './fixtures.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-werewolf-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@deepseek-ai/dsh-werewolf'",
    '  config:',
    "    subagentProvider: 'loader-scripted'",
    '    botRetryLimit: 1',
    '    botDecisionTimeoutMs: 1000',
    '    maxConcurrentBots: 2',
    '',
  ].join('\n'))

  context = new Context()
  await mountAgentLoopTestDependencies(context)
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-werewolf', WerewolfRuntime],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

const CAPABLE: SubagentProvider['capabilities'] = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

describe('Werewolf real Loader composition', () => {
  it('boots the YAML surface and snapshots an illegal-action retry into a fresh child', async () => {
    const ctx = await loadComposition()
    const unloaded = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(ctx.werewolf.botRunnerConfig().maxConcurrentBots).toBe(2)

    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    const requests: ResolvedSubagentStartRequest[] = []
    let attempt = 0
    ctx.subagents.registerProvider({
      name: 'loader-scripted',
      capabilities: CAPABLE,
      inheritsParentContext: false,
      start(request) {
        requests.push(request)
        attempt += 1
        const promptText = request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''
        const prompt = JSON.parse(promptText.slice(promptText.indexOf('{'))) as {
          legalAction: { spec: { targets: string[] } }
        }
        const target = attempt === 1 ? 'not-a-player' : prompt.legalAction.spec.targets[0]
        const run: SubagentRun = {
          id: SubagentRunId(`loader-child-${attempt}`) as never,
          localAgent: undefined,
          result: Promise.resolve({
            output: [],
            structured: { action: { value: target }, contextDelta: {} },
            stopReason: 'completed',
          }),
          dispose: async () => {},
        }
        return Promise.resolve(run)
      },
    })

    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 81, ids: counterIds() })
    const opened = openNextWerewolfPhase(started.state, rules, counterIds())
    const request = buildWerewolfBotRequests(opened.state, counterIds())[0]
    if (request === undefined) throw new Error('fixture produced no bot request')
    const agent = ctx.agentLoop.create(SessionId('loader-parent'), { provider: 'mock', model: 'mock' })
    const outcome = await runWerewolfBotDecision({
      ctx,
      config: ctx.werewolf.botRunnerConfig(),
      state: opened.state,
      rules,
      request,
      agent,
    })

    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    expect(outcome.attempts.map(entry => entry.data.category)).toEqual(['illegal-action'])
    expect(requests).toHaveLength(2)
    const retryText = requests[1]?.prompt[0]
    expect(retryText?.type === 'text' && retryText.text.includes('Previous attempt rejected: illegal-action:')).toBe(true)
    expect(requests.map((entry) => {
      const text = entry.prompt[0]?.type === 'text' ? entry.prompt[0].text : ''
      const jsonStart = text.indexOf('{')
      return {
        label: entry.label,
        persona: entry.persona,
        toolFilter: entry.toolFilter,
        maxDepth: entry.maxDepth,
        outputSchema: entry.outputSchema,
        instructionPrefix: text.slice(0, jsonStart).trim(),
        prompt: JSON.parse(text.slice(jsonStart)) as unknown,
      }
    })).toMatchSnapshot('authorized bot prompt and retry contract')
  })
})
