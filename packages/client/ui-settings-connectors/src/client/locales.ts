/** Locale dictionaries for the Connectors settings page and the Feishu card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.connectors'

/** The Connectors dictionary key set. */
export type ConnectorsKey =
  | 'nav' | 'title' | 'intro' | 'empty'
  | 'expand' | 'collapse' | 'unsaved' | 'save' | 'saving' | 'discard'
  | 'saveFailed' | 'readOnly' | 'overridden' | 'reset' | 'invalid'
  | 'state.on' | 'state.off' | 'state.missing' | 'state.loading' | 'state.unset'
  | 'power.label' | 'power.hint' | 'power.failed'
  | 'power.offNoSettings' | 'power.noSettings'
  | 'auth.loading' | 'auth.reload' | 'auth.absent'
  | 'auth.scopes' | 'auth.domains' | 'auth.scan' | 'auth.scanning'
  | 'auth.qrHint' | 'auth.openLink' | 'auth.cancel' | 'auth.granted'
  | 'auth.unconfigured' | 'auth.bind' | 'auth.binding'
  | 'feishu.name' | 'feishu.summary' | 'feishu.absent'
  | 'feishu.mode.label' | 'feishu.mode.direct' | 'feishu.mode.directWhy'
  | 'feishu.mode.bridge' | 'feishu.mode.bridgeWhy'
  | 'feishu.profileId.label' | 'feishu.profileId.hint'
  | 'feishu.appId.label' | 'feishu.appId.hint'
  | 'feishu.eventCommand.label' | 'feishu.eventCommand.hint'
  | 'feishu.status.title' | 'feishu.status.mode' | 'feishu.status.app' | 'feishu.status.user'
  | 'feishu.status.bridge' | 'feishu.status.bridgeOn' | 'feishu.status.bridgeOff'
  | 'feishu.action.reregister' | 'feishu.action.hideSetup'
  | 'feishu.action.reset' | 'feishu.action.resetConfirm'
  | 'feishu.settings.title'
  | 'feishu.workspace.label' | 'feishu.workspace.hint'
  | 'feishu.presetId.label' | 'feishu.presetId.hint'
  | 'feishu.density.label' | 'feishu.density.hint'
  | 'feishu.density.compact' | 'feishu.density.standard' | 'feishu.density.detailed'
  | 'feishu.flushMs.label' | 'feishu.flushMs.hint'
  | 'feishu.approvalTimeoutMs.label' | 'feishu.approvalTimeoutMs.hint'
  | 'feishu.endpoint.label' | 'feishu.endpoint.hint'
  | 'feishu.reach.nobody' | 'feishu.reach.dmOnly' | 'feishu.reach.groupOnly' | 'feishu.reach.both'
  | 'feishu.dmMode.label' | 'feishu.dmMode.hint'
  | 'feishu.dmMode.open' | 'feishu.dmMode.allowlist' | 'feishu.dmMode.disabled'
  | 'feishu.dmAllowlist.label' | 'feishu.dmAllowlist.hint'
  | 'feishu.groupAllowlist.label' | 'feishu.groupAllowlist.hint'
  | 'feishu.requireMention.label' | 'feishu.requireMention.hint'
  | 'feishu.requireMention.on' | 'feishu.requireMention.off'
  | 'feishu.staleMs.label' | 'feishu.staleMs.hint'

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
  intro: 'Reach dsh from an app you already work in.',
  empty: 'This deployment composes no connector.',
  expand: 'Expand',
  collapse: 'Collapse',
  unsaved: 'Unsaved',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The host did not take every change. Your edits are still here.',
  readOnly: 'This client cannot write the settings document.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Not a value this field takes.',
  'state.on': 'Connected',
  'state.off': 'Switched off',
  'state.missing': 'Not installed',
  'state.loading': 'Checking…',
  'state.unset': 'Not set up',
  'power.label': 'Run this channel',
  'power.hint': 'Switches the plugin on and off in this profile. Anything it needs outside dsh, such as a bridge process, is still yours to start.',
  'power.failed': 'The host did not take the switch.',
  'power.offNoSettings': 'Switched off, so it serves no settings to edit.',
  'power.noSettings': 'Running, but it registers no settings namespace.',
  'auth.loading': 'Reading…',
  'auth.reload': 'Read again',
  'auth.absent': 'lark-cli is not on this machine. Install it with npm i -g @larksuite/cli.',
  'auth.scopes': 'permissions',
  'auth.domains': 'Permissions to grant',
  'auth.scan': 'Scan to authorize',
  'auth.scanning': 'Fetching the code…',
  'auth.qrHint': 'Scan with Feishu, or open the link. This page continues on its own.',
  'auth.openLink': 'Open the authorization link',
  'auth.cancel': 'Cancel',
  'auth.granted': 'Authorized.',
  'auth.unconfigured': 'This profile has no Feishu app yet.',
  'auth.bind': 'Create the app',
  'auth.binding': 'Opening…',
  'feishu.name': 'Feishu',
  'feishu.summary': 'One line in a DM starts work; an @ in a group picks it up.',
  'feishu.absent': 'Not in this deployment. Add it with dsh plugin --profile web add <plugin directory>.',
  'feishu.mode.label': 'How to connect',
  'feishu.mode.direct': 'lark-cli',
  'feishu.mode.directWhy': 'Scan a code and you are done.',
  'feishu.mode.bridge': 'Third-party bridge',
  'feishu.mode.bridgeWhy': 'Events come from another process. Advanced; you probably do not want this.',
  'feishu.profileId.label': 'Profile',
  'feishu.profileId.hint': 'A lark-cli profile name, under ~/.lark-cli.',
  'feishu.appId.label': 'App id',
  'feishu.appId.hint': 'The Feishu app those events belong to.',
  'feishu.eventCommand.label': 'Event command',
  'feishu.eventCommand.hint': 'Stands in for `lark-cli event consume`; the event key is appended. It must print one JSON event per line.',
  'feishu.status.title': 'Connection',
  'feishu.status.mode': 'Through',
  'feishu.status.app': 'App',
  'feishu.status.user': 'You',
  'feishu.status.bridge': 'Bridge',
  'feishu.status.bridgeOn': 'running',
  'feishu.status.bridgeOff': 'not running',
  'feishu.action.reregister': 'Register again',
  'feishu.action.hideSetup': 'Done',
  'feishu.action.reset': 'Sign out and clear',
  'feishu.action.resetConfirm': 'Tap again to confirm',
  'feishu.settings.title': 'Session settings',
  'feishu.workspace.label': 'Workspace',
  'feishu.workspace.hint': 'Where a session from Feishu runs. Empty keeps them out of your projects, under Ungrouped.',
  'feishu.presetId.label': 'Agent preset',
  'feishu.presetId.hint': 'Empty takes the deployment default.',
  'feishu.density.label': 'Card density',
  'feishu.density.hint': 'How much of a turn the card shows.',
  'feishu.density.compact': 'compact',
  'feishu.density.standard': 'standard',
  'feishu.density.detailed': 'detailed',
  'feishu.flushMs.label': 'Card refresh interval (ms)',
  'feishu.flushMs.hint': 'One lark-cli call costs about 300ms, so below that the pushes queue up.',
  'feishu.approvalTimeoutMs.label': 'Approval timeout (ms)',
  'feishu.approvalTimeoutMs.hint': 'How long an approval card waits before the tool call is refused.',
  'feishu.endpoint.label': 'Bridge endpoint',
  'feishu.endpoint.hint': 'Empty takes the platform default.',
  'feishu.reach.nobody': 'As set, nobody can reach it.',
  'feishu.reach.dmOnly': 'As set, direct messages get through.',
  'feishu.reach.groupOnly': 'As set, the listed groups get through.',
  'feishu.reach.both': 'As set, direct messages and the listed groups get through.',
  'feishu.dmMode.label': 'Direct messages',
  'feishu.dmMode.hint': 'Who may open a one-to-one conversation.',
  'feishu.dmMode.open': 'anyone',
  'feishu.dmMode.allowlist': 'listed people only',
  'feishu.dmMode.disabled': 'nobody',
  'feishu.dmAllowlist.label': 'People allowed to DM',
  'feishu.dmAllowlist.hint': 'One open_id per line.',
  'feishu.groupAllowlist.label': 'Groups served',
  'feishu.groupAllowlist.hint': 'One chat_id per line. Empty means no group at all.',
  'feishu.requireMention.label': 'Require an @ in groups',
  'feishu.requireMention.hint': 'With this off, every message in a listed group starts a turn.',
  'feishu.requireMention.on': 'yes, only when @-ed',
  'feishu.requireMention.off': 'no, any message',
  'feishu.staleMs.label': 'Message freshness (ms)',
  'feishu.staleMs.hint': 'Older messages are dropped, so a reconnect does not replay them.',
}

/** Simplified Chinese copy. */
export const zh: Record<ConnectorsKey, string> = {
  nav: '连接器',
  title: '连接器',
  intro: '让 dsh 接进你本来就在用的应用。',
  empty: '这个部署没有装任何连接器。',
  expand: '展开',
  collapse: '收起',
  unsaved: '未保存',
  save: '保存',
  saving: '正在保存…',
  discard: '放弃修改',
  saveFailed: '有改动宿主没收下。改的内容还在。',
  readOnly: '这个客户端不能写配置文件。',
  overridden: '已改过',
  reset: '恢复默认',
  invalid: '这个字段不收这种值。',
  'state.on': '已接入',
  'state.off': '已停用',
  'state.missing': '未安装',
  'state.loading': '正在查…',
  'state.unset': '未接入',
  'power.label': '启用这个渠道',
  'power.hint': '在这个 profile 里开关渠道插件。渠道在 dsh 之外还需要的东西——比如桥接进程——仍然要你自己起。',
  'power.failed': '宿主没收下这次开关。',
  'power.offNoSettings': '停用状态下它不提供任何配置项。',
  'power.noSettings': '正在运行，但它没有注册配置命名空间。',
  'auth.loading': '正在读…',
  'auth.reload': '重新读',
  'auth.absent': '这台机器上没有 lark-cli。用 npm i -g @larksuite/cli 装上。',
  'auth.scopes': '项权限',
  'auth.domains': '要开通的权限',
  'auth.scan': '扫码授权',
  'auth.scanning': '正在取二维码…',
  'auth.qrHint': '用飞书扫码，或者打开下面的链接。扫完这一页会自己往下走。',
  'auth.openLink': '打开授权链接',
  'auth.cancel': '取消',
  'auth.granted': '授权成功。',
  'auth.unconfigured': '这份 profile 还没有飞书应用。',
  'auth.bind': '创建应用',
  'auth.binding': '正在打开…',
  'feishu.name': '飞书',
  'feishu.summary': '单聊发一句话就干活，群里 @ 一下就接活。',
  'feishu.absent': '这个部署里没有。用 dsh plugin --profile web add <插件目录> 挂进来。',
  'feishu.mode.label': '怎么接',
  'feishu.mode.direct': 'lark-cli 接入',
  'feishu.mode.directWhy': '扫个码就好了。',
  'feishu.mode.bridge': '第三方桥接',
  'feishu.mode.bridgeWhy': '事件由别的进程供给。高级用法，一般用不上。',
  'feishu.profileId.label': 'Profile',
  'feishu.profileId.hint': 'lark-cli 的 profile 名，落在 ~/.lark-cli 下面。',
  'feishu.appId.label': 'App id',
  'feishu.appId.hint': '那些事件属于哪个飞书应用。',
  'feishu.eventCommand.label': '事件命令',
  'feishu.eventCommand.hint': '替代 `lark-cli event consume`，事件键追加在最后。它要一行一条 JSON 事件地往外打。',
  'feishu.status.title': '接入情况',
  'feishu.status.mode': '走的是',
  'feishu.status.app': '应用',
  'feishu.status.user': '你',
  'feishu.status.bridge': '桥接',
  'feishu.status.bridgeOn': '在跑',
  'feishu.status.bridgeOff': '没在跑',
  'feishu.action.reregister': '重新注册',
  'feishu.action.hideSetup': '好了',
  'feishu.action.reset': '注销配置',
  'feishu.action.resetConfirm': '再点一次确认',
  'feishu.settings.title': '会话设置',
  'feishu.workspace.label': '工作区',
  'feishu.workspace.hint': '飞书开的会话落在哪个目录。留空不进你的项目，归在「未分组」下。',
  'feishu.presetId.label': 'Agent 预设',
  'feishu.presetId.hint': '留空用部署默认。',
  'feishu.density.label': '卡片密度',
  'feishu.density.hint': '一轮里有多少内容会显示在卡片上。',
  'feishu.density.compact': '精简',
  'feishu.density.standard': '标准',
  'feishu.density.detailed': '详细',
  'feishu.flushMs.label': '卡片刷新间隔（毫秒）',
  'feishu.flushMs.hint': '一次 lark-cli 调用约 300 毫秒，比这更短推送就会堆积。',
  'feishu.approvalTimeoutMs.label': '审批等待上限（毫秒）',
  'feishu.approvalTimeoutMs.hint': '审批卡片等多久，超时按拒绝处理。',
  'feishu.endpoint.label': '桥接端点',
  'feishu.endpoint.hint': '留空用平台默认。',
  'feishu.reach.nobody': '照现在的设置，没有人能用它。',
  'feishu.reach.dmOnly': '照现在的设置，私聊能进来。',
  'feishu.reach.groupOnly': '照现在的设置，列出的群能进来。',
  'feishu.reach.both': '照现在的设置，私聊和列出的群都能进来。',
  'feishu.dmMode.label': '私聊',
  'feishu.dmMode.hint': '谁可以单独找它说话。',
  'feishu.dmMode.open': '谁都可以',
  'feishu.dmMode.allowlist': '只认名单里的人',
  'feishu.dmMode.disabled': '谁都不行',
  'feishu.dmAllowlist.label': '允许私聊的人',
  'feishu.dmAllowlist.hint': '一行一个 open_id。',
  'feishu.groupAllowlist.label': '放行的群',
  'feishu.groupAllowlist.hint': '一行一个 chat_id。留空是一个群都不放行。',
  'feishu.requireMention.label': '群里必须 @ 才接活',
  'feishu.requireMention.hint': '关掉之后，放行的群里每一句话都会起一轮。',
  'feishu.requireMention.on': '是，@ 到才接',
  'feishu.requireMention.off': '否，说什么都接',
  'feishu.staleMs.label': '消息保鲜期（毫秒）',
  'feishu.staleMs.hint': '比这更老的消息直接丢掉，免得断线重连之后重放。',
}
