/**
 * Usage settings plugin, browser half: registers the Model usage page — a
 * cross-session token-consumption panel over the session-list rows' usageStats
 * projection values. The Host stays the single fact source through the
 * session.list wire join; the page only reads.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { UsageSettingsStore } from './store.ts'
import { en, zh } from './locales.ts'
import type { UsageKey } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageSettingsState, UsageSettingsStore } from './store.ts'
export type { UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The usage page copy. */
    'settings.usage': UsageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usage'

/**
 * Refetch the page snapshot only after its first load: an unopened usage
 * page must not fetch on background resets.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: UsageSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the usage section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and refetch after a
 * connection reset (the projection rows ride the session list).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new UsageSettingsStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  // Registration-time text (the nav label thunk) and the inject face share
  // one bound translate; copy freshness rides the locale revision.
  const t: UsageSectionInjectedBound = ctx.locale.bind(NS)
  const injected = (): UsageSectionInjected => ({ controller, useSnapshot, t })

  ctx.effect(() => ctx.on('connection/reset', () => { refreshIfLoaded(controller) }),
    'ui-settings-usage: connection reset refresh')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 25,
    label: () => t('nav'),
    inject: injected,
  }, UsageSection))
}

/** The bound translate face the section's injected `t` carries. */
type UsageSectionInjectedBound = (key: UsageKey) => string
