// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { WerewolfView, type WerewolfViewInjected } from '../src/client/WerewolfView.tsx'
import { zh } from '../src/client/locales.ts'
import type { WerewolfHumanViewV1 } from '@deepseek-ai/dsh-werewolf/types'

const TestView = WerewolfView as unknown as (
  props: { sessionId: string } & WerewolfViewInjected,
) => ReactElement

function tableFixture(): WerewolfHumanViewV1 {
  return {
    version: 1,
    gameId: 'g1',
    gameRevision: 3,
    status: 'running',
    day: 2,
    ruleSet: { id: 'quick-7', revision: 1, displayName: 'Quick 7-player game', playerCount: 7 },
    availableRuleSets: [],
    players: Array.from({ length: 7 }, (_, index) => ({
      playerId: `p${index + 1}`,
      seat: index + 1,
      displayName: `Seat ${index + 1}`,
      alive: index !== 4,
      human: index === 0,
      ...(index === 4 ? { deathDay: 1, deathCause: 'wolf-kill' as const } : {}),
    })),
    self: {
      playerId: 'p1',
      seat: 1,
      role: { id: 'witch', name: 'Witch', faction: 'village' },
      resources: { antidote: 1, poison: 1 },
      teammates: [],
      notices: [],
    },
    phase: { phaseInstanceId: 'i1', phaseId: 'night.witch', segment: 'night', day: 2, mode: 'parallel-private' },
    actionForm: {
      phaseInstanceId: 'i1',
      phaseId: 'night.witch',
      day: 2,
      actionKind: 'act',
      spec: {
        kind: 'compound',
        fields: [
          { id: 'antidote', spec: { kind: 'choice', options: ['use', 'skip'], allowSkip: false } },
          { id: 'poison', spec: { kind: 'player-target', targets: ['p2', 'p3', 'p5'], allowSkip: true } },
        ],
        allowSkip: false,
      },
    },
    timeline: [
      { id: '0', day: 1, phaseId: 'day.announce', kind: 'announcement', key: 'announce.death' },
      { id: '1', day: 1, phaseId: 'day.vote', kind: 'vote', key: 'vote.cast' },
    ],
    pauseReason: null,
    result: null,
  }
}

const face: WerewolfViewInjected = {
  openGame: () => {},
  getLobby: async () => ({ version: 1, availableRuleSets: [{ id: 'quick-7', revision: 1, displayName: 'Quick 7-player game', playerCount: 7 }] }),
  start: async () => tableFixture(),
  getView: async () => tableFixture(),
  submitAction: async () => tableFixture(),
  resume: async () => tableFixture(),
  abortGame: async () => tableFixture(),
  getReplay: async () => ({ version: 1, gameId: 'g1', finalRevision: 1, checkpoints: [] }),
  subscribeInvalidated: () => () => {},
  translate: key => zh[key],
}

/** Walk lobby → reveal → table for the snapshot fixtures. */
async function arriveAtTable(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await waitFor(() => view.getByRole('button', { name: zh['lobby.start'] })))
  await waitFor(() =>{  expect(view.getByTestId('werewolf-reveal')).toBeDefined() })
  fireEvent.click(view.getByRole('button', { name: zh['reveal.action'] }))
  fireEvent.click(view.getByRole('button', { name: zh['reveal.ready'] }))
  await waitFor(() =>{  expect(view.getByTestId('werewolf-table')).toBeDefined() })
}

afterEach(() => {
  cleanup()
})

describe('WerewolfView responsive snapshots', () => {
  it('matches the desktop layout snapshot at 1280px', async () => {
    window.innerWidth = 1280
    window.innerHeight = 800
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    expect(view.getByTestId('werewolf-table')).toMatchSnapshot()
  })

  it('matches the tablet layout snapshot at 820px', async () => {
    window.innerWidth = 820
    window.innerHeight = 1180
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    expect(view.getByTestId('werewolf-table')).toMatchSnapshot()
  })

  it('matches the 390px mobile layout snapshot with the seat carousel', async () => {
    window.innerWidth = 390
    window.innerHeight = 844
    const view = render(<TestView sessionId="s1" {...face} />)
    await arriveAtTable(view)
    const table = view.getByTestId('werewolf-table')
    expect(table).toMatchSnapshot()
    expect(window.innerWidth).toBe(390)
  })
})
