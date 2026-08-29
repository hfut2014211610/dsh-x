/** Sidebar entry that opens Werewolf in its own browser or desktop window. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import styles from './WerewolfView.module.css'

/** Callbacks and copy supplied to the global Werewolf launcher. */
export interface WerewolfLauncherInjected {
  launch: () => void
  label: string
  hint: string
}

/** Complete props for the sidebar footer action. */
export type WerewolfLauncherProps = PropsRuntime<'sidebar.footer.action'> & WerewolfLauncherInjected

/** Open the isolated game window without changing the current conversation. */
export function WerewolfLauncher({ wide, launch, label, hint }: WerewolfLauncherProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={wide ? `${styles.launcherButton} ${styles.launcherWide}` : styles.launcherButton}
      aria-label={label}
      title={hint}
      onClick={launch}
      data-testid="werewolf-window-launcher"
    >
      <span className={styles.launcherMark} aria-hidden="true">◐</span>
      {wide && <span>{label}</span>}
    </button>
  )
}
