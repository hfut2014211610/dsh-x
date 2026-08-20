/**
 * The Feishu connector's staged form over the `dsh-x-feishu` settings namespace.
 *
 * The card asks one question first — is this channel set up or not — because
 * everything else only makes sense on one side of that answer. Before setup
 * there are two ways in and nothing else; after it there is a status line, the
 * knobs folded away, and the two actions that undo it.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ConnectorForm, choiceField, durationField, listField, textField, toggleField,
  type ConnectorActions, type ConnectorFieldState, type ConnectorFormState,
} from './connector-form.ts'
import {
  ConnectorPresenceController,
  type ConnectorPluginFace, type ConnectorPresenceState,
} from './connector-presence.ts'
import { FeishuAuthController, type AuthRpc, type FeishuAuthState } from './feishu-auth-controller.ts'

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

/** Direct-message access modes the bridge takes, in display order. */
export const FEISHU_DM_MODES = ['open', 'allowlist', 'disabled'] as const

/** The two ways in; the empty string is "not set up yet". */
export const FEISHU_MODES = ['', 'direct', 'bridge'] as const

/**
 * How this deployment reaches Feishu.
 *
 * `direct` — dsh has its own Feishu app and you scan to authorize it.
 * `bridge` — events come from another process, through a command that stands
 * in for `lark-cli event consume`. Advanced; most deployments want `direct`.
 */
export type FeishuMode = 'direct' | 'bridge'

/** What the bridge reports about itself over the live connection. */
export interface BridgeSummaryView {
  /** Profile directories the bridge subscribes on. */
  apps: readonly string[]
  /** Direct-message access mode in effect. */
  dmMode: string
  /** How many people may DM. */
  dmAllowed: number
  /** How many groups are served. */
  groupsAllowed: number
  /** Whether a group message must @ the bot. */
  requireMention: boolean
}

/** Whether the bridge is there, and what it is doing. */
export interface BridgeStatusView {
  /** Whether the channel plugin currently holds a connection to the bridge. */
  connected: boolean
  /** What the bridge reports; absent while disconnected. */
  bridge?: BridgeSummaryView
}

/** The channel fields this card edits. */
export interface FeishuSettings {
  /** Which way in; empty means not set up. */
  mode?: string
  /** `direct`: which lark-cli profile dsh uses, by name. */
  profileId?: string
  /** `bridge`: the Feishu app the events belong to. */
  appId?: string
  /** `bridge`: the command that stands in for `lark-cli event consume`. */
  eventCommand?: string
  /** Directory a session opened from Feishu runs in. */
  workspace?: string
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
  /** Direct-message access mode. */
  dmMode?: string
  /** Who may open a direct message, by open_id. */
  dmAllowlist?: string[]
  /** Which groups are served, by chat_id. */
  groupAllowlist?: string[]
  /** Whether a group message must @ the bot. */
  requireMention?: boolean
  /** How old a message may be before it is dropped, in milliseconds. */
  staleMs?: number
}

/** What the Feishu card renders. */
export interface FeishuCardState extends ConnectorFormState {
  /** Where the channel's plugin stands in the profile. */
  plugin: ConnectorPresenceState
  /** Sign-in state, the QR in flight, and what a scan would grant. */
  auth: FeishuAuthState
  /** Whether the bridge is there and what it reports; only read, never written. */
  bridge: BridgeStatusView
  /** Whether this channel is set up. Everything on the card hangs off it. */
  ready: boolean
  /** Which way in is chosen; empty until one is. */
  mode: ConnectorFieldState
  /** `direct`: the lark-cli profile name. */
  profileId: ConnectorFieldState
  /** `bridge`: the Feishu app id. */
  appId: ConnectorFieldState
  /** `bridge`: the stand-in for `lark-cli event consume`. */
  eventCommand: ConnectorFieldState
  /** Where a session opened from Feishu runs. */
  workspace: ConnectorFieldState
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
  /** Direct-message access mode field. */
  dmMode: ConnectorFieldState
  /** Direct-message allowlist field. */
  dmAllowlist: ConnectorFieldState
  /** Group allowlist field. */
  groupAllowlist: ConnectorFieldState
  /** Require-@ field. */
  requireMention: ConnectorFieldState
  /** Message freshness field. */
  staleMs: ConnectorFieldState
  /** One line saying who can actually reach the channel as configured right now. */
  reach: 'nobody' | 'dm-only' | 'group-only' | 'both'
  /** Whether the folded settings are open. */
  settingsOpen: boolean
  /** Whether the setup controls are showing again on a set-up channel. */
  setupOpen: boolean
  /** Whether the next tap on the sign-out button performs it. */
  confirmingReset: boolean
}

/**
 * Who can reach a channel, given a direct-message mode, whether anyone is on
 * the DM list, and whether any group is served.
 *
 * Pulled out of the projection so the judgement lives in one place: the same
 * question gets asked of the draft settings and, elsewhere, of what a bridge
 * reports about itself.
 * @param dmMode - the direct-message mode.
 * @param dmAllowed - whether anyone may DM under that mode.
 * @param groupsAllowed - whether any group is served.
 * @returns which of the two ways in are open.
 */
export function reachOf(dmMode: string, dmAllowed: boolean, groupsAllowed: boolean): FeishuCardState['reach'] {
  const dm = dmMode === 'open' || (dmMode !== 'disabled' && dmAllowed)
  if (dm && groupsAllowed) return 'both'
  if (dm) return 'dm-only'
  return groupsAllowed ? 'group-only' : 'nobody'
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
  /** Read the sign-in state and what the bridge reports. */
  readAuth: () => void
  /** Check or clear one permission domain for the next scan. */
  selectDomain: (domain: string, wanted: boolean) => void
  /** Create a Feishu app for this profile — the step before authorizing. */
  bindApp: () => void
  /** Start a scan-to-authorize. */
  beginAuth: () => void
  /** Abandon the scan in flight. */
  cancelAuth: () => void
  /** Show the setup controls again on a channel that is already set up. */
  reopenSetup: () => void
  /** Unfold or refold the settings. */
  toggleSettings: () => void
  /** Sign out and clear the setup; the first tap only arms it. */
  reset: () => void
}

/** Bridges the `dsh-x-feishu` scope onto the Feishu card's staged form. */
export class FeishuCardController {
  private readonly form: ConnectorForm<FeishuSettings>
  private readonly presence: ConnectorPresenceController
  private readonly auth: FeishuAuthController
  private readonly store: SnapshotStore<FeishuCardState>
  /** What the bridge last reported. Read-only: nothing on this card writes it. */
  private status: BridgeStatusView = { connected: false }
  private settingsOpen = false
  private setupOpen = false
  private confirmingReset = false

  /**
   * @param scope - the bound settings scope for the `dsh-x-feishu` namespace.
   * @param plugins - the plugin-tree calls the card's switch runs on.
   * @param rpc - the connection's raw RPC channel, where `feishuAuth/*` lives.
   */
  constructor(
    scope: SettingsScope<FeishuSettings>,
    plugins: ConnectorPluginFace,
    private readonly rpc: AuthRpc,
  ) {
    this.form = new ConnectorForm(scope, [
      choiceField('mode', FEISHU_MODES),
      textField('profileId'),
      textField('appId'),
      textField('eventCommand'),
      textField('workspace'),
      textField('presetId'),
      choiceField('density', FEISHU_DENSITIES),
      durationField('flushMs'),
      durationField('approvalTimeoutMs'),
      textField('endpoint'),
      choiceField('dmMode', FEISHU_DM_MODES),
      listField('dmAllowlist'),
      listField('groupAllowlist'),
      toggleField('requireMention'),
      durationField('staleMs'),
    ])
    this.presence = new ConnectorPresenceController(FEISHU_MODULE, plugins)
    this.auth = new FeishuAuthController(rpc)
    this.store = this.form.bind(() => this.projection())
    // 改了用哪份 profile，下面的登录与权限要跟着换过去——否则屏幕上写着一个
    // profile，扫码授权动的是另一个。
    this.form.watch(() => { this.syncAuthProfile() })
    // Switching the plugin changes the pill, the switch, and whether there are
    // controls at all, so the card republishes on either source.
    this.presence.store.subscribe(() => { this.store.set(this.projection()) })
    this.auth.store.subscribe(() => { this.store.set(this.projection()) })
  }

  /** 让登录与权限那一段跟着「用哪份 profile」走。 */
  private syncAuthProfile(): void {
    const chosen = this.form.field('profileId').text
    if (chosen === this.auth.store.getSnapshot().configDir) return
    void this.auth.selectProfile(chosen)
  }

  /**
   * 这条渠道接好了没有。
   *
   * 按**配置齐不齐**判，不按连没连上：桥接没起来是运维状态，不是"没接入"，
   * 两者混在一起的话，桥接一挂整张卡片就退回去问你打算怎么接。
   * @returns 接好了为 `true`。
   */
  private isReady(): boolean {
    const mode = this.form.field('mode').text
    if (mode === 'direct') {
      const status = this.auth.store.getSnapshot().status
      return status?.configured === true && status.user !== undefined
    }
    if (mode === 'bridge') {
      return this.form.field('appId').text.trim() !== ''
        && this.form.field('eventCommand').text.trim() !== ''
    }
    return false
  }

  /**
   * Who can actually reach the channel as configured right now.
   *
   * Worth a line of its own because the deny-by-default policy is silent: an
   * allowlist mode with an empty allowlist and no groups listed is a channel
   * that is switched on, authorized, connected — and that nobody can use.
   * @returns which of the two ways in are open.
   */
  private reach(): FeishuCardState['reach'] {
    return reachOf(
      this.form.field('dmMode').text,
      this.form.field('dmAllowlist').text.trim() !== '',
      this.form.field('groupAllowlist').text.trim() !== '',
    )
  }

  private projection(): FeishuCardState {
    return {
      ...this.form.state(),
      plugin: this.presence.store.getSnapshot(),
      auth: this.auth.store.getSnapshot(),
      bridge: this.status,
      ready: this.isReady(),
      mode: this.form.field('mode'),
      profileId: this.form.field('profileId'),
      appId: this.form.field('appId'),
      eventCommand: this.form.field('eventCommand'),
      workspace: this.form.field('workspace'),
      presetId: this.form.field('presetId'),
      density: this.form.field('density'),
      flushMs: this.form.field('flushMs'),
      approvalTimeoutMs: this.form.field('approvalTimeoutMs'),
      endpoint: this.form.field('endpoint'),
      dmMode: this.form.field('dmMode'),
      dmAllowlist: this.form.field('dmAllowlist'),
      groupAllowlist: this.form.field('groupAllowlist'),
      requireMention: this.form.field('requireMention'),
      staleMs: this.form.field('staleMs'),
      reach: this.reach(),
      settingsOpen: this.settingsOpen,
      setupOpen: this.setupOpen,
      confirmingReset: this.confirmingReset,
    }
  }

  /**
   * Read what the bridge says about itself.
   *
   * Its own report rather than its configuration file: the file may belong to
   * whoever runs the bridge, but what arrives on the live connection is by
   * definition what is in effect.
   * @returns settlement after the read.
   */
  async readBridge(): Promise<void> {
    const result = await this.rpc.call('/api', 'feishuAuth/bridge', { args: {} })
    // A bridge that cannot be read is reported as not connected, which is the
    // truthful reading: nothing on this card can act on it either way.
    this.status = result.ok ? result.value as BridgeStatusView : { connected: false }
    this.store.set(this.projection())
  }

  /**
   * Undo the setup: sign out on this machine, then clear which way in was
   * chosen so the card asks again.
   *
   * Armed by the first tap and performed by the second. It signs a real Feishu
   * session out, and a settings card has no business opening a modal to ask.
   * @returns settlement after the write.
   */
  private async reset(): Promise<void> {
    if (!this.confirmingReset) {
      this.confirmingReset = true
      this.store.set(this.projection())
      return
    }
    this.confirmingReset = false
    if (this.form.field('mode').text === 'direct') await this.auth.logout()
    const actions = this.form.actions()
    for (const field of ['mode', 'appId', 'eventCommand']) actions.resetField(field)
    await this.form.save()
    this.setupOpen = false
    this.store.set(this.projection())
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): FeishuCardFace {
    const actions = this.form.actions()
    return {
      hooks: { feishuCard: this.store },
      readPresence: () => { void this.presence.refresh() },
      setEnabled: (enabled) => { void this.presence.setEnabled(enabled) },
      readAuth: () => {
        // 授权动作跟着「用哪份 profile」走，不另选一次：两个地方各选一次的
        // 结果是屏幕上写着一个、扫码授权动的是另一个。
        void this.auth.selectProfile(this.form.field('profileId').text)
        void this.readBridge()
      },
      selectDomain: (domain, wanted) => { this.auth.select(domain, wanted) },
      bindApp: () => { void this.auth.bind() },
      beginAuth: () => { void this.auth.begin() },
      cancelAuth: () => { void this.auth.cancel() },
      reopenSetup: () => {
        this.setupOpen = !this.setupOpen
        this.store.set(this.projection())
      },
      toggleSettings: () => {
        this.settingsOpen = !this.settingsOpen
        this.store.set(this.projection())
      },
      reset: () => { void this.reset() },
      ...actions,
      // 手在别处动过之后，下一次点「注销」不该直接执行——待命状态跟着任何一次
      // 编辑解除。
      edit: (field, text) => {
        this.confirmingReset = false
        actions.edit(field, text)
      },
    }
  }
}
