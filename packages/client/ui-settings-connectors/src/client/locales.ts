/** Locale dictionaries for the Connectors settings page and the Feishu card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.connectors'

/** The Connectors dictionary key set. */
export type ConnectorsKey =
  | 'nav' | 'title' | 'intro' | 'empty'
  | 'expand' | 'collapse' | 'unsaved' | 'save' | 'saving' | 'discard'
  | 'saveFailed' | 'readOnly' | 'overridden' | 'reset' | 'invalid'
  | 'state.on' | 'state.off' | 'state.missing' | 'state.loading'
  | 'power.label' | 'power.hint' | 'power.failed' | 'power.offNoSettings'
  | 'feishu.name' | 'feishu.summary' | 'feishu.absent'
  | 'feishu.presetId.label' | 'feishu.presetId.hint'
  | 'feishu.density.label' | 'feishu.density.hint'
  | 'feishu.density.compact' | 'feishu.density.standard' | 'feishu.density.detailed'
  | 'feishu.flushMs.label' | 'feishu.flushMs.hint'
  | 'feishu.approvalTimeoutMs.label' | 'feishu.approvalTimeoutMs.hint'
  | 'feishu.endpoint.label' | 'feishu.endpoint.hint'

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
}
