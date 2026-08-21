/** Locale dictionaries for the dedicated Werewolf view. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'ui-werewolf'

/** The Werewolf dictionary key set. */
export type WerewolfKey =
  | 'view.werewolf'
  | 'lobby.title' | 'lobby.subtitle' | 'lobby.players' | 'lobby.roles' | 'lobby.start' | 'lobby.starting'
  | 'lobby.unavailable'
  | 'reveal.title' | 'reveal.covered' | 'reveal.action' | 'reveal.ready' | 'reveal.faction' | 'reveal.teammates'
  | 'reveal.resources' | 'reveal.none'
  | 'table.title' | 'table.day' | 'table.night' | 'table.phase' | 'table.seat' | 'table.you'
  | 'table.alive' | 'table.dead' | 'table.deadOn' | 'table.unknownRole' | 'table.role'
  | 'table.timeline' | 'table.notices' | 'table.noNotices' | 'table.empty'
  | 'night.title' | 'night.privateHint'
  | 'speech.title' | 'speech.placeholder' | 'speech.remaining' | 'speech.speak' | 'speech.pass'
  | 'vote.title' | 'vote.selected' | 'vote.confirm' | 'vote.abstain'
  | 'action.title' | 'action.submit' | 'action.pass' | 'action.passLabel'
  | 'spectator.title' | 'spectator.hint'
  | 'paused.title' | 'paused.reason' | 'paused.resume' | 'paused.resuming' | 'paused.abort' | 'paused.confirmAbort'
  | 'result.title' | 'result.village' | 'result.wolf' | 'result.tie' | 'result.aborted'
  | 'result.summary' | 'result.survived' | 'result.eliminated'
  | 'result.review' | 'result.newGame' | 'replay.title' | 'replay.close' | 'replay.checkpoint'
  | 'error.title' | 'error.retry' | 'busy.label'

/** English copy. */
export const en: Record<WerewolfKey, string> = {
  'view.werewolf': 'Werewolf',
  'lobby.title': 'Werewolf lobby',
  'lobby.subtitle': 'Pick a rule set and take your seat.',
  'lobby.players': '{count} players',
  'lobby.roles': '{roles}',
  'lobby.start': 'Start game',
  'lobby.starting': 'Starting…',
  'lobby.unavailable': 'No rule set is available yet.',
  'reveal.title': 'Your seat has been assigned',
  'reveal.covered': 'Your role card is face down.',
  'reveal.action': 'Reveal role',
  'reveal.ready': 'I am ready',
  'reveal.faction': 'Faction: {faction}',
  'reveal.teammates': 'Teammates: {names}',
  'reveal.resources': 'Resources',
  'reveal.none': 'None',
  'table.title': 'Game table',
  'table.day': 'Day {day}',
  'table.night': 'Night {day}',
  'table.phase': 'Phase: {phase}',
  'table.seat': 'Seat {seat}',
  'table.you': 'You',
  'table.alive': 'Alive',
  'table.dead': 'Dead',
  'table.deadOn': 'Died on day {day}',
  'table.unknownRole': 'Unknown role',
  'table.role': 'Role',
  'table.timeline': 'Public timeline',
  'table.notices': 'Private notices',
  'table.noNotices': 'No private notices.',
  'table.empty': 'Nothing has happened yet.',
  'night.title': 'Night falls',
  'night.privateHint': 'Night actions are private. Only your own view is shown.',
  'speech.title': 'Your statement',
  'speech.placeholder': 'Address the table…',
  'speech.remaining': '{count} characters left',
  'speech.speak': 'Speak',
  'speech.pass': 'Pass',
  'vote.title': 'Cast your vote',
  'vote.selected': 'Voting: {name}',
  'vote.confirm': 'Confirm vote',
  'vote.abstain': 'Abstain',
  'action.title': 'Choose your action',
  'action.submit': 'Submit',
  'action.pass': 'Pass',
  'action.passLabel': 'Skip this action',
  'spectator.title': 'Spectating',
  'spectator.hint': 'You are out. The public timeline stays live; roles reveal at the result.',
  'paused.title': 'Game paused',
  'paused.reason': 'Reason: {reason}',
  'paused.resume': 'Resume',
  'paused.resuming': 'Resuming…',
  'paused.abort': 'Abort game',
  'paused.confirmAbort': 'Abort this game? This cannot be undone.',
  'result.title': 'Game over',
  'result.village': 'Village wins',
  'result.wolf': 'Wolves win',
  'result.tie': 'Draw',
  'result.aborted': 'Aborted',
  'result.summary': 'You {outcome} this game.',
  'result.survived': 'survived',
  'result.eliminated': 'were eliminated from',
  'result.review': 'Review game',
  'result.newGame': 'New game',
  'replay.title': 'Game review',
  'replay.close': 'Close review',
  'replay.checkpoint': 'Revision {revision} — {type}',
  'error.title': 'Something went wrong',
  'error.retry': 'Retry',
  'busy.label': 'Working…',
}

/** Chinese copy. */
export const zh: Record<WerewolfKey, string> = {
  'view.werewolf': '狼人杀',
  'lobby.title': '狼人杀大厅',
  'lobby.subtitle': '选择一套规则，坐下入局。',
  'lobby.players': '{count} 名玩家',
  'lobby.roles': '{roles}',
  'lobby.start': '开始游戏',
  'lobby.starting': '正在开局…',
  'lobby.unavailable': '暂无可用的规则集。',
  'reveal.title': '座位已分配',
  'reveal.covered': '你的身份牌背面朝上。',
  'reveal.action': '揭示身份',
  'reveal.ready': '我已了解',
  'reveal.faction': '阵营：{faction}',
  'reveal.teammates': '队友：{names}',
  'reveal.resources': '资源',
  'reveal.none': '无',
  'table.title': '游戏桌',
  'table.day': '第 {day} 天',
  'table.night': '第 {day} 夜',
  'table.phase': '阶段：{phase}',
  'table.seat': '{seat} 号位',
  'table.you': '你',
  'table.alive': '存活',
  'table.dead': '出局',
  'table.deadOn': '第 {day} 天出局',
  'table.unknownRole': '身份未知',
  'table.role': '身份',
  'table.timeline': '公开时间线',
  'table.notices': '私密通知',
  'table.noNotices': '暂无私密通知。',
  'table.empty': '还没有任何事发生。',
  'night.title': '夜幕降临',
  'night.privateHint': '夜间行动是私密的，只显示你自己的视野。',
  'speech.title': '轮到你发言',
  'speech.placeholder': '向全桌发言…',
  'speech.remaining': '还可输入 {count} 字',
  'speech.speak': '发言',
  'speech.pass': '过麦',
  'vote.title': '投出你的一票',
  'vote.selected': '投票对象：{name}',
  'vote.confirm': '确认投票',
  'vote.abstain': '弃票',
  'action.title': '选择你的行动',
  'action.submit': '提交',
  'action.pass': '跳过',
  'action.passLabel': '跳过本次行动',
  'spectator.title': '观战中',
  'spectator.hint': '你已出局。公开时间线继续更新，身份在结算时揭示。',
  'paused.title': '游戏已暂停',
  'paused.reason': '原因：{reason}',
  'paused.resume': '恢复游戏',
  'paused.resuming': '正在恢复…',
  'paused.abort': '中止本局',
  'paused.confirmAbort': '确定中止本局？此操作不可撤销。',
  'result.title': '本局结束',
  'result.village': '好人阵营获胜',
  'result.wolf': '狼人阵营获胜',
  'result.tie': '平局',
  'result.aborted': '已中止',
  'result.summary': '你{outcome}了本局。',
  'result.survived': '存活至终局',
  'result.eliminated': '中途出局',
  'result.review': '复盘本局',
  'result.newGame': '再来一局',
  'replay.title': '对局复盘',
  'replay.close': '关闭复盘',
  'replay.checkpoint': '修订 {revision} — {type}',
  'error.title': '出了点问题',
  'error.retry': '重试',
  'busy.label': '处理中…',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dedicated Werewolf view copy. */
    'ui-werewolf': WerewolfKey
  }
}
