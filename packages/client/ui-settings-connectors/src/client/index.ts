/**
 * Connectors settings surface, browser half — one nav entry listing every app
 * channel that can reach dsh, and the extension point (`settings.connector.item`)
 * a new channel registers its own card into.
 *
 * The page is separate from Plugins on purpose. A connector is not a knob on
 * the agent loop: it is a way in from outside, it usually needs a process the
 * user has to start, and it is the one settings page worth opening when the
 * channel is NOT installed. Plugins hides an uncomposed plugin; this page
 * lists it and says how to install it.
 *
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.remote Context merge the settings scope subscribes on.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ConnectorsSection } from './ConnectorsSection.tsx'
import type { ConnectorsSectionInjected } from './ConnectorsSection.tsx'
import { FeishuCard } from './FeishuCard.tsx'
import { FEISHU_NS, FeishuCardController } from './feishu-card-controller.ts'
import { en, zh, NS } from './locales.ts'

export type { ConnectorsSectionInjected, ConnectorsSectionProps } from './ConnectorsSection.tsx'
export type { ConnectorCardProps, ConnectorFieldProps } from './ConnectorCard.tsx'
export type { FeishuCardProps } from './FeishuCard.tsx'
export type { FeishuCardFace, FeishuCardState, FeishuSettings } from './feishu-card-controller.ts'
export type {
  ConnectorActions, ConnectorFieldSpec, ConnectorFieldState, ConnectorFormState, FieldWrite,
} from './connector-form.ts'
export type { SettingsConnectorItemOwnerProps } from './slot-contract.ts'
export type { ConnectorsKey } from './locales.ts'

/** Required services (cordis fiber inject); the slot registration waits on the declaration via `slots.inject()`. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the Connectors section and the one channel this package ships.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-connectors: copy dictionaries')
  const t = ctx.locale.bind(NS)
  const feishu = new FeishuCardController(ctx.settingsScope.bind({ namespace: FEISHU_NS }))

  // Between Plugins (15) and Model Hub (20): a connector is configuration of
  // the deployment, so it belongs with the plugin pages rather than beside
  // usage reporting.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'connectors',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: (): ConnectorsSectionInjected => ({
      cardCount: ctx.slots.entries('settings.connector.item').length,
    }),
    children: { 'settings.connector.item': { kind: 'list', scope: 'root' } },
  }, ConnectorsSection))

  ctx.slots.inject('settings.connector.item', () => ctx.slots.register({
    name: 'settings.connector.item',
    id: 'feishu',
    order: 0,
    locale: NS,
    inject: () => feishu.inject(),
  }, FeishuCard))
}
