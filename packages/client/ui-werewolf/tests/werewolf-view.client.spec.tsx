// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import {
  buildAction,
  buildSkippedAction,
  fieldChoices,
  WerewolfView,
  type WerewolfViewInjected,
} from '../src/client/WerewolfView.tsx'
import { en, zh } from '../src/client/locales.ts'
import type {
  WerewolfHumanViewV1,
  WerewolfLobbyViewV1,
  WerewolfReplayV1,
} from '@deepseek-ai/dsh-werewolf/types'

const TestView = WerewolfView as unknown as (
  props: { sessionId: string } & WerewolfViewInjected,
) => ReactElement

function lobbyFixture(): WerewolfLobbyViewV1 {
  return {
    version: 1,
    availableRuleSets: [
      { id: 'quick-7', revision: 1, displayName: 'Quick 7-player game', playerCount: 7 },
    ],
  }
}

function viewFixture(overrides: Partial<WerewolfHumanViewV1> = {}): WerewolfHumanViewV1 {
  return {
    version: 1,
    gameId: 'g1',
    gameRevision: 4,
    status: 'running',
    day: 1,
    ruleSet: { id: 'quick-7', revision: 1, displayName: 'Quick 7-player game', playerCount: 7 },
    availableRuleSets: [],
    players: [
      { playerId: 'p1', seat: 1, displayName: 'Seat 1', alive: true, human: true },
      { playerId: 'p2', seat: 2, displayName: 'Seat 2', alive: true, human: false },
      { playerId: 'p3', seat: 3, displayName: 'Seat 3', alive: false, human: false, deathDay: 1, deathCause: 'vote' },
    ],
    self: {
      playerId: 'p1',
      seat: 1,
      role: { id: 'seer', name: 'Seer', faction: 'village' },
      resources: { insight: 1 },
      teammates: [],
      notices: [],
    },
    phase: {
      phaseInstanceId: 'i1',
      phaseId: 'day.discussion',
      segment: 'day',
      day: 1,
      mode: 'seat-order-public',
      speech: {
        completed: 0,
        total: 2,
        current: { playerId: 'p1', seat: 1, displayName: 'Seat 1', human: true },
      },
    },
    actionForm: {
      phaseInstanceId: 'i1',
      phaseId: 'day.discussion',
      day: 1,
      actionKind: 'speech',
      spec: { kind: 'text', maxChars: 40, allowSkip: true },
    },
    timeline: [{ id: '0', day: 1, phaseId: 'day.announce', kind: 'announcement', key: 'announce.no-death' }],
    pauseReason: null,
    result: null,
    ...overrides,
  }
}

function replayFixture(): WerewolfReplayV1 {
  return {
    version: 1,
    gameId: 'g1',
    finalRevision: 9,
    checkpoints: [
      { eventType: 'werewolf/game-started', gameRevision: 1, view: viewFixture() },
      { eventType: 'werewolf/phase-resolved', gameRevision: 8, view: viewFixture() },
    ],
  }
}

function injected(overrides: Partial<WerewolfViewInjected> = {}): WerewolfViewInjected {
  return {
    openGame: vi.fn(),
    getLobby: vi.fn(async () => lobbyFixture()),
    start: vi.fn(async () => viewFixture()),
    getView: vi.fn(async () => viewFixture()),
    submitAction: vi.fn(async () => viewFixture()),
    resume: vi.fn(async () => viewFixture()),
    abortGame: vi.fn(async () => viewFixture({ status: 'ended', result: { outcome: { kind: 'aborted' }, evidence: [{ source: 'human-abort', data: {} }] } })),
    getReplay: vi.fn(async () => replayFixture()),
    subscribeInvalidated: vi.fn(() => () => {}),
    translate: (key, params) => {
      const template = zh[key]
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
    },
    ...overrides,
  }
}

/** Walk lobby → covered reveal by starting the fixture game. */
async function arriveAtReveal(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await waitFor(() => view.getByRole('button', { name: zh['lobby.start'] })))
  await waitFor(() =>{  expect(view.getByTestId('werewolf-reveal')).toBeDefined() })
}

/** Walk lobby → start → whatever the start projection renders. */
async function arriveByStart(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await waitFor(() => view.getByRole('button', { name: zh['lobby.start'] })))
}

/** Walk lobby → reveal → table. */
async function arriveAtTable(view: ReturnType<typeof render>): Promise<void> {
  await arriveAtReveal(view)
  fireEvent.click(view.getByRole('button', { name: zh['reveal.action'] }))
  fireEvent.click(view.getByRole('button', { name: zh['reveal.ready'] }))
  await waitFor(() =>{  expect(view.getByTestId('werewolf-table')).toBeDefined() })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WerewolfView states', () => {
  it('renders the lobby with one rule-set card and starts through the typed verb', async () => {
    const face = injected()
    const view = render(<TestView sessionId="s1" {...face} />)
    await waitFor(() =>{  expect((view.getByRole('button', { name: zh['lobby.start'] }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(view.getByRole('button', { name: zh['lobby.start'] }))
    await waitFor(() =>{  expect(face.start).toHaveBeenCalledTimes(1) })
    const request = ((face.start as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as {
      ruleSetId: string
      ruleSetRevision: number
      seed: number
    }
    expect(request.ruleSetId).toBe('quick-7')
    expect(request.ruleSetRevision).toBe(1)
    expect(Number.isSafeInteger(request.seed)).toBe(true)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-reveal')).toBeDefined() })
  })

  it('surfaces a lobby load failure as a retryable error', async () => {
    const getLobby = vi.fn()
      .mockRejectedValueOnce(new Error('catalog down'))
      .mockResolvedValueOnce(lobbyFixture())
    const view = render(<TestView sessionId="s1" {...injected({ getLobby })} />)
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain('catalog down')
    fireEvent.click(view.getByRole('button', { name: zh['error.retry'] }))
    await waitFor(() =>{  expect(getLobby).toHaveBeenCalledTimes(2) })
    await waitFor(() =>{  expect(view.getByRole('button', { name: zh['lobby.start'] })).toBeDefined() })
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('restores an existing game directly from its Host Session', async () => {
    const face = injected({ initialGameId: 'g1' })
    const view = render(<TestView sessionId="game-g1" {...face} />)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-reveal')).toBeDefined() })
    expect(face.getView).toHaveBeenCalledWith('g1')
    expect(face.getLobby).not.toHaveBeenCalled()
    expect(face.start).not.toHaveBeenCalled()
  })

  it('fills template params and falls back to the raw key on a missing param', () => {
    const face = injected()
    expect(face.translate('lobby.players', { count: 7 })).toBe('7 名玩家')
    expect(face.translate('table.day', { day: 2 })).toBe('第 2 天')
  })

  it('reports an empty lobby without a start action', async () => {
    const view = render(<TestView sessionId="s1" {...injected({ getLobby: async () => ({ version: 1, availableRuleSets: [] }) })} />)
    await waitFor(() =>{  expect(view.getByText(zh['lobby.unavailable'])).toBeDefined() })
  })

  it('keeps the role covered behind an explicit reveal, then enters the table', async () => {
    const view = render(<TestView sessionId="s1" {...injected({ getLobby: async () => lobbyFixture() })} />)
    await arriveAtReveal(view)
    expect(view.queryByText('Seer')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['reveal.action'] }))
    expect(view.getByText('Seer')).toBeDefined()
    expect(view.queryByTestId('werewolf-table')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['reveal.ready'] }))
    await waitFor(() =>{  expect(view.getByTestId('werewolf-table')).toBeDefined() })
  })

  it('renders seats with non-color state cues and a sticky phase heading', async () => {
    const view = render(<TestView sessionId="s1" {...injected({ getLobby: async () => lobbyFixture() })} />)
    await arriveAtTable(view)
    const table = view.getByTestId('werewolf-table')
    expect(table.getAttribute('aria-label')).toBe(zh['table.title'])
    expect(table.textContent).toContain(zh['table.dead'])
    expect(table.textContent).toContain(zh['table.deadOn'].replace('{day}', '1'))
    expect(table.textContent).toContain(zh['table.knownNone'])
    expect(table.querySelector('[data-sigil="sigil-01.png"]')).not.toBeNull()
    expect(table.querySelector('[data-sigil="sigil-02.png"]')).not.toBeNull()
    const heading = table.querySelector('h2')
    expect(heading?.getAttribute('tabindex')).toBe('-1')
  })

  it('shows ordered speaking progress and readable statements before voting', async () => {
    const speaking = viewFixture({
      phase: {
        phaseInstanceId: 'i1',
        phaseId: 'day.discussion',
        segment: 'day',
        day: 1,
        mode: 'seat-order-public',
        speech: {
          completed: 1,
          total: 2,
          current: { playerId: 'p1', seat: 1, displayName: 'Seat 1', human: true },
        },
      },
      timeline: [
        {
          id: 'speech-1',
          day: 1,
          phaseId: 'day.discussion',
          kind: 'speech',
          key: 'speech',
          actorId: 'p2' as NonNullable<WerewolfHumanViewV1['timeline'][number]['actorId']>,
          data: { text: '我先听一轮，再判断谁的逻辑有问题。' },
        },
        {
          id: 'speech-pass',
          day: 1,
          phaseId: 'day.discussion',
          kind: 'speech',
          key: 'speech.pass',
          actorId: 'p3' as NonNullable<WerewolfHumanViewV1['timeline'][number]['actorId']>,
        },
      ],
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => speaking, getView: async () => speaking })} />)
    await arriveAtTable(view)
    const flow = view.getByTestId('werewolf-speech-flow')
    expect(flow.textContent).toContain('已完成 1 / 2 位发言')
    expect(flow.textContent).toContain(zh['flow.yourTurn'])
    expect(flow.textContent).toContain(zh['flow.afterSpeeches'])
    expect(view.getByText('2 号位 · Seat 2')).toBeDefined()
    expect(view.getByText('我先听一轮，再判断谁的逻辑有问题。')).toBeDefined()
    expect(view.getByText(zh['timeline.pass'])).toBeDefined()
  })

  it('submits a text speech through the typed action verb', async () => {
    const face = injected()
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const form = view.getByTestId('werewolf-action-form')
    fireEvent.change(form.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '我是好人' } })
    fireEvent.click(view.getByRole('button', { name: zh['speech.speak'] }))
    await waitFor(() =>{  expect(face.submitAction).toHaveBeenCalledTimes(1) })
    const request = ((face.submitAction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { action: { value: unknown } }
    expect(request.action.value).toBe('我是好人')
  })

  it('selects a vote target with an explicit confirm and a pass label', async () => {
    const face = injected()
    const target = viewFixture({
      actionForm: {
        phaseInstanceId: 'i1',
        phaseId: 'day.vote',
        day: 1,
        actionKind: 'vote',
        spec: { kind: 'player-target', targets: ['p2'], allowSkip: true },
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ ...face, getView: async () => target, start: async () => target })} />)
    await arriveAtTable(view)
    const form = view.getByTestId('werewolf-action-form')
    const option = form.querySelector('[role="radio"]') as HTMLElement
    expect(option.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(option)
    expect(option.getAttribute('aria-checked')).toBe('true')
    expect(form.textContent).toContain(zh['vote.selected'].replace('{name}', '2 · Seat 2'))
    fireEvent.click(view.getByRole('button', { name: zh['vote.confirm'] }))
    await waitFor(() =>{  expect(face.submitAction).toHaveBeenCalledTimes(1) })
    const request = ((face.submitAction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { action: { value: unknown } }
    expect(request.action.value).toBe('p2')
  })

  it('labels the spectator state when the human is dead', async () => {
    const dead = viewFixture({
      players: [
        { playerId: 'p1', seat: 1, displayName: 'Seat 1', alive: false, human: true, deathDay: 1, deathCause: 'wolf-kill' },
        { playerId: 'p2', seat: 2, displayName: 'Seat 2', alive: true, human: false },
      ],
      actionForm: null,
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => dead })} />)
    await arriveAtTable(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-spectator')).toBeDefined() })
    expect(view.queryByTestId('werewolf-action-form')).toBeNull()
  })

  it('offers resume and confirm-guarded abort while paused', async () => {
    const paused = viewFixture({ status: 'paused', pauseReason: 'bot-failure', actionForm: null })
    const face = injected({ start: async () => paused })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const panel = await waitFor(() => view.getByTestId('werewolf-paused'))
    expect(panel.textContent).toContain(zh['paused.reason'].replace('{reason}', 'bot-failure'))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(view.getByRole('button', { name: zh['paused.abort'] }))
    expect(confirmSpy).toHaveBeenCalledWith(zh['paused.confirmAbort'])
    await waitFor(() =>{  expect(face.abortGame).toHaveBeenCalledTimes(1) })
    const resumingFace = injected({ start: async () => paused })
    const resuming = render(<TestView sessionId="s1" {...resumingFace} />)
    await arriveAtTable(resuming)
    fireEvent.click(await waitFor(() => resuming.getByRole('button', { name: zh['paused.resume'] })))
    await waitFor(() =>{  expect(resumingFace.resume).toHaveBeenCalledTimes(1) })
  })

  it('declines abort when the confirm is dismissed', async () => {
    const paused = viewFixture({ status: 'paused', pauseReason: 'cancelled', actionForm: null })
    const face = injected({ start: async () => paused })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    await waitFor(() => view.getByTestId('werewolf-paused'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(view.getByRole('button', { name: zh['paused.abort'] }))
    expect(face.abortGame).not.toHaveBeenCalled()
  })

  it('reveals every role at the result and pages the authorized replay', async () => {
    const ended = viewFixture({
      status: 'ended',
      phase: null,
      actionForm: null,
      result: { outcome: { kind: 'faction', factionId: 'village' }, evidence: [] },
      players: [
        { playerId: 'p1', seat: 1, displayName: 'Seat 1', alive: true, human: true, revealedRole: { id: 'seer', name: 'Seer', faction: 'village' } },
        { playerId: 'p2', seat: 2, displayName: 'Seat 2', alive: false, human: false, revealedRole: { id: 'wolf', name: 'Wolf', faction: 'wolf' } },
      ],
    })
    const face = injected({ start: async () => ended })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveByStart(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-result')).toBeDefined() })
    expect(view.getByText(zh['result.village'])).toBeDefined()
    expect(view.getByText(content => content.includes('Seer')).textContent).toContain('Seat 1')
    expect(view.getByText(content => content.includes('Wolf')).textContent).toContain('Seat 2')
    fireEvent.click(view.getByRole('button', { name: zh['result.review'] }))
    await waitFor(() =>{  expect(face.getReplay).toHaveBeenCalledWith('g1') })
    expect(view.getByTestId('werewolf-replay').textContent).toContain('8')
    fireEvent.click(view.getByRole('button', { name: zh['replay.close'] }))
    expect(view.queryByTestId('werewolf-replay')).toBeNull()
  })

  it('returns to the lobby from the result without keeping game state', async () => {
    const ended = viewFixture({ status: 'ended', phase: null, actionForm: null, result: { outcome: { kind: 'tie' }, evidence: [] } })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => ended })} />)
    await arriveByStart(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-result')).toBeDefined() })
    fireEvent.click(view.getByRole('button', { name: zh['result.newGame'] }))
    await waitFor(() =>{  expect(view.getByTestId('werewolf-lobby')).toBeDefined() })
    await waitFor(() =>{  expect(view.getByRole('button', { name: zh['lobby.start'] })).toBeDefined() })
  })

  it('refreshes through getView when its own game is invalidated and ignores other games', async () => {
    let listener: ((gameId: string) => void) | undefined
    const face = injected({
      subscribeInvalidated: (hook) => {
        listener = hook
        return () => { listener = undefined }
      },
    })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-table')).toBeDefined() })
    ;(face.getView as ReturnType<typeof vi.fn>).mockClear()
    listener?.('other-game')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(face.getView).not.toHaveBeenCalled()
    listener?.('g1')
    await waitFor(() =>{  expect(face.getView).toHaveBeenCalledWith('g1') })
  })

  it('ignores an older invalidation response and preserves the current draft', async () => {
    let listener: ((gameId: string) => void) | undefined
    const getView = vi.fn(async () => viewFixture({ gameRevision: 3, day: 9 }))
    const face = injected({
      getView,
      subscribeInvalidated: (hook) => {
        listener = hook
        return () => { listener = undefined }
      },
    })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const textarea = view.getByTestId('werewolf-action-form').querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '保留这段发言' } })
    listener?.('g1')
    await waitFor(() =>{  expect(getView).toHaveBeenCalledWith('g1') })
    expect(view.getByTestId('werewolf-table').querySelector('h2')?.textContent).toContain('1')
    expect(textarea.value).toBe('保留这段发言')
  })

  it('moves focus to the phase heading after a newer phase arrives', async () => {
    let listener: ((gameId: string) => void) | undefined
    const next = viewFixture({
      gameRevision: 5,
      day: 2,
      phase: { phaseInstanceId: 'i2', phaseId: 'day.vote', segment: 'day', day: 2, mode: 'parallel-private', speech: null },
      actionForm: null,
    })
    const face = injected({
      getView: vi.fn(async () => next),
      subscribeInvalidated: (hook) => {
        listener = hook
        return () => { listener = undefined }
      },
    })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    listener?.('g1')
    const heading = await waitFor(() => {
      const candidate = view.getByTestId('werewolf-table').querySelector('h2') as HTMLHeadingElement
      expect(candidate.textContent).toContain('2')
      return candidate
    })
    expect(document.activeElement).toBe(heading)
  })

  it('shows a retryable inline error when a mutation fails', async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new Error('seed rejected'))
      .mockResolvedValueOnce(viewFixture())
    const face = injected({
      start,
    })
    const view = render(<TestView sessionId="s1" {...face} />)
    fireEvent.click(await waitFor(() => view.getByRole('button', { name: zh['lobby.start'] })))
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain(zh['error.title'])
    const firstRequest = start.mock.calls[0]?.[0] as unknown
    fireEvent.click(view.getByRole('button', { name: zh['error.retry'] }))
    await waitFor(() =>{  expect(start).toHaveBeenCalledTimes(2) })
    expect(start.mock.calls[1]?.[0] as unknown).toEqual(firstRequest)
    await waitFor(() =>{  expect(view.queryByRole('alert')).toBeNull() })
    expect(face.openGame).toHaveBeenCalledWith('g1')
  })

  it('renders every English key', () => {
    for (const value of Object.values(en)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
    expect(Object.keys(en).length).toBe(Object.keys(zh).length)
  })
})

describe('buildAction', () => {
  it('wraps single specs in a value object', () => {
    expect(buildAction({ kind: 'player-target', targets: ['p2'], allowSkip: true }, {}, { value: 'p2' }))
      .toEqual({ value: 'p2' })
    expect(buildAction({ kind: 'player-target', targets: ['p2'], allowSkip: true }, {}, {}))
      .toEqual({ value: null })
  })

  it('trims and bounds text drafts', () => {
    expect(buildAction({ kind: 'text', maxChars: 4, allowSkip: false }, { value: '  hello  ' }, {}))
      .toEqual({ value: 'hell' })
    expect(buildAction({ kind: 'text', maxChars: 4, allowSkip: true }, { value: '   ' }, {}))
      .toEqual({ value: null })
  })

  it('builds compound actions field by field', () => {
    expect(buildAction(
      {
        kind: 'compound',
        fields: [
          { id: 'antidote', spec: { kind: 'choice', options: ['use', 'skip'], allowSkip: false } },
          { id: 'poison', spec: { kind: 'player-target', targets: ['p3'], allowSkip: true } },
        ],
        allowSkip: false,
      },
      {},
      { antidote: 'use', poison: 'p3' },
    )).toEqual({ antidote: 'use', poison: 'p3' })
  })

  it('keeps compound text fields independent', () => {
    expect(buildAction(
      {
        kind: 'compound',
        fields: [
          { id: 'claim', spec: { kind: 'text', maxChars: 20, allowSkip: false } },
          { id: 'lastWords', spec: { kind: 'text', maxChars: 20, allowSkip: false } },
        ],
        allowSkip: false,
      },
      { claim: '预言家', lastWords: '查验 2 号' },
      {},
    )).toEqual({ claim: '预言家', lastWords: '查验 2 号' })
  })

  it('builds explicit null actions for single and compound skips', () => {
    expect(buildSkippedAction({ kind: 'text', maxChars: 4, allowSkip: true }))
      .toEqual({ value: null })
    expect(buildSkippedAction({
      kind: 'compound',
      fields: [
        { id: 'antidote', spec: { kind: 'choice', options: ['use'], allowSkip: true } },
        { id: 'poison', spec: { kind: 'player-target', targets: ['p2'], allowSkip: true } },
      ],
      allowSkip: true,
    })).toEqual({ antidote: null, poison: null })
  })
})

describe('WerewolfView display sides', () => {
  it('covers the wolf-win outcome and the eliminated self summary', async () => {
    const ended = viewFixture({
      status: 'ended',
      phase: null,
      actionForm: null,
      result: { outcome: { kind: 'faction', factionId: 'wolf' }, evidence: [] },
      players: [
        { playerId: 'p1', seat: 1, displayName: 'Seat 1', alive: false, human: true, deathDay: 2, deathCause: 'vote' },
        { playerId: 'p2', seat: 2, displayName: 'Seat 2', alive: true, human: false, revealedRole: { id: 'wolf', name: 'Wolf', faction: 'wolf' } },
      ],
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => ended })} />)
    await arriveByStart(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-result')).toBeDefined() })
    expect(view.getByText(zh['result.wolf'])).toBeDefined()
    expect(view.getByText(zh['result.summary'].replace('{outcome}', zh['result.eliminated']))).toBeDefined()
  })

  it('renders an empty-message lobby error without a colon suffix', async () => {
    const view = render(<TestView sessionId="s1" {...injected({ getLobby: async () => { throw new Error('') } })} />)
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain(zh['error.title'])
    expect(view.getByRole('alert').textContent).not.toContain(':')
  })

  it('renders the result alert with an empty message as bare title', async () => {
    const ended = viewFixture({ status: 'ended', phase: null, actionForm: null, result: { outcome: { kind: 'tie' }, evidence: [] } })
    const face = injected({ start: async () => ended, getReplay: async () => { throw new Error('') } })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveByStart(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-result')).toBeDefined() })
    fireEvent.click(view.getByRole('button', { name: zh['result.review'] }))
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain(zh['error.title'])
    expect(view.getByRole('button', { name: zh['error.retry'] })).toBeDefined()
  })

  it('reports a replay failure on the result panel without opening the review', async () => {
    const ended = viewFixture({
      status: 'ended',
      phase: null,
      actionForm: null,
      result: { outcome: { kind: 'tie' }, evidence: [] },
    })
    const view = render(<TestView sessionId="s1" {...injected({
      start: async () => ended,
      getReplay: async () => { throw new Error('replay denied') },
    })} />)
    await arriveByStart(view)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-result')).toBeDefined() })
    fireEvent.click(view.getByRole('button', { name: zh['result.review'] }))
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain('replay denied')
    expect(view.getByRole('alert').textContent).toContain(zh['error.title'])
    expect(view.queryByTestId('werewolf-replay')).toBeNull()
  })

  it('lists teammates by name with a seat fallback for departed rosters', async () => {
    const pack = viewFixture({
      self: {
        playerId: 'p1',
        seat: 1,
        role: { id: 'wolf', name: 'Wolf', faction: 'wolf' },
        resources: {},
        teammates: [
          { playerId: 'p2', seat: 2, alive: true },
          { playerId: 'px', seat: 9, alive: false },
        ],
        notices: [],
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => pack })} />)
    await arriveAtReveal(view)
    fireEvent.click(view.getByRole('button', { name: zh['reveal.action'] }))
    expect(view.getByText(zh['reveal.teammates'].replace('{names}', 'Seat 2, 9'))).toBeDefined()
    expect(view.getByText(zh['reveal.faction'].replace('{faction}', 'wolf'))).toBeDefined()
    expect(view.queryByText(zh['reveal.resources'])).toBeNull()
  })

  it('renders a phase-less table with an empty timeline, un-dated deaths, and notices', async () => {
    const sparse = viewFixture({
      phase: null,
      timeline: [],
      players: [
        { playerId: 'p1', seat: 1, displayName: 'Seat 1', alive: true, human: true },
        { playerId: 'p2', seat: 2, displayName: 'Seat 2', alive: false, human: false },
      ],
      self: { ...viewFixture().self, notices: [{ kind: 'checked', data: {} }] },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => sparse })} />)
    await arriveAtTable(view)
    const heading = view.getByTestId('werewolf-table').querySelector('h2')
    expect(heading?.textContent).toContain(zh['table.day'].replace('{day}', '1'))
    expect(heading?.textContent).toContain(zh['table.empty'])
    expect(view.getByText(zh['table.empty'])).toBeDefined()
    expect(view.getByText(zh['table.dead'])).toBeDefined()
    expect(view.getByText('checked')).toBeDefined()
  })

  it('treats a roster without a human seat as still playing', async () => {
    const bots = viewFixture({
      players: [{ playerId: 'p2', seat: 2, displayName: 'Seat 2', alive: true, human: false }],
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => bots })} />)
    await arriveAtTable(view)
    expect(view.queryByTestId('werewolf-spectator')).toBeNull()
    expect(view.getByTestId('werewolf-action-form')).toBeDefined()
  })

  it('renders a paused game without a pause reason', async () => {
    const paused = viewFixture({ status: 'paused', pauseReason: null, actionForm: null })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => paused })} />)
    await arriveAtTable(view)
    const panel = await waitFor(() => view.getByTestId('werewolf-paused'))
    expect(panel.textContent).toContain(zh['paused.reason'].replace('{reason}', ''))
  })

  it('keeps an unmatched template placeholder visible in the translation', async () => {
    const face = injected({
      translate: key => key === 'table.day' ? '第 {day} 天（{ghost}）' : zh[key],
    })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const heading = view.getByTestId('werewolf-table').querySelector('h2')
    expect(heading?.textContent).toContain('第 1 天（{ghost}）')
  })

  it('maps seats to stable sigils and marks known seats from notices', async () => {
    const known = viewFixture({
      players: Array.from({ length: 7 }, (_, index) => ({
        playerId: `p${index + 1}`,
        seat: index + 1,
        displayName: `Seat ${index + 1}`,
        alive: true,
        human: index === 0,
      })),
      self: {
        ...viewFixture().self,
        notices: [{ kind: 'seer-inspect', data: { target: 'p2', faction: 'village', day: 1 } }],
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => known })} />)
    await arriveAtTable(view)
    for (let seat = 1; seat <= 7; seat += 1) {
      expect(view.getByAltText(zh['table.seat'].replace('{seat}', String(seat))).getAttribute('data-sigil')).toBe(`sigil-0${seat}.png`)
    }
    expect(view.getByRole('button', { name: zh['table.openFinding'] })).toBeDefined()
    expect(view.getByTestId('werewolf-table').textContent).toContain(`(${zh['table.you']})`)
  })

  it('opens a finding detail, switches between notices, and returns to identity', async () => {
    const noticed = viewFixture({
      self: {
        ...viewFixture().self,
        notices: [
          { kind: 'seer-inspect', data: { target: 'p2', faction: 'village', day: 1 } },
          { kind: 'seer-inspect', data: { target: 'p3', faction: 'wolf', day: 2 } },
        ],
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => noticed })} />)
    await arriveAtTable(view)
    fireEvent.click(view.getAllByRole('button', { name: zh['table.openFinding'] })[0]!)
    const detail = await waitFor(() => view.getByTestId('werewolf-finding'))
    expect(detail.textContent).toContain(zh['finding.scope'])
    expect(detail.textContent).toContain('Seat 2')
    expect(detail.textContent).toContain(zh['finding.factionVillage'])
    expect(detail.textContent).toContain(zh['finding.when'])
    expect(detail.textContent).toContain(zh['finding.day'].replace('{day}', '1'))
    const nav = detail.querySelectorAll('[aria-current="true"]')
    expect(nav).toHaveLength(1)
    fireEvent.click(view.getAllByRole('button', { name: zh['finding.seer'] })[1]!)
    await waitFor(() =>{  expect(view.getByTestId('werewolf-finding').textContent).toContain('Seat 3') })
    expect(view.getByTestId('werewolf-finding').textContent).toContain(zh['finding.factionWolf'])
    fireEvent.click(view.getByRole('button', { name: zh['finding.back'] }))
    await waitFor(() =>{  expect(view.queryByTestId('werewolf-finding')).toBeNull() })
    expect(view.getByText(zh['table.role'])).toBeDefined()
  })

  it('renders generic notices with a safe key-value fallback and keeps unmapped ones', async () => {
    const generic = viewFixture({
      self: {
        ...viewFixture().self,
        notices: [
          { kind: 'configured-result', data: { victim: 'p9', count: 2 } },
          { kind: 'checked', data: {} },
        ],
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => generic })} />)
    await arriveAtTable(view)
    fireEvent.click(view.getByRole('button', { name: 'configured-result' }))
    const detail = await waitFor(() => view.getByTestId('werewolf-finding'))
    expect(detail.textContent).toContain('victim')
    expect(detail.textContent).toContain('p9')
    expect(detail.textContent).toContain('count')
    expect(detail.querySelectorAll('li button')).toHaveLength(2)
  })

  it('renders the built-in wolf result as a player label with its source day', async () => {
    const noticed = viewFixture({
      self: {
        ...viewFixture().self,
        notices: [{ kind: 'wolf-kill-result', data: { victim: 'p2', day: 1 } }],
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => noticed })} />)
    await arriveAtTable(view)
    fireEvent.click(view.getByRole('button', { name: zh['finding.wolfKill'] }))
    const detail = await waitFor(() => view.getByTestId('werewolf-finding'))
    expect(detail.textContent).toContain(zh['finding.victim'])
    expect(detail.textContent).toContain('2 号位·Seat 2')
    expect(detail.textContent).toContain(zh['finding.day'].replace('{day}', '1'))
  })
})

describe('WerewolfView mutation feedback', () => {
  it('marks the table busy while a submit is pending and clears it after', async () => {
    let release: (value: WerewolfHumanViewV1) => void = () => {}
    const pending = new Promise<WerewolfHumanViewV1>((resolve) => { release = resolve })
    const face = injected({ submitAction: vi.fn(() => pending) })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    fireEvent.change(
      view.getByTestId('werewolf-action-form').querySelector('textarea') as HTMLTextAreaElement,
      { target: { value: '我是预言家' } },
    )
    fireEvent.click(view.getByRole('button', { name: zh['speech.speak'] }))
    await waitFor(() =>{  expect(view.getByText(zh['busy.label'])).toBeDefined() })
    release(viewFixture())
    await waitFor(() =>{  expect(view.queryByText(zh['busy.label'])).toBeNull() })
  })

  it('surfaces a failing table mutation and retries the same request', async () => {
    const submitAction = vi.fn()
      .mockRejectedValueOnce(new Error('stale revision'))
      .mockResolvedValueOnce(viewFixture({ gameRevision: 5 }))
    const face = injected({ submitAction })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    fireEvent.change(
      view.getByTestId('werewolf-action-form').querySelector('textarea') as HTMLTextAreaElement,
      { target: { value: '我是好人' } },
    )
    fireEvent.click(view.getByRole('button', { name: zh['speech.speak'] }))
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain(': stale revision')
    const firstRequest = submitAction.mock.calls[0]?.[0] as unknown
    fireEvent.click(view.getByRole('button', { name: zh['error.retry'] }))
    await waitFor(() =>{  expect(submitAction).toHaveBeenCalledTimes(2) })
    expect(submitAction.mock.calls[1]?.[0] as unknown).toEqual(firstRequest)
    await waitFor(() =>{  expect(view.queryByRole('alert')).toBeNull() })
  })

  it('renders an empty mutation message without a colon at the table', async () => {
    const face = injected({ submitAction: vi.fn(async () => { throw new Error('') }) })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    fireEvent.change(
      view.getByTestId('werewolf-action-form').querySelector('textarea') as HTMLTextAreaElement,
      { target: { value: '我是好人' } },
    )
    fireEvent.click(view.getByRole('button', { name: zh['speech.speak'] }))
    await waitFor(() =>{  expect(view.getByRole('alert')).toBeDefined() })
    expect(view.getByRole('alert').textContent).toContain(zh['error.title'])
    expect(view.getByRole('alert').textContent).not.toContain(':')
  })
})

describe('WerewolfView action-form gates', () => {
  it('requires a vote target when skipping is disallowed and toggles the selection off', async () => {
    const target = viewFixture({
      actionForm: {
        phaseInstanceId: 'i1',
        phaseId: 'day.vote',
        day: 1,
        actionKind: 'vote',
        spec: { kind: 'player-target', targets: ['p2'], allowSkip: false },
      },
    })
    const face = injected({ start: async () => target, getView: async () => target })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const form = view.getByTestId('werewolf-action-form')
    const confirm = view.getByRole('button', { name: zh['vote.confirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.submit(form)
    expect(face.submitAction).not.toHaveBeenCalled()
    const option = form.querySelector('[role="radio"]') as HTMLElement
    fireEvent.click(option)
    expect(confirm.disabled).toBe(false)
    expect(form.textContent).toContain(zh['vote.selected'].replace('{name}', '2 · Seat 2'))
    fireEvent.click(option)
    expect(option.getAttribute('aria-checked')).toBe('false')
    expect(confirm.disabled).toBe(true)
    expect(view.queryByTestId('werewolf-selected-target')).toBeNull()
  })

  it('supports arrow-key selection and Escape clearing in target choices', async () => {
    const target = viewFixture({
      actionForm: {
        phaseInstanceId: 'i1',
        phaseId: 'day.vote',
        day: 1,
        actionKind: 'vote',
        spec: { kind: 'player-target', targets: ['p2', 'p3'], allowSkip: true },
      },
    })
    const view = render(<TestView sessionId="s1" {...injected({ start: async () => target, getView: async () => target })} />)
    await arriveAtTable(view)
    const choices = [...view.getByTestId('werewolf-action-form').querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    choices[0]?.focus()
    fireEvent.keyDown(choices[0]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(choices[1])
    expect(choices[1]?.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(choices[1]!, { key: 'Escape' })
    expect(choices[1]?.getAttribute('aria-checked')).toBe('false')
  })

  it('requires speech text when skipping is disallowed and trims on submit', async () => {
    const speech = viewFixture({
      actionForm: {
        phaseInstanceId: 'i1',
        phaseId: 'day.discussion',
        day: 1,
        actionKind: 'speech',
        spec: { kind: 'text', maxChars: 40, allowSkip: false },
      },
    })
    const face = injected({ start: async () => speech, getView: async () => speech })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const speak = view.getByRole('button', { name: zh['speech.speak'] }) as HTMLButtonElement
    expect(speak.disabled).toBe(true)
    expect(view.queryByRole('button', { name: zh['speech.pass'] })).toBeNull()
    fireEvent.change(
      view.getByTestId('werewolf-action-form').querySelector('textarea') as HTMLTextAreaElement,
      { target: { value: '  我是守卫  ' } },
    )
    expect(speak.disabled).toBe(false)
    fireEvent.click(speak)
    await waitFor(() =>{  expect(face.submitAction).toHaveBeenCalledTimes(1) })
    const request = ((face.submitAction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { action: { value: unknown } }
    expect(request.action.value).toBe('我是守卫')
  })

  it('submits an explicit null action through the speech pass button', async () => {
    const face = injected()
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const form = view.getByTestId('werewolf-action-form')
    const textarea = form.querySelector('textarea') as HTMLTextAreaElement
    const pass = view.getByRole('button', { name: zh['speech.pass'] })
    expect(pass.getAttribute('title')).toBe(zh['action.passLabel'])
    fireEvent.change(textarea, { target: { value: '过' } })
    fireEvent.click(pass)
    await waitFor(() =>{  expect(face.submitAction).toHaveBeenCalledTimes(1) })
    const request = ((face.submitAction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { action: unknown }
    expect(request.action).toEqual({ value: null })
  })

  it('submits an explicit null action through the vote abstain button', async () => {
    const target = viewFixture({
      actionForm: {
        phaseInstanceId: 'i1',
        phaseId: 'day.vote',
        day: 1,
        actionKind: 'vote',
        spec: { kind: 'player-target', targets: ['p2'], allowSkip: true },
      },
    })
    const face = injected({ start: async () => target, getView: async () => target })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const form = view.getByTestId('werewolf-action-form')
    const option = form.querySelector('[role="radio"]') as HTMLElement
    fireEvent.click(option)
    expect(view.getByTestId('werewolf-selected-target')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: zh['vote.abstain'] }))
    await waitFor(() =>{  expect(face.submitAction).toHaveBeenCalledTimes(1) })
    const request = ((face.submitAction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { action: unknown }
    expect(request.action).toEqual({ value: null })
  })

  it('builds compound actions mixing a text field and a target', async () => {
    const compound = viewFixture({
      actionForm: {
        phaseInstanceId: 'i1',
        phaseId: 'night.guard',
        day: 1,
        actionKind: 'act',
        spec: {
          kind: 'compound',
          fields: [
            { id: 'speech', spec: { kind: 'text', maxChars: 30, allowSkip: false } },
            { id: 'target', spec: { kind: 'player-target', targets: ['p2'], allowSkip: false } },
          ],
          allowSkip: false,
        },
      },
    })
    const face = injected({ start: async () => compound, getView: async () => compound })
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const form = view.getByTestId('werewolf-action-form')
    const submit = view.getByRole('button', { name: zh['action.submit'] }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(form.querySelector('[role="radio"]') as HTMLElement)
    expect(submit.disabled).toBe(true)
    fireEvent.change(form.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '守护 2 号' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() =>{  expect(face.submitAction).toHaveBeenCalledTimes(1) })
    const request = ((face.submitAction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { action: Record<string, unknown> }
    expect(request.action).toEqual({ speech: '守护 2 号', target: 'p2' })
  })
})

describe('fieldChoices', () => {
  it('labels every authoritative target by seat, including dead seats', () => {
    const choices = fieldChoices(
      { kind: 'player-target', targets: ['p2', 'p3'], allowSkip: false },
      viewFixture().players,
    )
    expect(choices[0]).toMatchObject({ id: 'p2', label: '2 · Seat 2' })
    expect(choices[1]).toEqual({ id: 'p3', label: '3 · Seat 3' })
  })

  it('falls back to the raw target id for a player no longer seated', () => {
    expect(fieldChoices(
      { kind: 'player-target', targets: ['ghost'], allowSkip: false },
      viewFixture().players,
    )).toEqual([{ id: 'ghost', label: 'ghost' }])
  })

  it('lists choice options verbatim and nothing for text', () => {
    expect(fieldChoices({ kind: 'choice', options: ['use'], allowSkip: false }, []))
      .toEqual([{ id: 'use', label: 'use' }])
    expect(fieldChoices({ kind: 'text', maxChars: 5, allowSkip: false }, [])).toEqual([])
  })
})
