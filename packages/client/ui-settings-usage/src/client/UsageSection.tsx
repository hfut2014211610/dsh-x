/**
 * Model usage settings section, global view over a chosen statistics window:
 * a whole-list summary strip, a day-bucketed dot heatmap of consumption
 * intensity (each dot carries a hover tooltip with its day and buckets), and
 * one aggregate row per model. The panel is session-blind — the data is every
 * session's `usageStats` projection value joined through the session list,
 * read on open, on connection reset, and on demand; switching the window
 * re-aggregates the last good rows offline.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { UsageSettingsState, UsageSettingsStore } from './store.ts'
import type { DayUsage, ModelUsageRow, UsageRange } from './view-model.ts'
import {
  USAGE_RANGES, formatDuration, formatTokens, heatmapDaysOf, intensityOf,
} from './view-model.ts'
import type { UsageKey } from './locales.ts'
import styles from './UsageSection.module.css'

/** Injected dependencies of {@link UsageSection} (slot `inject`). */
export interface UsageSectionInjected {
  /** The page store (loaded on mount, refreshed on demand). */
  controller: UsageSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<UsageSettingsState>
  /** Section copy. */
  t: (key: UsageKey) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type UsageSectionProps = Partial<UsageSectionInjected>

/** Copy key of each statistics-window choice, in display order. */
const RANGE_LABELS: Record<UsageRange, UsageKey> = {
  7: 'range7',
  28: 'range28',
  90: 'range90',
  all: 'rangeAll',
}

/** One summary cell value: an absent optional bucket renders as an em dash. */
const tokens = (value: number | undefined): string => value === undefined ? '—' : formatTokens(value)

/** Relative day name of one heatmap cell. */
function dayName(daysAgo: number, t: UsageSectionInjected['t']): string {
  if (daysAgo === 0) return t('today')
  if (daysAgo === 1) return t('yesterday')
  return t('daysAgo').replace('{n}', String(daysAgo))
}

/**
 * The hover tooltip text of one heatmap cell: its day and that day's buckets,
 * or the day plus a no-usage notice when the cell is empty.
 * @param day - the day bucket.
 * @param t - section copy.
 * @returns the tooltip text.
 */
export function dayTooltip(day: DayUsage, t: UsageSectionInjected['t']): string {
  if (day.promptTokens + day.outputTokens === 0) {
    return `${dayName(day.daysAgo, t)} · ${t('noUsage')}`
  }
  return t('tooltipDay')
    .replace('{date}', () => dayName(day.daysAgo, t))
    .replace('{prompt}', () => formatTokens(day.promptTokens))
    .replace('{output}', () => formatTokens(day.outputTokens))
}

/** One heatmap day cell with its hover tooltip. */
function DayCell({ day, maxDayTokens, t }: {
  day: DayUsage
  maxDayTokens: number
  t: UsageSectionInjected['t']
}): ReactNode {
  return (
    <Tooltip label={() => dayTooltip(day, t)} side="top">
      <span className={styles.dayCell} data-level={intensityOf(day, maxDayTokens)} aria-hidden="true" />
    </Tooltip>
  )
}

/** One model aggregate row; unreported buckets render as em dashes. */
function modelCells(row: ModelUsageRow): ReactNode {
  return (
    <>
      <td>{row.model ?? '—'}</td>
      <td>{row.requests}</td>
      <td>{formatTokens(row.inputTokens)}</td>
      <td>{formatTokens(row.cacheReadTokens)}</td>
      <td>{tokens(row.cacheWriteTokens)}</td>
      <td>{formatTokens(row.outputTokens)}</td>
      <td>{tokens(row.reasoningTokens)}</td>
      <td>{formatDuration(row.llmMs)}</td>
    </>
  )
}

/**
 * Render the usage section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <UsageLoaded injected={{ controller, useSnapshot, t }} />
}

function UsageLoaded({ injected }: { injected: UsageSectionInjected }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [state.status, controller])

  const overview = state.overview
  const totals = overview.totals
  return (
    <section className={styles.section} aria-label={t('title')}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.intro}>{t('intro')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { void controller.load() }}>
          <IconRefreshOutline16 size={16} />
          {t('refresh')}
        </Button>
      </header>
      <div className={styles.ranges} role="group" aria-label={t('rangeLabel')}>
        {USAGE_RANGES.map(range => (
          <button
            key={String(range)}
            type="button"
            className={clsx(styles.rangeButton, state.range === range && styles.rangeSelected)}
            aria-pressed={state.range === range}
            onClick={() => { controller.setRange(range) }}
          >
            {t(RANGE_LABELS[range])}
          </button>
        ))}
      </div>
      {state.error === null ? null : (
        <p className={styles.error} role="alert">{t('errorTitle')}: {state.error}</p>
      )}
      {totals.requests === 0 ? (
        <p className={styles.empty}>{state.status === 'ready' ? t('empty') : null}</p>
      ) : (
        <>
          <dl className={styles.summary}>
            <div><dt>{t('statSessions')}</dt><dd>{overview.sessionsWithUsage}</dd></div>
            <div><dt>{t('statRequests')}</dt><dd>{totals.requests}</dd></div>
            <div><dt>{t('statInput')}</dt><dd>{formatTokens(totals.inputTokens)}</dd></div>
            <div><dt>{t('statCacheRead')}</dt><dd>{formatTokens(totals.cacheReadTokens)}</dd></div>
            <div><dt>{t('statCacheWrite')}</dt><dd>{tokens(totals.cacheWriteTokens)}</dd></div>
            <div><dt>{t('statOutput')}</dt><dd>{formatTokens(totals.outputTokens)}</dd></div>
            <div><dt>{t('statReasoning')}</dt><dd>{tokens(totals.reasoningTokens)}</dd></div>
            <div><dt>{t('statLlmTime')}</dt><dd>{formatDuration(totals.llmMs)}</dd></div>
          </dl>
          <div
            className={styles.heatmap}
            role="img"
            aria-label={t('heatmapLabel')}
            style={{ gridTemplateColumns: `repeat(${heatmapDaysOf(state.range)}, minmax(0, 1fr))` }}
          >
            {overview.days.map(day => (
              <DayCell key={day.daysAgo} day={day} maxDayTokens={overview.maxDayTokens} t={t} />
            ))}
          </div>
          <p className={styles.heatmapCaption}>{t('heatmapCaption')}</p>
          <table className={styles.models}>
            <thead>
              <tr>
                <th scope="col">{t('model')}</th>
                <th scope="col">{t('statRequests')}</th>
                <th scope="col">{t('statInput')}</th>
                <th scope="col">{t('statCacheRead')}</th>
                <th scope="col">{t('statCacheWrite')}</th>
                <th scope="col">{t('statOutput')}</th>
                <th scope="col">{t('statReasoning')}</th>
                <th scope="col">{t('statLlmTime')}</th>
              </tr>
            </thead>
            <tbody>{overview.models.map(row => (
              <tr key={row.model ?? ''}>{modelCells(row)}</tr>
            ))}</tbody>
          </table>
        </>
      )}
    </section>
  )
}
