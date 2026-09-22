import { describe, expect, it } from 'vitest'
// The fork preset plugin is plain JavaScript and intentionally has no d.ts.
import { apply } from '../presets/anchored-standard/instruction-hint.mjs'

const PROJECT_ROOT = '/tmp/dsh-hint-project'

interface Decision {
  kind: string
  messages: Message[]
}

interface Message {
  id: string
  role: string
  content: unknown[]
  source: Record<string, unknown>
}

interface Session {
  id: string
  header: { cwd: string; delegationDepth: number }
  snapshotEvents: () => unknown[]
}

type SessionListener = (session: Session, event: unknown) => void
type PreStepListener = (payload: { agent: { session: Session } }, next: () => Promise<Decision>) => Promise<Decision>

const fakeFs = {
  async resolve(target: string): Promise<string> {
    return target
  },
  async stat(target: string): Promise<{ type: string } | undefined> {
    return target === `${PROJECT_ROOT}/AGENTS.md` ? { type: 'file' } : undefined
  },
}

function mount(events: unknown[]): {
  session: Session
  runPreStep: (next?: () => Promise<Decision>) => Promise<Decision>
} {
  const sessionListeners: SessionListener[] = []
  const preStepListeners: PreStepListener[] = []
  const ctx = {
    on(event: string, listener: unknown): void {
      if (event === 'session/event') sessionListeners.push(listener as SessionListener)
      if (event === 'agent/pre-step') preStepListeners.push(listener as PreStepListener)
    },
    get(name: string): unknown {
      return name === 'fs' ? fakeFs : undefined
    },
    logger: { warn: (): void => {} },
  }
  apply(ctx, { promoteOn: 'either', includeSubagents: true })
  const session: Session = {
    id: 'session-instruction-hint-test',
    header: { cwd: PROJECT_ROOT, delegationDepth: 0 },
    snapshotEvents: () => events,
  }
  const runPreStep = (next?: () => Promise<Decision>): Promise<Decision> =>
    preStepListeners[0]!({ agent: { session } }, next ?? (async () => ({ kind: 'continue', messages: [] })))
  for (const listener of sessionListeners) listener(session, { type: 'assistant/message', seq: 0 })
  return { session, runPreStep }
}

describe('anchored-standard instruction-hint durable source', () => {
  it('emits the released plugin source after promotion', async () => {
    const { runPreStep } = mount([{ type: 'assistant/message', seq: 0 }])
    const decision = await runPreStep()
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]!.source).toEqual({
      kind: 'plugin',
      plugin: 'instruction-hint',
      form: 'instructions',
    })
  })

  it('does not emit before the promotion signal', async () => {
    const { runPreStep } = mount([])
    const decision = await runPreStep()
    expect(decision.messages).toHaveLength(0)
  })

  it('recognizes the pre-fix instruction-hint source as already durable', async () => {
    const { runPreStep } = mount([
      { type: 'assistant/message', seq: 0 },
      { type: 'user/message', data: { source: { kind: 'instruction-hint', form: 'hint' } } },
    ])
    const decision = await runPreStep()
    expect(decision.messages).toHaveLength(0)
  })

  it('recognizes the released plugin source as already durable', async () => {
    const { runPreStep } = mount([
      { type: 'assistant/message', seq: 0 },
      {
        type: 'user/message',
        data: { source: { kind: 'plugin', plugin: 'instruction-hint', form: 'instructions' } },
      },
    ])
    const decision = await runPreStep()
    expect(decision.messages).toHaveLength(0)
  })
})
