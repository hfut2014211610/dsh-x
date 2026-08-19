/** The Feishu connector's staged form over the `dsh-x-feishu` settings namespace. */

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

/** The two ways in, ordinary one first. */
export const FEISHU_ACCESS = ['own', 'reuse'] as const

/**
 * How this deployment gets its Feishu events.
 *
 * `own` — dsh has its own Feishu app, and the bridge is dsh's, so this page
 * owns the bridge's configuration too. `reuse` — the bridge is already running
 * for other agents; dsh writes none of its configuration and only tells it
 * which app dsh is.
 */
export type FeishuAccess = 'own' | 'reuse'

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
  /** Whether dsh runs its own Feishu app or reads from a bridge someone else runs. */
  access?: string
  /** dsh's own Feishu app: the lark-cli profile directory. */
  profile?: string
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
  /** Which of the two setups this card is showing. */
  access: ConnectorFieldState
  /** dsh's own Feishu app. */
  profile: ConnectorFieldState
  /** Whether the sign-in section is folded away, which reuse does by default. */
  authFolded: boolean
  /** Whether the bridge is there and what it reports; only read, never written. */
  bridge: BridgeStatusView
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
}

/**
 * Who can reach a channel, given a direct-message mode, whether anyone is on
 * the DM list, and whether any group is served.
 *
 * The same question is answered from two sources — the draft settings while
 * dsh owns the bridge, and the bridge's own report while it does not — so the
 * judgement lives in one place rather than being spelled twice.
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
  /** Read the sign-in state and the grantable domains. */
  readAuth: () => void
  /** Check or clear one permission domain for the next scan. */
  selectDomain: (domain: string, wanted: boolean) => void
  /** Start a scan-to-authorize. */
  beginAuth: () => void
  /** Abandon the scan in flight. */
  cancelAuth: () => void
  /** Sign out on this machine. */
  logout: () => void
  /** Unfold or refold the sign-in section. */
  toggleAuth: () => void
}

/** Bridges the `dsh-x-feishu` scope onto the Feishu card's staged form. */
export class FeishuCardController {
  private readonly form: ConnectorForm<FeishuSettings>
  private readonly presence: ConnectorPresenceController
  private readonly auth: FeishuAuthController
  private readonly store: SnapshotStore<FeishuCardState>
  /** Whether the reader unfolded the sign-in section that reuse folds away. */
  private authOpened = false
  /** What the bridge last reported. Read-only: nothing on this card writes it. */
  private status: BridgeStatusView = { connected: false }

  /**
   * @param scope - the bound settings scope for the `dsh-x-feishu` namespace.
   * @param plugins - the plugin-tree calls the card's switch runs on.
   * @param rpc - the connection's raw RPC channel, where `feishuAuth/*` lives.
   */
  constructor(scope: SettingsScope<FeishuSettings>, plugins: ConnectorPluginFace, private readonly rpc: AuthRpc) {
    this.form = new ConnectorForm(scope, [
      textField('presetId'),
      choiceField('density', FEISHU_DENSITIES),
      durationField('flushMs'),
      durationField('approvalTimeoutMs'),
      textField('endpoint'),
      choiceField('access', FEISHU_ACCESS),
      textField('profile'),
      choiceField('dmMode', FEISHU_DM_MODES),
      listField('dmAllowlist'),
      listField('groupAllowlist'),
      toggleField('requireMention'),
      durationField('staleMs'),
    ])
    this.presence = new ConnectorPresenceController(FEISHU_MODULE, plugins)
    this.auth = new FeishuAuthController(rpc)
    this.store = this.form.bind(() => this.projection())
    // 改了「dsh 是哪个飞书应用」，下面的登录与权限要跟着换过去——否则屏幕上写着
    // 一个应用，扫码授权动的是另一个。
    this.form.watch(() => { this.syncAuthProfile() })
    // Switching the plugin changes the pill, the switch, and whether there are
    // controls at all, so the card republishes on either source.
    this.presence.store.subscribe(() => { this.store.set(this.projection()) })
    this.auth.store.subscribe(() => { this.store.set(this.projection()) })
  }

  /**
   * Which branch the card shows. Empty means the schema default, which is own.
   * @returns the branch in effect.
   */
  private access(): FeishuAccess {
    return this.form.field('access').text === 'reuse' ? 'reuse' : 'own'
  }

  /**
   * Who can actually reach the channel as configured right now.
   *
   * Worth a line of its own because the deny-by-default policy is silent: an
   * allowlist mode with an empty allowlist and no groups listed is a channel
   * that is switched on, authorized, connected — and that nobody can use.
   *
   * Read from whoever owns the answer: the drafts while dsh owns the bridge,
   * the bridge's own report while it does not. Showing the drafts in reuse
   * would state a rule that is not the one being enforced.
   * @returns which of the two ways in are open.
   */
  private reach(): FeishuCardState['reach'] {
    if (this.access() === 'reuse') {
      const summary = this.status.bridge
      if (summary === undefined) return 'nobody'
      return reachOf(summary.dmMode, summary.dmAllowed > 0, summary.groupsAllowed > 0)
    }
    return reachOf(
      this.form.field('dmMode').text,
      this.form.field('dmAllowlist').text.trim() !== '',
      this.form.field('groupAllowlist').text.trim() !== '',
    )
  }

  /** 让登录与权限那一段跟着「dsh 是哪个飞书应用」走。 */
  private syncAuthProfile(): void {
    const chosen = this.form.field('profile').text
    if (chosen === this.auth.store.getSnapshot().configDir) return
    void this.auth.selectProfile(chosen)
  }

  private projection(): FeishuCardState {
    const access = this.access()
    return {
      ...this.form.state(),
      plugin: this.presence.store.getSnapshot(),
      auth: this.auth.store.getSnapshot(),
      access: this.form.field('access'),
      profile: this.form.field('profile'),
      bridge: this.status,
      // Reuse means the apps belong to other tools, so signing in here is not
      // part of the setup — but it stays reachable, because one of those apps
      // may still be the one that needs a scan.
      authFolded: access === 'reuse' && !this.authOpened,
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
    }
  }

  /**
   * Read what the bridge says about itself.
   *
   * Its own report rather than its configuration file: while dsh is reusing
   * someone else's bridge, that file is theirs and may not even be where this
   * side would look, but what arrives on the live connection is by definition
   * what is in effect.
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
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): FeishuCardFace {
    return {
      hooks: { feishuCard: this.store },
      readPresence: () => { void this.presence.refresh() },
      setEnabled: (enabled) => { void this.presence.setEnabled(enabled) },
      readAuth: () => {
        // 授权动作跟着「dsh 是哪个飞书应用」走，不另选一次：两个地方各选一次的
        // 结果是屏幕上写着一个、扫码授权的是另一个。
        void this.auth.selectProfile(this.form.field('profile').text)
        void this.readBridge()
      },
      selectDomain: (domain, wanted) => { this.auth.select(domain, wanted) },
      beginAuth: () => { void this.auth.begin() },
      cancelAuth: () => { void this.auth.cancel() },
      logout: () => { void this.auth.logout() },
      toggleAuth: () => {
        this.authOpened = !this.authOpened
        this.store.set(this.projection())
      },
      ...this.form.actions(),
    }
  }
}
