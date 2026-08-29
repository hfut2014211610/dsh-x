import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime, { SubagentRunId, type ResolvedSubagentStartRequest, type SubagentProvider, type SubagentResult, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import WerewolfRuntime from '../src/index.ts'
import {
  WEREWOLF_BOT_PERSONA,
  assertWerewolfBotProvider,
  runWerewolfBotDecision,
  selectWerewolfTrusteeAction,
  werewolfEnvelopeSchema,
  type WerewolfBotRunnerConfigV1,
} from '../src/bot-runner.ts'
import {
  buildWerewolfBotRequests,
  commitWerewolfBotDecisions,
  openNextWerewolfPhase,
  startWerewolfGame,
  type WerewolfBotActionRequest,
} from '../src/engine.ts'
import { WerewolfPlayerId } from '../src/brand.ts'
import { BOT_REASONING_EFFORTS } from '../src/runtime.ts'
import { counterIds, EMPTY_DELTA, miniRuleSet, testLimits } from './fixtures.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** One scripted step: the structured value a child resolves with, or a fault. */
type ScriptStep =
  | { kind: 'structured'; value: unknown }
  | { kind: 'stop'; stopReason: SubagentResult['stopReason'] }
  | { kind: 'hang' }
  | { kind: 'throw' }
  | { kind: 'throw-string' }
  | { kind: 'reject-result' }

/** The first legal value of the request's serialized action spec. */
function firstLegalValue(request: ResolvedSubagentStartRequest): string | null {
  const text = request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''
  const observationStart = text.lastIndexOf('\n\n{')
  const prompt = JSON.parse(text.slice(observationStart + 2)) as {
    legalAction: { spec: { kind: string; targets?: string[]; options?: string[] } }
  }
  const spec = prompt.legalAction.spec
  if (spec.kind === 'player-target') return spec.targets?.[0] ?? null
  if (spec.kind === 'choice') return spec.options?.[0] ?? null
  return null
}

interface ScriptedWorld {
  ctx: Context
  agent: Agent
  requests: ResolvedSubagentStartRequest[]
  disposed: number
  disposeFaults: number
}

const CAPABLE: SubagentProvider['capabilities'] = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }

async function setupWorld(steps: ScriptStep[]): Promise<ScriptedWorld> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  const requests: ResolvedSubagentStartRequest[] = []
  const world: ScriptedWorld = { ctx, agent: undefined as never, requests, disposed: 0, disposeFaults: 0 }
  let n = 0
  ctx.subagents.registerProvider({
    name: 'scripted',
    capabilities: CAPABLE,
    inheritsParentContext: false,
    start(request) {
      n += 1
      requests.push(request)
      const step = steps[Math.min(n - 1, steps.length - 1)] ?? { kind: 'structured' as const, value: {} }
      if (step.kind === 'throw') return Promise.reject(new Error('scripted start fault'))
      // Subagent providers cross a process boundary and may reject with an untyped value.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      if (step.kind === 'throw-string') return Promise.reject('scripted string fault')
      let value: unknown = step.kind === 'structured' ? step.value : undefined
      if (step.kind === 'structured') {
        const action = (step.value as { action?: { value?: unknown } }).action
        if (action?.value === 'auto') {
          value = envelope({ value: firstLegalValue(request) }, (step.value as { contextDelta?: unknown }).contextDelta)
        }
      }
      const runId = SubagentRunId(`child-${n}`)
      const result: Promise<SubagentResult> = step.kind === 'hang'
        ? new Promise<SubagentResult>(() => {})
        : step.kind === 'reject-result'
          ? (() => {
            const rejection = Promise.reject(new Error('scripted result fault'))
            void rejection.catch(() => {})
            return rejection
          })()
          : Promise.resolve({
            output: [],
            ...(step.kind === 'structured' ? { structured: value } : {}),
            stopReason: step.kind === 'stop' ? step.stopReason : 'completed',
          })
      const run: SubagentRun = {
        id: runId as never,
        localAgent: undefined,
        result,
        dispose: async () => {
          if (step.kind === 'hang') world.disposed += 1
          if (world.disposeFaults > 0) {
            world.disposeFaults -= 1
            throw new Error('scripted dispose fault')
          }
        },
      }
      return Promise.resolve(run)
    },
  })
  world.agent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return world
}

const config = (overrides: Partial<WerewolfBotRunnerConfigV1> = {}): WerewolfBotRunnerConfigV1 => ({
  provider: 'scripted',
  retryLimit: 2,
  decisionTimeoutMs: 60,
  failurePolicy: 'auto-action',
  maxConcurrentBots: 4,
  limits: testLimits(),
  publicTimelineEntries: 5,
  ...overrides,
})

function firstRequest(): { rules: ReturnType<typeof miniRuleSet>; state: ReturnType<typeof startWerewolfGame>['state']; request: WerewolfBotActionRequest } {
  const rules = miniRuleSet({ voteTie: 'no-elimination' })
  const { state } = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
  const opened = openNextWerewolfPhase(state, rules, counterIds())
  const request = buildWerewolfBotRequests(opened.state, counterIds())[0]
  if (request === undefined) throw new Error('fixture produced no bot request')
  return { rules, state: opened.state, request }
}

const envelope = (action: unknown, delta: unknown = EMPTY_DELTA, publicSpeech?: string) => ({
  action,
  contextDelta: delta,
  ...(publicSpeech === undefined ? {} : { publicSpeech }),
})

describe('assertWerewolfBotProvider', () => {
  it('rejects an unregistered name and a capability gap', async () => {
    const world = await setupWorld([])
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'missing') }).toThrow(/is not registered/)
    let n = 0
    world.ctx.subagents.registerProvider({
      name: 'limited',
      capabilities: { outputSchema: true, depthLimit: false, toolFilter: true, persona: false },
      inheritsParentContext: false,
      start: () => { n += 1; throw new Error('unreachable') },
    })
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'limited') }).toThrow(/lacks depthLimit, persona/)
    for (const flag of ['outputSchema', 'depthLimit', 'toolFilter', 'persona'] as const) {
      world.ctx.subagents.registerProvider({
        name: `no-${flag}`,
        capabilities: { ...CAPABLE, [flag]: false },
        inheritsParentContext: false,
        start: () => {
          n += 1
          throw new Error('unreachable')
        },
      })
    }
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'no-outputSchema') }).toThrow(/lacks outputSchema/)
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'no-depthLimit') }).toThrow(/lacks depthLimit/)
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'no-toolFilter') }).toThrow(/lacks toolFilter/)
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'no-persona') }).toThrow(/lacks persona/)
    world.ctx.subagents.registerProvider({
      name: 'inherits-history',
      capabilities: CAPABLE,
      inheritsParentContext: true,
      start: () => { throw new Error('unreachable') },
    })
    expect(() => { assertWerewolfBotProvider(world.ctx.subagents, 'inherits-history') }).toThrow(/fresh one-shot decisions require isolated children/)
    expect(() =>{  assertWerewolfBotProvider(world.ctx.subagents, 'scripted') }).not.toThrow()
    void n
  })
})

describe('werewolfEnvelopeSchema', () => {
  it('builds object-rooted schemas from the closed vocabulary', () => {
    const single = werewolfEnvelopeSchema({ kind: 'player-target', targets: [WerewolfPlayerId('p1')], allowSkip: true })
    expect(single.type).toBe('object')
    expect(single.additionalProperties).toBe(false)
    expect(single.required).toEqual(['action', 'contextDelta'])
    expect(single.properties?.publicSpeech).toBeUndefined()
    const action = single.properties?.action
    expect(action?.type).toBe('object')
    expect((action?.properties?.value as { oneOf?: Array<{ enum?: unknown[] }> }).oneOf?.[1]?.enum).toEqual(['p1'])
    const choiceSkip = werewolfEnvelopeSchema({ kind: 'choice', options: ['use'], allowSkip: true })
    const choiceAction = choiceSkip.properties?.action
    expect((choiceAction?.properties?.value as { oneOf?: unknown[] }).oneOf).toHaveLength(2)
    const choiceForced = werewolfEnvelopeSchema({ kind: 'choice', options: ['use'], allowSkip: false })
    expect((choiceForced.properties?.action?.properties?.value as { type?: string }).type).toBe('string')
    const textForced = werewolfEnvelopeSchema({ kind: 'text', maxChars: 4, allowSkip: false })
    expect(textForced.properties?.action?.properties?.value).toEqual({ type: 'string' })
    expect(textForced.properties?.publicSpeech).toEqual({ type: 'string' })
    const compound = werewolfEnvelopeSchema({
      kind: 'compound',
      fields: [{ id: 'save', spec: { kind: 'choice', options: ['use'], allowSkip: false } }],
      allowSkip: false,
    })
    const compoundAction = compound.properties?.action
    expect(Object.keys(compoundAction?.properties ?? {})).toEqual(['save'])
    expect(compoundAction?.required).toEqual(['save'])
  })
})

describe('selectWerewolfTrusteeAction', () => {
  it('picks the first legal value of every spec kind', () => {
    expect(selectWerewolfTrusteeAction({ kind: 'player-target', targets: [WerewolfPlayerId('p2')], allowSkip: false }))
      .toEqual({ value: WerewolfPlayerId('p2') })
    expect(selectWerewolfTrusteeAction({ kind: 'player-target', targets: [], allowSkip: true })).toEqual({ value: null })
    expect(selectWerewolfTrusteeAction({ kind: 'choice', options: ['use', 'skip'], allowSkip: false })).toEqual({ value: 'use' })
    expect(selectWerewolfTrusteeAction({ kind: 'choice', options: [], allowSkip: true })).toEqual({ value: null })
    expect(selectWerewolfTrusteeAction({ kind: 'text', maxChars: 40, allowSkip: true })).toEqual({ value: null })
    expect(selectWerewolfTrusteeAction({ kind: 'text', maxChars: 2, allowSkip: false })).toEqual({ value: 'Pa' })
    expect(selectWerewolfTrusteeAction({
      kind: 'compound',
      fields: [
        { id: 'save', spec: { kind: 'choice', options: ['skip'], allowSkip: false } },
        { id: 'poison', spec: { kind: 'player-target', targets: [WerewolfPlayerId('p3')], allowSkip: true } },
      ],
      allowSkip: false,
    })).toEqual({ save: 'skip', poison: WerewolfPlayerId('p3') })
  })
})

describe('runWerewolfBotDecision', () => {
  it('accepts a valid structured envelope and forwards the child contract', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const world = await setupWorld([{ kind: 'structured', value: envelope({ value: target }) }])
    const outcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state, rules, request, agent: world.agent,
    })
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    expect(outcome.attempts).toEqual([])
    expect(outcome.submission.envelope.action).toEqual({ value: target })
    const sent = world.requests[0]
    expect(sent?.persona).toBe(WEREWOLF_BOT_PERSONA)
    expect(sent?.toolFilter).toEqual({ allow: [] })
    expect(sent?.outputSchema).toBeDefined()
    expect(sent?.maxDepth).toBe(1)
    expect(sent?.parent).toBe(world.agent)
    expect(sent?.label).toContain('werewolf')
    const text = sent?.prompt[0]?.type === 'text' ? sent.prompt[0].text : ''
    expect(text).toContain('"decisionId"')
    expect(text).toContain(request.decisionId)
  })

  it('passes the configured agent route to every child', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const world = await setupWorld([{ kind: 'structured', value: envelope({ value: target }) }])
    await runWerewolfBotDecision({
      ctx: world.ctx,
      config: config({ botAgent: { provider: 'mock', model: 'bot-model', maxTokens: 512 } }),
      state, rules, request, agent: world.agent,
    })
    expect(world.requests[0]?.agentOptions).toEqual({ provider: 'mock', model: 'bot-model', maxTokens: 512 })
  })

  it('retries with a concise diagnostic and records the attempt category', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const world = await setupWorld([
      { kind: 'structured', value: envelope({ value: WerewolfPlayerId('not-a-player') }) },
      { kind: 'structured', value: envelope({ value: target }) },
    ])
    const outcome = await runWerewolfBotDecision({ ctx: world.ctx, config: config(), state, rules, request, agent: world.agent })
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    expect(outcome.attempts.map(attempt => attempt.data.category)).toEqual(['illegal-action'])
    const firstAttempt = outcome.attempts[0]
    expect(firstAttempt).toBeDefined()
    expect((firstAttempt as { data: { gameRevision: number } }).data.gameRevision).toBe(state.revision)
    expect((firstAttempt as { data: { childSessionId: string } }).data.childSessionId).toMatch(/child-/)
    const second = world.requests[1]?.prompt[0]
    expect(second?.type === 'text' && second.text.includes('illegal-action')).toBe(true)
  })

  it('classifies invalid output, invalid deltas, and rejected results', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const cases: Array<[ScriptStep, string]> = [
      [{ kind: 'structured', value: { action: {} } }, 'invalid-output'],
      [{ kind: 'structured', value: envelope({ value: target }, { bogus: 1 }) }, 'invalid-context-delta'],
      [{ kind: 'stop', stopReason: 'error' }, 'result-rejected'],
    ]
    for (const [step, category] of cases) {
      const world = await setupWorld([step, step, step])
      const outcome = await runWerewolfBotDecision({ ctx: world.ctx, config: config(), state, rules, request, agent: world.agent })
      expect(outcome.kind).toBe('trustee')
      if (outcome.kind !== 'trustee') return
      expect(outcome.attempts.map(attempt => attempt.data.category)).toEqual([category, category, category])
    }
  })

  it('falls back to a trustee action after retry exhaustion', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([{ kind: 'stop', stopReason: 'error' }])
    const outcome = await runWerewolfBotDecision({ ctx: world.ctx, config: config(), state, rules, request, agent: world.agent })
    expect(outcome.kind).toBe('trustee')
    if (outcome.kind !== 'trustee') return
    expect(outcome.attempts).toHaveLength(3)
    expect(outcome.submission.trustee).toBe(true)
    expect(outcome.submission.envelope.contextDelta).toEqual({ memorySummary: 'Trustee action taken after failed model attempts.' })
    const expected = selectWerewolfTrusteeAction(request.spec)
    expect(outcome.submission.envelope.action).toEqual(expected)
  })

  it('requests a pause when the failure policy says so', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([{ kind: 'stop', stopReason: 'error' }])
    const outcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config({ failurePolicy: 'pause-game' }), state, rules, request, agent: world.agent,
    })
    expect(outcome).toMatchObject({ kind: 'paused' })
    if (outcome.kind !== 'paused') return
    expect(outcome.attempts).toHaveLength(3)
  })

  it('records a provider-setup failure when start rejects', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([{ kind: 'throw' }])
    const outcome = await runWerewolfBotDecision({ ctx: world.ctx, config: config(), state, rules, request, agent: world.agent })
    expect(outcome.kind).toBe('trustee')
    if (outcome.kind !== 'trustee') return
    expect(outcome.attempts.map(attempt => attempt.data.category)).toEqual(['provider-setup', 'provider-setup', 'provider-setup'])
    expect((outcome.attempts[0] as { data: { childSessionId: string } }).data.childSessionId).toBe('(none)')

    const stringWorld = await setupWorld([{ kind: 'throw-string' }])
    const stringOutcome = await runWerewolfBotDecision({
      ctx: stringWorld.ctx, config: config({ retryLimit: 0 }), state, rules, request, agent: stringWorld.agent,
    })
    expect(stringOutcome.attempts.map(entry => entry.data.category)).toEqual(['provider-setup'])
  })

  it('times out a hanging child, disposes it, and settles by fallback', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([{ kind: 'hang' }])
    world.disposeFaults = 3
    const outcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config({ decisionTimeoutMs: 10 }), state, rules, request, agent: world.agent,
    })
    expect(outcome.kind).toBe('trustee')
    expect(world.disposed).toBe(3)
    if (outcome.kind !== 'trustee') return
    expect(outcome.attempts.map(entry => entry.data.category)).toEqual(['disposal', 'disposal', 'disposal'])
  })

  it('rejects an otherwise valid attempt when disposal fails, then retries cleanly', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const world = await setupWorld([
      { kind: 'structured', value: envelope({ value: target }) },
      { kind: 'structured', value: envelope({ value: target }) },
    ])
    world.disposeFaults = 1
    const outcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state, rules, request, agent: world.agent,
    })
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    expect(outcome.attempts.map(entry => entry.data.category)).toEqual(['disposal'])
    const retry = world.requests[1]?.prompt[0]
    expect(retry?.type === 'text' && retry.text.includes('disposal')).toBe(true)
  })

  it('cancels through the caller signal and disposes the running child', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([{ kind: 'hang' }])
    const controller = new AbortController()
    controller.abort()
    const outcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config({ decisionTimeoutMs: 10 }), state, rules, request, agent: world.agent, signal: controller.signal,
    })
    expect(outcome).toMatchObject({ kind: 'cancelled' })
    const world2 = await setupWorld([{ kind: 'hang' }])
    const controller2 = new AbortController()
    const pending = runWerewolfBotDecision({
      ctx: world2.ctx, config: config({ decisionTimeoutMs: 60000 }), state, rules, request, agent: world2.agent, signal: controller2.signal,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    controller2.abort()
    expect(await pending).toMatchObject({ kind: 'cancelled' })
    expect(world2.disposed).toBe(1)
  })

  it('treats cancellation during rejecting provider setup as cancellation, not a provider failure', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([{ kind: 'throw' }])
    const controller = new AbortController()
    const pending = runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state, rules, request, agent: world.agent, signal: controller.signal,
    })
    controller.abort()
    await expect(pending).resolves.toEqual({ kind: 'cancelled', attempts: [] })
  })

  it('classifies malformed envelopes and a rejecting child result precisely', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const cases: Array<[unknown, string]> = [
      [{ action: { value: target }, contextDelta: {}, extra: 1 }, 'invalid-output'],
      [{ action: { value: target }, publicSpeech: 42, contextDelta: {} }, 'invalid-output'],
      ['nope', 'invalid-output'],
      [{ contextDelta: {} }, 'invalid-output'],
    ]
    for (const [value, category] of cases) {
      const world = await setupWorld([{ kind: 'structured', value }, { kind: 'structured', value }, { kind: 'structured', value }])
      const outcome = await runWerewolfBotDecision({ ctx: world.ctx, config: config(), state, rules, request, agent: world.agent })
      expect(outcome.kind).toBe('trustee')
      if (outcome.kind !== 'trustee') return
      expect(outcome.attempts.map(attempt => attempt.data.category)).toEqual([category, category, category])
      const second = world.requests[1]?.prompt[0]
      expect(second?.type === 'text' && second.text.includes(category)).toBe(true)
    }
    const rejectWorld = await setupWorld([{ kind: 'reject-result' }, { kind: 'reject-result' }, { kind: 'reject-result' }])
    const rejectOutcome = await runWerewolfBotDecision({
      ctx: rejectWorld.ctx, config: config(), state, rules, request, agent: rejectWorld.agent,
    })
    expect(rejectOutcome.kind).toBe('trustee')
    if (rejectOutcome.kind !== 'trustee') return
    expect(rejectOutcome.attempts.map(attempt => attempt.data.category)).toEqual(['result-rejected', 'result-rejected', 'result-rejected'])
  })

  it('accepts a public speech in a text phase and defaults an absent action to null', async () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
    const night = openNextWerewolfPhase(started.state, rules, counterIds())
    const wolfRequest = buildWerewolfBotRequests(night.state, counterIds())[0]
    if (wolfRequest === undefined) throw new Error('no wolves')
    const target = wolfRequest.spec.kind === 'player-target' ? wolfRequest.spec.targets[0] : null
    const kill = openNextWerewolfPhase(
      {
        ...night.state,
        openPhase: null,
        segment: 'day',
        cursorIndex: -1,
        occurrence: 0,
        positionConsumed: true,
        timeline: [],
        sameDayResolutions: [],
      },
      rules,
      counterIds(),
    )
    const talkRequest = buildWerewolfBotRequests(kill.state, counterIds())[0]
    if (talkRequest === undefined) throw new Error('no talk request')
    expect(talkRequest.spec.kind).toBe('text')
    const world = await setupWorld([
      { kind: 'structured', value: envelope({ value: null }, EMPTY_DELTA, '  hello   table  ') },
      { kind: 'structured', value: envelope({ value: null }) },
    ])
    void target
    const talkOutcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state: kill.state, rules, request: talkRequest, agent: world.agent,
    })
    expect(talkOutcome.kind).toBe('accepted')
    if (talkOutcome.kind !== 'accepted') return
    expect(talkOutcome.submission.envelope.publicSpeech).toBe('hello table')
    expect(talkOutcome.submission.envelope.action).toEqual({ value: null })

    const whitespaceWorld = await setupWorld([
      { kind: 'structured', value: envelope({ value: null }, EMPTY_DELTA, '   \n  ') },
    ])
    const whitespace = await runWerewolfBotDecision({
      ctx: whitespaceWorld.ctx, config: config(), state: kill.state, rules, request: talkRequest, agent: whitespaceWorld.agent,
    })
    expect(whitespace.kind).toBe('accepted')
    if (whitespace.kind !== 'accepted') return
    expect(whitespace.submission.envelope.publicSpeech).toBeUndefined()

    const actionSpeechWorld = await setupWorld([
      { kind: 'structured', value: envelope({ value: '  action value is visible  ' }) },
    ])
    const actionSpeech = await runWerewolfBotDecision({
      ctx: actionSpeechWorld.ctx,
      config: config(),
      state: kill.state,
      rules,
      request: talkRequest,
      agent: actionSpeechWorld.agent,
    })
    expect(actionSpeech.kind).toBe('accepted')
    if (actionSpeech.kind !== 'accepted') return
    expect(actionSpeech.submission.envelope.publicSpeech).toBe('action value is visible')

    const wrappedSpeech = await runWerewolfBotDecision({
      ctx: actionSpeechWorld.ctx,
      config: config(),
      state: kill.state,
      rules,
      request: talkRequest,
      agent: actionSpeechWorld.agent,
      executor: {
        turnBot: async childId => ({
          childId,
          output: [{
            type: 'text',
            text: JSON.stringify({
              action: { value: { skip: false, text: 'wrapped speech is visible' } },
              contextDelta: { memorySummary: 'I spoke during day one.' },
              publicSpeech: 'wrapped speech is visible',
            }),
          }],
          stopReason: 'completed',
          timedOut: false,
        }),
      },
    })
    expect(wrappedSpeech.kind).toBe('accepted')
    if (wrappedSpeech.kind !== 'accepted') return
    expect(wrappedSpeech.attempts).toEqual([])
    expect(wrappedSpeech.submission.envelope.action).toEqual({ value: 'wrapped speech is visible' })
    expect(wrappedSpeech.submission.envelope.publicSpeech).toBe('wrapped speech is visible')

    const fixedPrompts: string[] = []
    const fixedOutputs = [
      '{"legalAction":{"value":"bad"},"contextDelta":{}}',
      '{"action":{"kind":"speak","text":"still invalid"},"contextDelta":{"beliefs":[]}}',
      '{"action":{"value":"corrected"},"contextDelta":{}}',
    ]
    const fixed = await runWerewolfBotDecision({
      ctx: actionSpeechWorld.ctx,
      config: config({ retryLimit: 2 }),
      state: kill.state,
      rules,
      request: talkRequest,
      agent: actionSpeechWorld.agent,
      executor: {
        turnBot: async (childId, blocks) => {
          fixedPrompts.push(blocks[0]?.type === 'text' ? blocks[0].text : '')
          return {
            childId,
            output: [{ type: 'text', text: fixedOutputs[fixedPrompts.length - 1] ?? '' }],
            stopReason: 'completed',
            timedOut: false,
          }
        },
      },
    })
    expect(fixed.kind).toBe('accepted')
    if (fixed.kind !== 'accepted') return
    expect(fixed.submission.envelope.publicSpeech).toBe('corrected')
    expect(fixedPrompts[0]).toContain('"legalAction"')
    expect(fixedPrompts[0]).toContain('action must be exactly {"value": VALUE}')
    expect(fixedPrompts[1]).not.toContain('"decisionId"')
    expect(fixedPrompts[1]).toContain('invalid-output')
    expect(fixedPrompts[1]).toContain('action must be exactly {"value": VALUE}')
    expect(fixedPrompts[2]).not.toContain('"decisionId"')
    expect(fixedPrompts[2]).toContain('illegal-action')
  })

  it('rejects public speech outside text phases and above the active policy limit', async () => {
    const first = firstRequest()
    const target = first.request.spec.kind === 'player-target' ? first.request.spec.targets[0] : null
    const nonTextWorld = await setupWorld(Array.from({ length: 3 }, () => ({
      kind: 'structured' as const,
      value: envelope({ value: target }, EMPTY_DELTA, 'not allowed'),
    })))
    const nonText = await runWerewolfBotDecision({
      ctx: nonTextWorld.ctx, config: config(), state: first.state, rules: first.rules,
      request: first.request, agent: nonTextWorld.agent,
    })
    expect(nonText.kind).toBe('trustee')
    if (nonText.kind !== 'trustee') return
    expect(nonText.attempts.map(entry => entry.data.category)).toEqual(['illegal-action', 'illegal-action', 'illegal-action'])

    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const started = startWerewolfGame({ ruleSet: rules, seed: 12, ids: counterIds() })
    const talk = openNextWerewolfPhase({
      ...started.state,
      segment: 'day',
      cursorIndex: -1,
      occurrence: 0,
      positionConsumed: true,
    }, rules, counterIds())
    const talkRequest = buildWerewolfBotRequests(talk.state, counterIds())[0]
    if (talkRequest === undefined || talkRequest.spec.kind !== 'text') throw new Error('no talk request')
    const tooLong = 'x'.repeat(talk.state.ruleSet.policies.speechMaxChars + 1)
    const longWorld = await setupWorld(Array.from({ length: 3 }, () => ({
      kind: 'structured' as const,
      value: envelope({ value: null }, EMPTY_DELTA, tooLong),
    })))
    const long = await runWerewolfBotDecision({
      ctx: longWorld.ctx, config: config(), state: talk.state, rules, request: talkRequest, agent: longWorld.agent,
    })
    expect(long.kind).toBe('trustee')
    if (long.kind !== 'trustee') return
    expect(long.attempts.map(entry => entry.data.category)).toEqual(['illegal-action', 'illegal-action', 'illegal-action'])
  })

  it('cancels after a settled result through the caller signal', async () => {
    const { rules, state, request } = firstRequest()
    const target = request.spec.kind === 'player-target' ? request.spec.targets[0] : null
    const world = await setupWorld([{ kind: 'structured', value: envelope({ value: target }) }])
    world.disposeFaults = 1
    const controller = new AbortController()
    const pending = runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state, rules, request, agent: world.agent, signal: controller.signal,
    })
    controller.abort()
    const outcome = await pending
    expect(outcome).toMatchObject({ kind: 'cancelled' })
    expect(outcome.attempts.map(entry => entry.data.category)).toEqual(['disposal'])
  })

  it('rejects a request whose player is not an actor of the open phase', async () => {
    const { rules, state, request } = firstRequest()
    const world = await setupWorld([])
    await expect(runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state, rules,
      request: { ...request, playerId: WerewolfPlayerId('bystander') },
      agent: world.agent,
    })).rejects.toThrow(/not an actor of the open phase/)
  })
})

describe('context revision continuity through the runner', () => {
  it('feeds decision N through the runner into decision N+1 with siblings untouched', async () => {
    const rules = miniRuleSet({ voteTie: 'no-elimination' })
    const { state } = startWerewolfGame({ ruleSet: rules, seed: 77, ids: counterIds() })
    const opened = openNextWerewolfPhase(state, rules, counterIds())
    const requests = buildWerewolfBotRequests(opened.state, counterIds())
    expect(requests.length).toBe(2)
    const first = requests[0]
    const sibling = requests[1]
    if (first === undefined || sibling === undefined) throw new Error('fixture produced no wolves')
    const world = await setupWorld([
      { kind: 'structured', value: envelope({ value: 'auto' }, { memorySummary: 'trust the quiet seat' }) },
      { kind: 'structured', value: envelope({ value: 'auto' }) },
      { kind: 'structured', value: envelope({ value: 'auto' }) },
    ])
    const firstOutcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state: opened.state, rules, request: first, agent: world.agent,
    })
    expect(firstOutcome.kind).toBe('accepted')
    if (firstOutcome.kind !== 'accepted') return
    expect(first.priorContext.revision).toBe(0)
    const siblingOutcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state: opened.state, rules, request: sibling, agent: world.agent,
    })
    expect(siblingOutcome.kind).toBe('accepted')
    if (siblingOutcome.kind !== 'accepted') return
    const committed = commitWerewolfBotDecisions(opened.state, [firstOutcome.submission, siblingOutcome.submission], testLimits())
    expect(committed.state.contexts[first.playerId]?.revision).toBe(1)
    expect(committed.state.contexts[sibling.playerId]?.revision).toBe(1)
    const nextPhase = openNextWerewolfPhase({ ...committed.state, openPhase: null }, rules, counterIds())
    const later = buildWerewolfBotRequests(nextPhase.state, counterIds())
      .find(candidate => candidate.playerId === first.playerId)
    if (later === undefined) throw new Error('first wolf has no later decision')
    expect(later.priorContext.revision).toBe(1)
    expect(later.priorContext.memorySummary).toBe('trust the quiet seat')
    const laterOutcome = await runWerewolfBotDecision({
      ctx: world.ctx, config: config(), state: nextPhase.state, rules, request: later, agent: world.agent,
    })
    expect(laterOutcome.kind).toBe('accepted')
    expect(world.requests).toHaveLength(3)
    const laterPrompt = world.requests[2]?.prompt[0]
    expect(laterPrompt?.type === 'text' && laterPrompt.text.includes('trust the quiet seat')).toBe(true)
    const siblingPrompt = world.requests[1]?.prompt[0]
    expect(siblingPrompt?.type === 'text' && siblingPrompt.text.includes('trust the quiet seat')).toBe(false)
  })
})

describe('runtime bot configuration', () => {
  it('loads reviewed defaults and resolves the runner config', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime)
    const resolved = ctx.werewolf.botRunnerConfig()
    expect(resolved.provider).toBe('spawn')
    expect(resolved.retryLimit).toBe(2)
    expect(resolved.decisionTimeoutMs).toBe(60000)
    expect(resolved.failurePolicy).toBe('auto-action')
    expect(resolved.maxConcurrentBots).toBe(4)
    expect(resolved.publicTimelineEntries).toBe(24)
    expect(resolved.botAgent).toBeUndefined()
    expect(resolved.reasoningEffort).toBeUndefined()
    expect(resolved.limits.maxCommitments).toBe(8)
  })

  it('resolves every omitted field through the reviewed defaults', async () => {
    const ctx = new Context()
    await ctx.plugin(WerewolfRuntime, { subagentProvider: 'scripted' })
    const resolved = ctx.werewolf.botRunnerConfig()
    expect(resolved.limits).toEqual({
      memorySummaryChars: 200, beliefBasisChars: 120, commitmentChars: 120, strategyChars: 160, maxCommitments: 8,
    })
    expect(resolved.botAgent).toBeUndefined()
    const emptyAgent = new Context()
    await emptyAgent.plugin(WerewolfRuntime, { subagentProvider: 'x', botAgent: {} })
    expect(emptyAgent.werewolf.botRunnerConfig().botAgent).toBeUndefined()
  })

  it.each(['', ' high', 'high ', 'hight'])('rejects an out-of-vocabulary Bot reasoning effort %j', async (value) => {
    const ctx = new Context()
    await expect(ctx.plugin(WerewolfRuntime, {
      subagentProvider: 'scripted',
      botReasoningEffort: value as (typeof BOT_REASONING_EFFORTS)[number],
    })).rejects.toThrow()
  })

  it('keeps defaults over a config-free load out of the documented surface', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WerewolfRuntime, {
      subagentProvider: 'scripted',
      botRetryLimit: 0,
      botFailurePolicy: 'pause-game',
      botAgent: { provider: 'mock', model: 'bot' },
      botReasoningEffort: 'high',
      maxConcurrentBots: 2,
      contextLimits: {
        memorySummaryChars: 10, beliefBasisChars: 10, commitmentChars: 10, strategyChars: 10, maxCommitments: 2,
      },
      publicTimelineEntries: 4,
    })
    const resolved = ctx.werewolf.botRunnerConfig()
    expect(resolved.retryLimit).toBe(0)
    expect(resolved.failurePolicy).toBe('pause-game')
    expect(resolved.maxConcurrentBots).toBe(2)
    expect(resolved.botAgent).toEqual({ provider: 'mock', model: 'bot' })
    expect(resolved.reasoningEffort).toBe('high')
    expect(resolved.limits.memorySummaryChars).toBe(10)
    expect(resolved.publicTimelineEntries).toBe(4)
    void fiber
    void (null as unknown as SessionEvent)
  })
})
