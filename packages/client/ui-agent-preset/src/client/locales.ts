/** Locale bundles for the agent-preset hero chip, header label, and management section. */

import { guideEn, guideZh, type PresetGuideKey } from './guide-locales.ts'

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | PresetGuideKey
  | 'builtInGroup'
  | 'customGroup'
  | 'seatHint'
  | 'headerHint'
  | 'nav'
  | 'sectionIntro'
  | 'setDefault'
  | 'view'
  | 'presetStandardName'
  | 'presetStandardDescription'
  | 'presetPtcName'
  | 'presetPtcDescription'
  | 'presetMinimalName'
  | 'presetMinimalDescription'
  | 'presetCordisName'
  | 'presetCordisDescription'
  | 'presetAnchoredName'
  | 'presetAnchoredDescription'
  | 'presetWritingName'
  | 'presetWritingDescription'
  | 'presetUedName'
  | 'presetUedDescription'
  | 'inUse'
  | 'noDescription'
  | 'brokenBadge'
  | 'switchRefused'
  | 'close'
  | 'creatorDraft'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  ...guideEn,
  builtInGroup: 'Built-in', customGroup: 'Custom',
  sectionIntro: 'Choose the agent’s tools and how it works. Use Standard mode for everyday tasks, or Creator mode to add capabilities to DSH.',

  seatHint: 'Choose the agent preset for your new task',
  headerHint: 'The agent preset chosen when this task started',
  nav: 'Agent presets',

  setDefault: 'Set as new task default',
  view: 'View configuration',

  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Work with code, files, and information. Suitable for most tasks, with search, editing, terminal commands, and other tools available as needed.',
  presetPtcName: 'PTC mode',
  presetPtcDescription:
    'Includes all Standard mode capabilities. Better suited to tasks that call tools in batches and then filter, organize, deduplicate, count, or summarize the results.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'The agent works using only a terminal tool. Useful for testing and comparing its basic performance.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Customize DSH through conversation. Let the agent write plugins that add features or UI, or combine tools and prompts to create your own mode.',

  presetAnchoredName: 'Anchored Standard mode',
  presetAnchoredDescription:
    'Anchors the first model request on the Minimal two-tool, zero-injection condition, then promotes to an on-demand-unlocked Standard toolset.',
  presetWritingName: 'Writing mode',
  presetWritingDescription:
    'Document drafting and revision agent, offering the document_* tools only.',
  presetUedName: 'Design mode',
  presetUedDescription:
    'UI prototyping agent whose artifact is self-contained HTML, running each revision as a concurrent design thread; the document_* and delegation tools only.',

  inUse: 'New task default',

  noDescription: 'No description.',
  brokenBadge: 'Failed to load',

  switchRefused: 'Could not switch to {name}: {reason}',

  close: 'Close',

  creatorDraft: 'Let the agent help me create a preset',

}

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  ...guideZh,
  builtInGroup: '内置', customGroup: '自定义',
  sectionIntro: '选择 Agent 的工具和工作方式。日常任务用「标准模式」，扩展 DSH 的能力用「创造模式」。',

  seatHint: '选择新任务使用的 Agent 预设',
  headerHint: '本任务的 Agent 预设，在任务开始时确定',
  nav: 'Agent 预设',

  setDefault: '设为新任务默认',
  view: '查看配置',

  presetStandardName: '标准模式',
  presetStandardDescription: '处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。',
  presetPtcName: 'PTC 模式',
  presetPtcDescription: '包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: 'Agent 仅使用终端工具完成任务，适合测试和对比其基础表现。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。',

  presetAnchoredName: '锚定标准模式',
  presetAnchoredDescription: '首轮以 Minimal 双工具与零注入上下文锚定轨迹，晋升后进入按需解锁的 Standard 工具集。',
  presetWritingName: '写作模式',
  presetWritingDescription: '面向文档编写与修订的写作 Agent，只提供 document_* 文档工具。',
  presetUedName: 'UED 模式',
  presetUedDescription: '面向 UI 原型设计的 Agent：产出自包含 HTML，把短指令改动分线程并发迭代，只提供 document_* 与委派工具。',

  inUse: '新任务默认',

  noDescription: '暂无描述。',
  brokenBadge: '加载失败',

  switchRefused: '无法切换到「{name}」：{reason}',

  close: '关闭',

  creatorDraft: '让 Agent 帮我创建预设模式',

}

export type { PresetDisplaySource, PresetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { PresetDisplaySource, PresetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import { isBuiltInPreset as registryIsBuiltInPreset, presetDisplayText as registryPresetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'

/**
 * Dictionary keys carrying one fork-shipped preset's display copy.
 *
 * `agent-preset-registry/display` owns the fold over the four presets upstream
 * ships. The fork ships three more from the same bundle, and that registry is
 * upstream-tracked, so its map is extended here instead: a fork id resolves
 * through this table and every other id is delegated unchanged.
 */
interface ForkPresetKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const FORK_PRESET_KEYS: Readonly<Record<string, ForkPresetKeys>> = {
  'anchored-standard': { name: 'presetAnchoredName', description: 'presetAnchoredDescription' },
  writing: { name: 'presetWritingName', description: 'presetWritingDescription' },
  ued: { name: 'presetUedName', description: 'presetUedDescription' },
}

/** Whether a roster row is one of the fork's own shipped presets. */
function isForkBuiltInPreset(preset: PresetDisplaySource): boolean {
  return preset.name === undefined && FORK_PRESET_KEYS[preset.id] !== undefined
}

/**
 * Whether a roster row is a shipped preset whose copy the dictionaries carry.
 * A shipped preset publishes no `name`; a declaration that names itself owns its copy.
 * @param preset - roster row.
 * @returns true for a shipped preset id without a published name.
 */
export function isBuiltInPreset(preset: PresetDisplaySource): boolean {
  return isForkBuiltInPreset(preset) || registryIsBuiltInPreset(preset)
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise declaration metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = isForkBuiltInPreset(preset) ? FORK_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return registryPresetDisplayText(preset, t)
}
