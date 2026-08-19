/** The Feishu connector's staged form over the `dsh-x-feishu` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ConnectorForm, choiceField, durationField, textField,
  type ConnectorActions, type ConnectorFieldState, type ConnectorFormState,
} from './connector-form.ts'
import {
  ConnectorPresenceController,
  type ConnectorPluginFace, type ConnectorPresenceState,
} from './connector-presence.ts'

/**
 * Namespace of the Feishu channel plugin. Spelled here rather than imported:
 * a client package must not depend on a host package, and the plugin that owns
 * it spells the same value.
 */
export const FEISHU_NS = 'dsh-x-feishu'

/**
 * Module specifier of the channel's Loader entry, as its bundle patch writes
 * it. Matching on this rather than on the settings namespace keeps the two
 * facts separate: a plugin can serve a namespace under any name it likes, and
 * only the specifier identifies the entry in the tree.
 */
export const FEISHU_MODULE = '@personal/dsh-x-feishu'

/** Card densities the channel's renderer takes, in display order. */
export const FEISHU_DENSITIES = ['compact', 'standard', 'detailed'] as const

/** The channel fields this card edits. */
export interface FeishuSettings {
  /** Local socket to the bridge process; empty takes the platform default. */
  endpoint?: string
  /** Agent preset a session opened from Feishu runs. */
  presetId?: string
  /** How much of a turn the card shows. */
  density?: string
  /** Shortest gap between two pushes of the card body, in milliseconds. */
  flushMs?: number
  /** How long an approval card waits for a tap, in milliseconds. */
  approvalTimeoutMs?: number
}

/** What the Feishu card renders. */
export interface FeishuCardState extends ConnectorFormState {
  /** Where the channel's plugin stands in the profile. */
  plugin: ConnectorPresenceState
  /** Agent preset field. */
  presetId: ConnectorFieldState
  /** Card density field. */
  density: ConnectorFieldState
  /** Card refresh interval field. */
  flushMs: ConnectorFieldState
  /** Approval timeout field. */
  approvalTimeoutMs: ConnectorFieldState
  /** Bridge endpoint field. */
  endpoint: ConnectorFieldState
}

/** The registration-side face the Feishu card's slot entry injects. */
export interface FeishuCardFace extends ConnectorActions {
  hooks: {
    /** Card snapshot bound by the renderer as useFeishuCard. */
    feishuCard: SnapshotStore<FeishuCardState>
  }
  /** Re-read the plugin tree; the card calls this when it is first opened. */
  readPresence: () => void
  /** Switch the channel's plugin on or off. */
  setEnabled: (enabled: boolean) => void
}

/** Bridges the `dsh-x-feishu` scope onto the Feishu card's staged form. */
export class FeishuCardController {
  private readonly form: ConnectorForm<FeishuSettings>
  private readonly presence: ConnectorPresenceController
  private readonly store: SnapshotStore<FeishuCardState>

  /**
   * @param scope - the bound settings scope for the `dsh-x-feishu` namespace.
   * @param plugins - the plugin-tree calls the card's switch runs on.
   */
  constructor(scope: SettingsScope<FeishuSettings>, plugins: ConnectorPluginFace) {
    this.form = new ConnectorForm(scope, [
      textField('presetId'),
      choiceField('density', FEISHU_DENSITIES),
      durationField('flushMs'),
      durationField('approvalTimeoutMs'),
      textField('endpoint'),
    ])
    this.presence = new ConnectorPresenceController(FEISHU_MODULE, plugins)
    this.store = this.form.bind(() => this.projection())
    // Switching the plugin changes the pill, the switch, and whether there are
    // controls at all, so the card republishes on either source.
    this.presence.store.subscribe(() => { this.store.set(this.projection()) })
  }

  private projection(): FeishuCardState {
    return {
      ...this.form.state(),
      plugin: this.presence.store.getSnapshot(),
      presetId: this.form.field('presetId'),
      density: this.form.field('density'),
      flushMs: this.form.field('flushMs'),
      approvalTimeoutMs: this.form.field('approvalTimeoutMs'),
      endpoint: this.form.field('endpoint'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): FeishuCardFace {
    return {
      hooks: { feishuCard: this.store },
      readPresence: () => { void this.presence.refresh() },
      setEnabled: (enabled) => { void this.presence.setEnabled(enabled) },
      ...this.form.actions(),
    }
  }
}
