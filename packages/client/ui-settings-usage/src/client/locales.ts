/**
 * Usage section copy, zh authoritative with an en mirror. One physical line
 * per entry; `{days}`/`{n}`/`{date}`/`{prompt}`/`{output}` placeholders are
 * replaced by `String.replace`.
 */

export const zh = {
  nav: '用量',
  title: '模型用量',
  intro: '全部会话累计的模型 token 消耗。冷会话展示其最后一次持久化检查点的数据。',
  refresh: '刷新',
  rangeLabel: '统计区间',
  range7: '7 天',
  range28: '28 天',
  range90: '90 天',
  rangeAll: '全部',
  statSessions: '会话',
  statRequests: '请求',
  statInput: '输入',
  statCacheRead: '缓存读',
  statCacheWrite: '缓存写',
  statOutput: '输出',
  statReasoning: '推理',
  statLlmTime: '模型时长',
  heatmapLabel: '每日 token 用量点阵图，颜色越深当日消耗越大',
  heatmapCaption: '每日消耗点阵（按窗口内最忙一日分档着色，悬浮查看当日明细）。',
  today: '今天',
  yesterday: '昨天',
  daysAgo: '{n} 天前',
  noUsage: '无消耗',
  tooltipDay: '{date} · 输入+缓存 {prompt} · 输出 {output}',
  model: '模型',
  empty: '所选区间内尚无模型用量记录。',
  errorTitle: '加载失败',
} as const

export type UsageKey = keyof typeof zh

export const en: Record<UsageKey, string> = {
  nav: 'Usage',
  title: 'Model usage',
  intro: 'Token consumption totaled across all sessions. Cold sessions show their last persisted checkpoint.',
  refresh: 'Refresh',
  rangeLabel: 'Statistics window',
  range7: '7 days',
  range28: '28 days',
  range90: '90 days',
  rangeAll: 'All',
  statSessions: 'Sessions',
  statRequests: 'Requests',
  statInput: 'Input',
  statCacheRead: 'Cache read',
  statCacheWrite: 'Cache write',
  statOutput: 'Output',
  statReasoning: 'Reasoning',
  statLlmTime: 'Model time',
  heatmapLabel: 'Daily token usage dot grid; darker means more consumption that day',
  heatmapCaption: 'Daily consumption dots (graded against the busiest day in the window; hover a dot for its detail).',
  today: 'Today',
  yesterday: 'Yesterday',
  daysAgo: '{n} days ago',
  noUsage: 'no usage',
  tooltipDay: '{date} · input+cache {prompt} · output {output}',
  model: 'Model',
  empty: 'No model usage recorded in this window yet.',
  errorTitle: 'Load failed',
}
