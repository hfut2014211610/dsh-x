/** Whole-application Werewolf shell with its sole route back to normal app chrome. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WerewolfViewInjected } from './WerewolfView.tsx'
import { WerewolfView } from './WerewolfView.tsx'
import type { WerewolfKey } from './locales.ts'
import styles from './WerewolfView.module.css'

/** Successful selection returned by the whole-frame routing chain. */
export interface WerewolfSurfaceMatch {
  mode: 'werewolf-window'
}

/** Values supplied by the Werewolf plugin after the shell chain elects it. */
export interface WerewolfSurfaceInjected {
  /** Remote-backed game view operations. */
  view: WerewolfViewInjected
  /** Leave game presentation without ending the retained game. */
  exitMode: () => void
}

/** Complete props for the session-maybe shell takeover entry. */
export type WerewolfSurfaceProps =
  & PropsRuntime<'shell.surface'>
  & WerewolfSurfaceInjected
  & { matched: WerewolfSurfaceMatch }

/** Render the game as an application mode rather than conversation content. */
export function WerewolfSurface({ sessionId, view, exitMode }: WerewolfSurfaceProps): React.JSX.Element | null {
  const t = (key: WerewolfKey): string => view.translate(key)
  return (
    <main
      className={styles.exclusiveShell}
      data-shell-exclusive=""
      data-testid="werewolf-exclusive-surface"
      aria-label={t('shell.title')}
    >
      <header className={styles.exclusiveHeader}>
        <div className={styles.exclusiveBrand}>
          <span className={styles.exclusiveMark} aria-hidden="true">◐</span>
          <span>
            <small>{t('shell.eyebrow')}</small>
            <strong>{t('shell.title')}</strong>
          </span>
        </div>
        <div className={styles.exclusiveActions}>
          <span className={styles.exclusiveMode}>{t('shell.mode')}</span>
          <button type="button" className={styles.exitButton} onClick={exitMode} title={t('shell.exitHint')}>
            <span aria-hidden="true">←</span>
            {t('shell.exit')}
          </button>
        </div>
      </header>
      <div className={styles.exclusiveContent}>
        <WerewolfView sessionId={sessionId} {...view} />
      </div>
    </main>
  )
}
