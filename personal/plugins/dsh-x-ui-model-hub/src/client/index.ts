/**
 * Model-hub settings page, browser half. Registers the `settings.section`
 * contribution; all reads and writes go through the settings wire face, and
 * the host-side dsh-x-model-hub plugin compiles each committed change into
 * stock provider routes.
 *
 * @module @personal/dsh-x-ui-model-hub/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: the shell's SlotMap merge (the 'settings.section' entry) and the
// locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelHubSection } from './ModelHubSection.tsx'
import type { ModelHubInjected } from './ModelHubSection.tsx'
import { ModelHubStore } from './store.ts'
import type { HubRpc } from './store.ts'
import { en, zh, type ModelHubKey } from './locales.ts'

export type { ModelHubInjected, ModelHubSectionProps } from './ModelHubSection.tsx'
export type { ModelHubState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model-hub page copy. */
    'settings.model-hub': ModelHubKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.model-hub'

/** Required services (cordis fiber inject); the slot registration itself waits on the declaration via `slots.inject()`. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Model Hub section once the `settings.section` declaration is on
 * the ledger, and keep the page fresh on pushed settings invalidations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-x-ui-model-hub: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const rpc = (connection as unknown as { rpc: HubRpc }).rpc
  const controller = new ModelHubStore(rpc)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as ModelHubInjected['t']
  const injected = (): ModelHubInjected => ({ controller, useSnapshot, t })

  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status === 'idle') return
      void controller.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        // The write surface rides the settings seam, so its commits push this
        // event; only our namespace's commits concern the page.
        if (ns === 'dsh-x-model-hub') refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-x-ui-model-hub: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'model-hub',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, ModelHubSection))
}
