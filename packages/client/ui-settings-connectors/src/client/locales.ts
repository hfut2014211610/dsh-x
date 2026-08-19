/** Locale dictionaries for the Connectors settings page and the Feishu card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.connectors'

/** The Connectors dictionary key set. */
export type ConnectorsKey =
  | 'nav' | 'title' | 'intro' | 'empty'
  | 'expand' | 'collapse' | 'unsaved' | 'save' | 'saving' | 'discard'
  | 'saveFailed' | 'readOnly' | 'overridden' | 'reset' | 'invalid'
  | 'state.on' | 'state.off' | 'state.missing' | 'state.loading'
  | 'power.label' | 'power.hint' | 'power.failed'
  | 'power.offNoSettings' | 'power.noSettings'
  | 'auth.heading' | 'auth.loading' | 'auth.reload' | 'auth.absent'
  | 'auth.app' | 'auth.bot' | 'auth.botHint' | 'auth.user' | 'auth.userNone'
  | 'auth.scopes' | 'auth.expires' | 'auth.refreshExpires'
  | 'auth.domains' | 'auth.domainsHint' | 'auth.scan' | 'auth.scanning'
  | 'auth.qrHint' | 'auth.openLink' | 'auth.cancel' | 'auth.granted'
  | 'auth.logout' | 'auth.logoutHint'
  | 'auth.profile' | 'auth.profileOwned' | 'auth.profileForeign'
  | 'auth.unconfigured' | 'auth.unconfiguredHint'
  | 'feishu.name' | 'feishu.summary' | 'feishu.absent'
  | 'feishu.presetId.label' | 'feishu.presetId.hint'
  | 'feishu.density.label' | 'feishu.density.hint'
  | 'feishu.density.compact' | 'feishu.density.standard' | 'feishu.density.detailed'
  | 'feishu.flushMs.label' | 'feishu.flushMs.hint'
  | 'feishu.approvalTimeoutMs.label' | 'feishu.approvalTimeoutMs.hint'
  | 'feishu.endpoint.label' | 'feishu.endpoint.hint'
  | 'feishu.access.label'
  | 'feishu.access.own' | 'feishu.access.ownWhy'
  | 'feishu.access.reuse' | 'feishu.access.reuseWhy'
  | 'feishu.bridge.title' | 'feishu.bridge.lead'
  | 'feishu.eventConfigDirs.label' | 'feishu.eventConfigDirs.hint'
  | 'feishu.cardActionConfigDirs.label' | 'feishu.cardActionConfigDirs.hint'
  | 'feishu.eventEndpoint.label' | 'feishu.eventEndpoint.hint'
  | 'feishu.reach.title' | 'feishu.reach.lead'
  | 'feishu.reach.nobody' | 'feishu.reach.dmOnly' | 'feishu.reach.groupOnly' | 'feishu.reach.both'
  | 'feishu.dmMode.label' | 'feishu.dmMode.hint'
  | 'feishu.dmMode.open' | 'feishu.dmMode.allowlist' | 'feishu.dmMode.disabled'
  | 'feishu.dmAllowlist.label' | 'feishu.dmAllowlist.hint'
  | 'feishu.groupAllowlist.label' | 'feishu.groupAllowlist.hint'
  | 'feishu.requireMention.label' | 'feishu.requireMention.hint'
  | 'feishu.requireMention.on' | 'feishu.requireMention.off'
  | 'feishu.staleMs.label' | 'feishu.staleMs.hint'
  | 'feishu.behaviour.title'
  | 'auth.foldedReuse' | 'auth.unfold' | 'auth.fold'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connectors page chrome, card chrome, and the Feishu connector's fields. */
    'settings.connectors': ConnectorsKey
  }
}

/** English copy. */
export const en: Record<ConnectorsKey, string> = {
  nav: 'Connectors',
  title: 'Connectors',
  intro: 'Reach dsh from an app you already work in. One entry per channel; each is a host plugin, and this page edits how it behaves, never its credentials.',
  empty: 'This deployment composes no connector.',
  expand: 'Expand',
  collapse: 'Collapse',
  unsaved: 'Unsaved',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The host did not take every change. Your edits are still here — fix them and save again.',
  readOnly: 'This client cannot write the settings document.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Not a value this field takes.',
  'state.on': 'Connected',
  'state.off': 'Switched off',
  'state.missing': 'Not installed',
  'state.loading': 'Checking…',
  'power.label': 'Run this channel',
  'power.hint': 'Switches the channel’s plugin on and off in this profile, and the change is written back — so it survives a restart. Anything the channel needs outside dsh, such as a bridge process, is still yours to start.',
  'power.failed': 'The host did not take the switch. The state above is what the plugin tree reports now.',
  'power.offNoSettings': 'Switched off, so it serves no settings to edit. Switch it on to see its controls.',
  'power.noSettings': 'Running, but it registers no settings namespace, so there is nothing here to edit. How it behaves is fixed by however it was composed.',
  'auth.heading': 'Sign-in and permissions',
  'auth.loading': 'Reading the sign-in state…',
  'auth.reload': 'Read again',
  'auth.absent': 'lark-cli is not on this machine. The channel talks to Feishu through it, and so does this page — install it with npm i -g @larksuite/cli, then run lark-cli config init once to bind an app.',
  'auth.app': 'App',
  'auth.bot': 'Bot identity',
  'auth.botHint': 'A bot’s permissions are granted in the Feishu developer console, never by scanning. Scanning authorizes you, not it.',
  'auth.user': 'Your identity',
  'auth.userNone': 'Nobody has scanned yet.',
  'auth.scopes': 'granted permissions',
  'auth.expires': 'Session expires',
  'auth.refreshExpires': 'Sign in again by',
  'auth.domains': 'Permissions to grant this time',
  'auth.domainsHint': 'Grants accumulate: clearing a box does not take back a permission already given. Revoking is done in Feishu’s authorization manager.',
  'auth.scan': 'Scan to authorize',
  'auth.scanning': 'Fetching the code…',
  'auth.qrHint': 'Scan this with Feishu, or open the link below. This page continues on its own once you are done.',
  'auth.openLink': 'Open the authorization link',
  'auth.cancel': 'Cancel',
  'auth.granted': 'Authorized.',
  'auth.logout': 'Sign out on this machine',
  'auth.logoutHint': 'Clears the token here only. What you granted the app in Feishu stays granted; take it back in Feishu’s authorization manager.',
  'auth.profile': 'Acting on',
  'auth.profileOwned': 'dsh’s own app.',
  'auth.profileForeign': 'This app belongs to another tool on this machine. Authorizing adds permissions to it, and signing out signs that tool out — not dsh.',
  'auth.unconfigured': 'No app is bound to this profile yet, so there is nothing to authorize.',
  'auth.unconfiguredHint': 'Bind one first: run lark-cli config init --new with LARKSUITE_CLI_CONFIG_DIR set to the directory above, then come back.',
  'feishu.name': 'Feishu',
  'feishu.summary': 'One line in a DM starts work; an @ in a group picks it up. Progress rides a card that updates in stages.',
  'feishu.absent': 'Not in this deployment. Add it with dsh plugin --profile web add <plugin directory> — this fork keeps it at personal/plugins/dsh-x-feishu, which the packaged app does not carry. Credentials stay with the bridge process; nothing on this page touches them.',
  'feishu.presetId.label': 'Agent preset',
  'feishu.presetId.hint': 'Which preset a session opened from Feishu runs. Empty takes the deployment default.',
  'feishu.density.label': 'Card density',
  'feishu.density.hint': 'How much of a turn the card shows.',
  'feishu.density.compact': 'compact',
  'feishu.density.standard': 'standard',
  'feishu.density.detailed': 'detailed',
  'feishu.flushMs.label': 'Card refresh interval (ms)',
  'feishu.flushMs.hint': 'Shortest gap between two pushes of the card body. One lark-cli call costs about 300ms, so below that the pushes queue up.',
  'feishu.approvalTimeoutMs.label': 'Approval timeout (ms)',
  'feishu.approvalTimeoutMs.hint': 'How long an approval card waits for a tap before the tool call is refused.',
  'feishu.endpoint.label': 'Bridge endpoint',
  'feishu.endpoint.hint': 'Local socket to the bridge process. Empty takes the platform default: a named pipe on Windows, a unix socket elsewhere.',
  'feishu.access.label': 'How dsh gets its Feishu events',
  'feishu.access.own': 'Its own Feishu app',
  'feishu.access.ownWhy': 'dsh has an app of its own and you authorize it below. This is the ordinary setup.',
  'feishu.access.reuse': 'Read from the shared bridge',
  'feishu.access.reuseWhy': 'The bridge already subscribes for other agents; dsh reads from that subscription instead of taking one of its own.',
  'feishu.bridge.title': 'Shared subscription',
  'feishu.bridge.lead': 'Feishu admits exactly one consumer per event key on a machine. So the bridge holds that one subscription for every app listed here and relays what arrives; any number of agents — dsh among them — read from the relay. Each app keeps its own identity, so a reply goes out as the bot that was spoken to. What the apps are is not dsh’s to decide: name the lark-cli profile directories whose owners already set them up.',
  'feishu.eventConfigDirs.label': 'Apps to subscribe on',
  'feishu.eventConfigDirs.hint': 'One lark-cli profile directory per line. Empty means dsh’s own app, and nothing is shared.',
  'feishu.cardActionConfigDirs.label': 'Apps whose card taps come back',
  'feishu.cardActionConfigDirs.hint': 'Card callbacks only arrive for an app that subscribed card.action.trigger in the developer console. Empty means all of the apps above — list a subset if only some of them did.',
  'feishu.eventEndpoint.label': 'Relay endpoint',
  'feishu.eventEndpoint.hint': 'Local socket other agents read the raw events from. Empty takes the platform default.',
  'feishu.reach.title': 'Who may use it',
  'feishu.reach.lead': 'Denied by default, and deliberately: a channel into an agent that runs tools is not something to leave open while you work out the rest.',
  'feishu.reach.nobody': 'As set, nobody can reach it — direct messages are refused and no group is listed.',
  'feishu.reach.dmOnly': 'As set, direct messages get through; no group is listed.',
  'feishu.reach.groupOnly': 'As set, the listed groups get through; direct messages are refused.',
  'feishu.reach.both': 'As set, both direct messages and the listed groups get through.',
  'feishu.dmMode.label': 'Direct messages',
  'feishu.dmMode.hint': 'Who may open a one-to-one conversation.',
  'feishu.dmMode.open': 'anyone',
  'feishu.dmMode.allowlist': 'listed people only',
  'feishu.dmMode.disabled': 'nobody',
  'feishu.dmAllowlist.label': 'People allowed to DM',
  'feishu.dmAllowlist.hint': 'One open_id per line. Only read when direct messages are set to listed people only.',
  'feishu.groupAllowlist.label': 'Groups served',
  'feishu.groupAllowlist.hint': 'One chat_id per line. Empty means no group at all, not every group.',
  'feishu.requireMention.label': 'Require an @ in groups',
  'feishu.requireMention.hint': 'With this off, every message in a listed group starts a turn.',
  'feishu.requireMention.on': 'yes, only when @-ed',
  'feishu.requireMention.off': 'no, any message',
  'feishu.staleMs.label': 'Message freshness (ms)',
  'feishu.staleMs.hint': 'Messages older than this are dropped, so a reconnect does not replay yesterday’s conversation.',
  'feishu.behaviour.title': 'How a session behaves',
  'auth.foldedReuse': 'The apps above belong to whoever set them up, so signing in is not part of this route. Open it anyway if one of them is yours to authorize.',
  'auth.unfold': 'Open',
  'auth.fold': 'Fold away',
}

/** Simplified Chinese copy. */
export const zh: Record<ConnectorsKey, string> = {
  nav: '连接器',
  title: '连接器',
  intro: '让 dsh 接进你本来就在用的应用。一个渠道一条，每条背后是一个宿主插件；这一页改的是它怎么干活，不碰凭证。',
  empty: '这个部署没有装任何连接器。',
  expand: '展开',
  collapse: '收起',
  unsaved: '未保存',
  save: '保存',
  saving: '正在保存…',
  discard: '放弃修改',
  saveFailed: '有改动宿主没收下。改的内容还在，改完再存一次。',
  readOnly: '这个客户端不能写配置文件。',
  overridden: '已改过',
  reset: '恢复默认',
  invalid: '这个字段不收这种值。',
  'state.on': '已接入',
  'state.off': '已停用',
  'state.missing': '未安装',
  'state.loading': '正在查…',
  'power.label': '启用这个渠道',
  'power.hint': '在这个 profile 里开关渠道插件，改动会写回配置，重启后还在。渠道在 dsh 之外还需要的东西——比如桥接进程——仍然要你自己起。',
  'power.failed': '宿主没收下这次开关。上面显示的是插件树现在的状态。',
  'power.offNoSettings': '停用状态下它不提供任何配置项。启用后才能看到它的设置。',
  'power.noSettings': '正在运行，但它没有注册配置命名空间，所以这里没有可改的东西。它怎么干活由挂载时的组合决定。',
  'auth.heading': '登录与权限',
  'auth.loading': '正在读登录态…',
  'auth.reload': '重新读',
  'auth.absent': '这台机器上没有 lark-cli。渠道和这一页都靠它跟飞书说话——用 npm i -g @larksuite/cli 装上，再跑一次 lark-cli config init 绑定应用。',
  'auth.app': '应用',
  'auth.bot': '机器人身份',
  'auth.botHint': '机器人的权限在飞书开发者后台开通，扫码给不了它——扫码授权的是你，不是它。',
  'auth.user': '你的身份',
  'auth.userNone': '还没有人扫码授权。',
  'auth.scopes': '项已授权',
  'auth.expires': '登录态到期',
  'auth.refreshExpires': '需在此前重新登录',
  'auth.domains': '这次要开通的权限',
  'auth.domainsHint': '授权是累加的：取消勾选不会收回已经给过的权限，要收回得去飞书的授权管理页。',
  'auth.scan': '扫码授权',
  'auth.scanning': '正在取二维码…',
  'auth.qrHint': '用飞书扫这张码，或者打开下面的链接。扫完这一页会自己往下走。',
  'auth.openLink': '打开授权链接',
  'auth.cancel': '取消',
  'auth.granted': '授权成功。',
  'auth.logout': '退出本机登录',
  'auth.logoutHint': '只清这台机器上的登录态。你在飞书那边给应用的授权还在，要收回得去飞书的授权管理页。',
  'auth.profile': '作用在',
  'auth.profileOwned': 'dsh 自己的应用。',
  'auth.profileForeign': '这个应用属于这台机器上的别的工具。在这里授权是往它上面加权限，退出登录退的也是它，不是 dsh。',
  'auth.unconfigured': '这份 profile 还没绑应用，所以没有可授权的对象。',
  'auth.unconfiguredHint': '先绑一个：把 LARKSUITE_CLI_CONFIG_DIR 设成上面那个目录，跑一次 lark-cli config init --new，然后回来。',
  'feishu.name': '飞书',
  'feishu.summary': '单聊发一句话就干活，群里 @ 一下就接活，过程在一张分阶段更新的卡片上。',
  'feishu.absent': '这个部署里没有。用 dsh plugin --profile web add <插件目录> 挂进来——本 fork 放在 personal/plugins/dsh-x-feishu，安装包里不带。凭证在桥接进程手里，这一页碰不到。',
  'feishu.presetId.label': 'Agent 预设',
  'feishu.presetId.hint': '飞书开的会话用哪个预设。留空用部署默认。',
  'feishu.density.label': '卡片密度',
  'feishu.density.hint': '一轮里有多少内容会显示在卡片上。',
  'feishu.density.compact': '精简',
  'feishu.density.standard': '标准',
  'feishu.density.detailed': '详细',
  'feishu.flushMs.label': '卡片刷新间隔（毫秒）',
  'feishu.flushMs.hint': '卡片正文两次推送之间最少隔多久。一次 lark-cli 调用约 300 毫秒，比这更短推送就会堆积。',
  'feishu.approvalTimeoutMs.label': '审批等待上限（毫秒）',
  'feishu.approvalTimeoutMs.hint': '审批卡片等人点多久，超时就按拒绝处理。',
  'feishu.endpoint.label': '桥接端点',
  'feishu.endpoint.hint': '连到桥接进程的本地 socket。留空用平台默认：Windows 走命名管道，其他系统走 unix socket。',
  'feishu.access.label': '飞书的消息怎么进到 dsh',
  'feishu.access.own': '用 dsh 自己的应用',
  'feishu.access.ownWhy': 'dsh 有一个自己的飞书应用，在下面扫码授权就能用。一般都走这条。',
  'feishu.access.reuse': '复用桥接已有的订阅',
  'feishu.access.reuseWhy': '桥接已经在替别的 agent 订阅了，dsh 从那份订阅里读，不再自己占一份。',
  'feishu.bridge.title': '共用的订阅',
  'feishu.bridge.lead': '同一台机器上，飞书的一个 event key 只允许一个消费者。所以桥接替下面每个应用各持有那唯一的一份订阅，收到什么就广播出去，任意多个 agent（包括 dsh）从广播里读。每个应用的身份是分开的，谁被搭话就由谁回话。这些应用不归 dsh 管——填的是别人已经配好的那些 lark-cli profile 目录。',
  'feishu.eventConfigDirs.label': '订阅哪几个应用',
  'feishu.eventConfigDirs.hint': '一行一个 lark-cli profile 目录。留空表示只用 dsh 自己的应用，不与谁共用。',
  'feishu.cardActionConfigDirs.label': '哪几个应用的卡片点击会回来',
  'feishu.cardActionConfigDirs.hint': '只有在开发者后台订阅过 card.action.trigger 的应用才收得到卡片回调。留空表示上面全部；只有一部分订阅过，就把那一部分列出来。',
  'feishu.eventEndpoint.label': '广播端点',
  'feishu.eventEndpoint.hint': '其他 agent 从这个本地 socket 读原始事件。留空用平台默认。',
  'feishu.reach.title': '谁能用',
  'feishu.reach.lead': '默认谁都不放行，这是故意的：一条通往会跑工具的 agent 的入口，不该在你还没想清楚之前先开着。',
  'feishu.reach.nobody': '照现在的设置，没有人能用它——私聊不收，群也一个都没列。',
  'feishu.reach.dmOnly': '照现在的设置，私聊能进来；群一个都没列。',
  'feishu.reach.groupOnly': '照现在的设置，列出的群能进来；私聊不收。',
  'feishu.reach.both': '照现在的设置，私聊和列出的群都能进来。',
  'feishu.dmMode.label': '私聊',
  'feishu.dmMode.hint': '谁可以单独找它说话。',
  'feishu.dmMode.open': '谁都可以',
  'feishu.dmMode.allowlist': '只认名单里的人',
  'feishu.dmMode.disabled': '谁都不行',
  'feishu.dmAllowlist.label': '允许私聊的人',
  'feishu.dmAllowlist.hint': '一行一个 open_id。只在私聊设为「只认名单里的人」时才读它。',
  'feishu.groupAllowlist.label': '放行的群',
  'feishu.groupAllowlist.hint': '一行一个 chat_id。留空是一个群都不放行，不是全部放行。',
  'feishu.requireMention.label': '群里必须 @ 才接活',
  'feishu.requireMention.hint': '关掉之后，放行的群里每一句话都会起一轮。',
  'feishu.requireMention.on': '是，@ 到才接',
  'feishu.requireMention.off': '否，说什么都接',
  'feishu.staleMs.label': '消息保鲜期（毫秒）',
  'feishu.staleMs.hint': '比这更老的消息直接丢掉，免得断线重连之后把昨天的话重放一遍。',
  'feishu.behaviour.title': '会话怎么跑',
  'auth.foldedReuse': '上面那些应用归配置它们的人管，登录不是这条路上的事。要是其中有一个该由你授权，也可以打开。',
  'auth.unfold': '展开',
  'auth.fold': '收起',
}
