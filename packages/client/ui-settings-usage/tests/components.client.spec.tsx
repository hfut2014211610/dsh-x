// @vitest-environment jsdom
/** Section rendering: summary strip, the day-dot heatmap, the per-model table, and failure/empty states. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts'
import { UsageSection, dayTooltip } from '../src/client/UsageSection.tsx'
import type { UsageSectionInjected } from '../src/client/UsageSection.tsx'
import { UsageSettingsStore } from '../src/client/store.ts'
import type { UsageSettingsState } from '../src/client/store.ts'
import { HEATMAP_WINDOW_DAYS } from '../src/client/view-model.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: UsageSectionInjected['t'] = key => en[key]

/** One wire row carrying a full projection block. */
const row = (sessionId: string, title: string | null) => ({
  sessionId,
  updatedAt: 2,
  projections: {
    asOfSeq: 8,
    values: {
      title,
      usageStats: {
        requests: [
          { turn: 1, step: 1, time: Date.now() - 86_400_000, provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 }, llmMs: 40 },
          { turn: 1, step: 2, time: Date.now() - 86_400_000, provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 }, llmMs: 1_200 },
          { turn: 1, step: 3, time: Date.now() - 86_400_000, provider: 'deepseek-official', model: 'deepseek-v4-pro', usage: { inputTokens: 9, outputTokens: 9 }, llmMs: 60 },
        ],
        contextWindow: 128_000,
      },
    },
  },
})

/** A store seeded with one scripted list answer. */
function storeWith(items: unknown[]): UsageSettingsStore {
  return new UsageSettingsStore({
    sessions: {
      list: () => Promise.resolve({ result: { ok: true, value: { items } } }),
    },
  } as never)
}

describe('UsageSection', () => {
  it('renders null while the shell has not injected the section dependencies', () => {
    expect(UsageSection({})).toBeNull()
  })

  it('loads on mount and renders the global summary', async () => {
    const controller = storeWith([row('s1', 'first chat')])
    const useSnapshot = bindSnapshotSelector<UsageSettingsState>(controller.store)
    render(<UsageSection controller={controller} useSnapshot={useSnapshot} t={t} />)
    await waitFor(() => { expect(screen.getByText('deepseek-v4-flash')).toBeTruthy() })
    // Global totals in display order: sessions 1, requests 3, input 27,
    // cache read 2, cache write —, output 17, reasoning 1, model time 1.3 s.
    const summary = document.querySelector('dl')
    expect([...summary?.querySelectorAll('dd') ?? []].map(node => node.textContent))
      .toEqual(['1', '3', '27', '2', '—', '17', '1', '1.3 s'])
  })

  it('renders one day-dot per heatmap window day, with intensity only on used days', async () => {
    const controller = storeWith([row('s1', 'first chat')])
    const useSnapshot = bindSnapshotSelector<UsageSettingsState>(controller.store)
    render(<UsageSection controller={controller} useSnapshot={useSnapshot} t={t} />)
    await waitFor(() => { expect(screen.getByText('deepseek-v4-flash')).toBeTruthy() })
    const heatmap = screen.getByRole('img', { name: en.heatmapLabel.replace('{days}', String(HEATMAP_WINDOW_DAYS)) })
    const cells = heatmap.querySelectorAll('[data-level]')
    expect(cells).toHaveLength(HEATMAP_WINDOW_DAYS)
    // All requests land on yesterday: one cell at full intensity, the rest empty.
    const levels = [...cells].map(cell => cell.getAttribute('data-level'))
    expect(levels.filter(level => level !== '0')).toEqual(['4'])
  })

  it('renders one aggregate row per model with unreported buckets as dashes', async () => {
    const controller = storeWith([row('s1', 'first chat')])
    const useSnapshot = bindSnapshotSelector<UsageSettingsState>(controller.store)
    render(<UsageSection controller={controller} useSnapshot={useSnapshot} t={t} />)
    await waitFor(() => { expect(screen.getByText('deepseek-v4-flash')).toBeTruthy() })
    const table = screen.getByRole('table')
    const flash = screen.getByText('deepseek-v4-flash').closest('tr')
    expect(flash?.textContent).toContain('2')
    expect(flash?.textContent).toContain('18')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    // The v4-pro request reported no cache traffic, so its buckets read zero.
    const pro = screen.getByText('deepseek-v4-pro').closest('tr')
    expect(pro?.querySelectorAll('td')[3]?.textContent).toBe('0')
  })

  it('shows the empty notice on a ready empty list and the error alert on failure', async () => {
    const empty = storeWith([])
    const emptyHook = bindSnapshotSelector<UsageSettingsState>(empty.store)
    render(<UsageSection controller={empty} useSnapshot={emptyHook} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.empty)).toBeTruthy() })

    const failing = new UsageSettingsStore({
      sessions: { list: () => Promise.resolve({ result: { ok: false, error: { code: 'X', message: 'denied' } } }) },
    } as never)
    const failingHook = bindSnapshotSelector<UsageSettingsState>(failing.store)
    render(<UsageSection controller={failing} useSnapshot={failingHook} t={t} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('denied') })
  })

  it('renders the statistics-window choices and re-aggregates offline on switch', async () => {
    const controller = storeWith([row('s1', 'first chat')])
    const useSnapshot = bindSnapshotSelector<UsageSettingsState>(controller.store)
    render(<UsageSection controller={controller} useSnapshot={useSnapshot} t={t} />)
    await waitFor(() => { expect(screen.getByText('deepseek-v4-flash')).toBeTruthy() })
    const group = screen.getByRole('group', { name: en.rangeLabel })
    // Default window first, every choice offered, exactly one pressed.
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([en.range7, en.range28, en.range90, en.rangeAll])
    expect(buttons.filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(screen.getByRole('img', { name: en.heatmapLabel }).querySelectorAll('[data-level]'))
      .toHaveLength(28)

    // The seeded requests sit a day back, so the 7-day window keeps the
    // numbers and shrinks the dot grid to its own span — no wire traffic.
    const listCalls = (controller as unknown as { api: { sessions: { list: () => unknown } } }).api
    fireEvent.click(buttons[0]!)
    await waitFor(() => {
      expect(screen.getByRole('img', { name: en.heatmapLabel }).querySelectorAll('[data-level]'))
        .toHaveLength(7)
    })
    expect(screen.getByText('deepseek-v4-flash')).toBeTruthy()
    void listCalls
  })

  it('dayTooltip names the relative day with its buckets, or the no-usage notice', () => {
    expect(dayTooltip({ daysAgo: 0, promptTokens: 20, outputTokens: 8 }, t))
      .toBe('Today · input+cache 20 · output 8')
    expect(dayTooltip({ daysAgo: 1, promptTokens: 0, outputTokens: 0 }, t))
      .toBe('Yesterday · no usage')
    expect(dayTooltip({ daysAgo: 12, promptTokens: 1_300, outputTokens: 5_003 }, t))
      .toBe('12 days ago · input+cache 1.3k · output 5k')
  })

  it('refreshes on demand through the header button', async () => {
    const controller = storeWith([row('s1', 'first chat')])
    const load = vi.spyOn(controller, 'load').mockResolvedValue()
    const useSnapshot = bindSnapshotSelector<UsageSettingsState>(controller.store)
    render(<UsageSection controller={controller} useSnapshot={useSnapshot} t={t} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: en.refresh })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(load).toHaveBeenCalled()
  })
})
