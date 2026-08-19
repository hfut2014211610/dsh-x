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

/**
 * How this deployment gets its Feishu events.
 *
 * `own` — dsh has its own Feishu app and you authorize it here. `reuse` — the
 * bridge already subscribes on behalf of other agents and dsh reads from that
 * subscription, because one event key admits exactly one consumer machine-wide.
 */
export type FeishuAccess = 'own' | 'reuse'

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
  /** lark-cli profile directories the bridge subscribes on; empty means dsh's own app. */
  eventConfigDirs?: string[]
  /** Profiles whose card callbacks are subscribed in the console; empty means the same as above. */
  cardActionConfigDirs?: string[]
  /** Local socket other agents read raw Feishu events from; empty takes the platform default. */
  eventEndpoint?: string
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
  access: FeishuAccess
  /** Whether the sign-in section is folded away, which reuse does by default. */
  authFolded: boolean
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
  /** Subscribed Feishu apps field. */
  eventConfigDirs: ConnectorFieldState
  /** Card-callback apps field. */
  cardActionConfigDirs: ConnectorFieldState
  /** Event relay endpoint field. */
  eventEndpoint: ConnectorFieldState
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
  /** Point every sign-in action at a different lark-cli profile. */
  selectProfile: (configDir: string) => void
  /** Check or clear one permission domain for the next scan. */
  selectDomain: (domain: string, wanted: boolean) => void
  /** Start a scan-to-authorize. */
  beginAuth: () => void
  /** Abandon the scan in flight. */
  cancelAuth: () => void
  /** Sign out on this machine. */
  logout: () => void
  /** Switch between running dsh's own app and reading from the shared bridge. */
  setAccess: (access: FeishuAccess) => void
  /** Unfold or refold the sign-in section. */
  toggleAuth: () => void
}

/** Bridges the `dsh-x-feishu` scope onto the Feishu card's staged form. */
export class FeishuCardController {
  private readonly form: ConnectorForm<FeishuSettings>
  private readonly presence: ConnectorPresenceController
  private readonly auth: FeishuAuthController
  private readonly store: SnapshotStore<FeishuCardState>
  /**
   * The branch the reader picked, when they picked one.
   *
   * Not a stored setting. Which apps the bridge listens on is the fact; the
   * branch is only how this card presents it, so it starts on whichever branch
   * matches the data and a stored copy could only ever disagree with it.
   */
  private chosen: FeishuAccess | undefined
  /** Whether the reader unfolded the sign-in section that reuse folds away. */
  private authOpened = false

  /**
   * @param scope - the bound settings scope for the `dsh-x-feishu` namespace.
   * @param plugins - the plugin-tree calls the card's switch runs on.
   * @param rpc - the connection's raw RPC channel, where `feishuAuth/*` lives.
   */
  constructor(scope: SettingsScope<FeishuSettings>, plugins: ConnectorPluginFace, rpc: AuthRpc) {
    this.form = new ConnectorForm(scope, [
      textField('presetId'),
      choiceField('density', FEISHU_DENSITIES),
      durationField('flushMs'),
      durationField('approvalTimeoutMs'),
      textField('endpoint'),
      listField('eventConfigDirs'),
      listField('cardActionConfigDirs'),
      textField('eventEndpoint'),
      choiceField('dmMode', FEISHU_DM_MODES),
      listField('dmAllowlist'),
      listField('groupAllowlist'),
      toggleField('requireMention'),
      durationField('staleMs'),
    ])
    this.presence = new ConnectorPresenceController(FEISHU_MODULE, plugins)
    this.auth = new FeishuAuthController(rpc)
    this.store = this.form.bind(() => this.projection())
    // Switching the plugin changes the pill, the switch, and whether there are
    // controls at all, so the card republishes on either source.
    this.presence.store.subscribe(() => { this.store.set(this.projection()) })
    this.auth.store.subscribe(() => { this.store.set(this.projection()) })
  }

  /**
   * Which branch the card shows: the reader's pick, else whichever one the
   * data is already on. A non-empty app list is what reuse looks like.
   * @returns the branch in effect.
   */
  private access(): FeishuAccess {
    if (this.chosen !== undefined) return this.chosen
    return this.form.field('eventConfigDirs').text.trim() === '' ? 'own' : 'reuse'
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
    const mode = this.form.field('dmMode').text
    const dm = mode === 'open' || (mode !== 'disabled' && this.form.field('dmAllowlist').text.trim() !== '')
    const group = this.form.field('groupAllowlist').text.trim() !== ''
    if (dm && group) return 'both'
    if (dm) return 'dm-only'
    return group ? 'group-only' : 'nobody'
  }

  private projection(): FeishuCardState {
    const access = this.access()
    return {
      ...this.form.state(),
      plugin: this.presence.store.getSnapshot(),
      auth: this.auth.store.getSnapshot(),
      access,
      // Reuse means the apps belong to other tools, so signing in here is not
      // part of the setup — but it stays reachable, because one of those apps
      // may still be the one that needs a scan.
      authFolded: access === 'reuse' && !this.authOpened,
      presetId: this.form.field('presetId'),
      density: this.form.field('density'),
      flushMs: this.form.field('flushMs'),
      approvalTimeoutMs: this.form.field('approvalTimeoutMs'),
      endpoint: this.form.field('endpoint'),
      eventConfigDirs: this.form.field('eventConfigDirs'),
      cardActionConfigDirs: this.form.field('cardActionConfigDirs'),
      eventEndpoint: this.form.field('eventEndpoint'),
      dmMode: this.form.field('dmMode'),
      dmAllowlist: this.form.field('dmAllowlist'),
      groupAllowlist: this.form.field('groupAllowlist'),
      requireMention: this.form.field('requireMention'),
      staleMs: this.form.field('staleMs'),
      reach: this.reach(),
    }
  }

  /**
   * Switch branches.
   *
   * Picking "own app" clears the subscribed-app list, because that list IS the
   * other branch — leaving it filled in would put the card on one branch and
   * the bridge on the other. Picking "reuse" only reveals the list; what to
   * put in it is the reader's to say.
   * @param access - the branch to show.
   */
  private setAccess(access: FeishuAccess): void {
    this.chosen = access
    if (access === 'own') {
      const actions = this.form.actions()
      actions.edit('eventConfigDirs', '')
      actions.edit('cardActionConfigDirs', '')
      return
    }
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
      readAuth: () => { void this.auth.load() },
      selectProfile: (configDir) => { void this.auth.selectProfile(configDir) },
      selectDomain: (domain, wanted) => { this.auth.select(domain, wanted) },
      beginAuth: () => { void this.auth.begin() },
      cancelAuth: () => { void this.auth.cancel() },
      logout: () => { void this.auth.logout() },
      setAccess: (access) => { this.setAccess(access) },
      toggleAuth: () => {
        this.authOpened = !this.authOpened
        this.store.set(this.projection())
      },
      ...this.form.actions(),
    }
  }
}
