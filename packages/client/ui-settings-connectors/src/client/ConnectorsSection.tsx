/** Connectors settings section: one card per app channel that reaches dsh. */

import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the slot declaration this section renders, and the locale
// namespace entry `PropsLocale` resolves its key set from.
import type {} from './slot-contract.ts'
import type {} from './locales.ts'
import css from './ConnectorsSection.module.css'

/** Registration-side business face for the section. */
export interface ConnectorsSectionInjected {
  /** How many cards the slot ledger held when the section registration mounted. */
  cardCount: number
}

/** Props the renderer binds for the section. */
export type ConnectorsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.connectors'>
  & PropsRenderSlots<'settings.connector.item'>
  & InjectFace<ConnectorsSectionInjected>

/**
 * Render the Connectors page.
 * @param props - the page copy, the card ledger size, and the card render site.
 * @returns the settings page.
 */
export function ConnectorsSection({ t, renderSlot, cardCount }: ConnectorsSectionProps) {
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {cardCount === 0
        ? <p className={css.empty}>{t('empty')}</p>
        : <ul className={css.cards}>{renderSlot('settings.connector.item', {})}</ul>}
    </div>
  )
}
