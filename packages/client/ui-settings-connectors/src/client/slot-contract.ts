/**
 * The `settings.connector.item` slot type — one connector's card inside the
 * Connectors section. Options: `id` (card key), `order` (card position). A
 * card draws its own internals; the section only stacks them and reports how
 * many there are.
 *
 * This is the extension point the page exists for: a second channel ships as
 * its own package, registers one entry here, and needs no edit to this one.
 * The type lives beside the section that declares it at runtime, because a
 * package registering a connector card already depends on this one for the
 * card chrome and the form model.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One connector's card inside the Connectors section (see module JSDoc). */
    'settings.connector.item': { kind: 'list'; scope: 'root'; owner: SettingsConnectorItemOwnerProps }
  }
}

/** Owner share of a connector card (the section supplies nothing). */
export interface SettingsConnectorItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}
