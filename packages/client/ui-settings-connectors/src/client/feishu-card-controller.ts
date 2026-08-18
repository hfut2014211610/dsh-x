/** The Feishu connector's staged form over the `dsh-x-feishu` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ConnectorForm, choiceField, durationField, textField,
  type ConnectorActions, type ConnectorFieldState, type ConnectorFormState,
} from './connector-form.ts'

/**
 * Namespace of the Feishu channel plugin. Spelled here rather than imported:
 * a client package must not depend on a host package, and the plugin that owns
 * it spells the same value.
 */
export const FEISHU_NS = 'dsh-x-feishu'

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
}

/** Bridges the `dsh-x-feishu` scope onto the Feishu card's staged form. */
export class FeishuCardController {
  private readonly form: ConnectorForm<FeishuSettings>
  private readonly store: SnapshotStore<FeishuCardState>

  /** @param scope - the bound settings scope for the `dsh-x-feishu` namespace. */
  constructor(scope: SettingsScope<FeishuSettings>) {
    this.form = new ConnectorForm(scope, [
      textField('presetId'),
      choiceField('density', FEISHU_DENSITIES),
      durationField('flushMs'),
      durationField('approvalTimeoutMs'),
      textField('endpoint'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): FeishuCardState {
    return {
      ...this.form.state(),
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
    return { hooks: { feishuCard: this.store }, ...this.form.actions() }
  }
}
