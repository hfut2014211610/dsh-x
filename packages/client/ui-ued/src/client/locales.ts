/** Locale dictionaries for the UED preview view. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'ui-ued'

/** The UED dictionary key set. */
export type UedKey =
  | 'view.ued' | 'assistant.title'
  | 'files.label' | 'files.loading' | 'files.empty' | 'files.error' | 'files.refresh' | 'files.up' | 'files.resize'
  | 'preview.label' | 'preview.none' | 'preview.loading' | 'preview.error'
  | 'preview.open' | 'preview.reload' | 'preview.badge'
  | 'preview.width.label' | 'preview.width.auto'
  | 'preview.width.desktop' | 'preview.width.tablet' | 'preview.width.mobile'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Prototype list, preview frame, and companion label copy. */
    'ui-ued': UedKey
  }
}

/** English copy. */
export const en: Record<UedKey, string> = {
  'view.ued': 'Design',
  'assistant.title': 'Assistant',
  'files.label': 'Prototypes',
  'files.loading': 'Loading…',
  'files.empty': 'No prototype in this folder yet.',
  'files.error': 'Could not list the workspace.',
  'files.refresh': 'Refresh',
  'files.up': 'Up one level',
  'files.resize': 'Resize the prototype list',
  'preview.label': 'Prototype preview',
  'preview.none': 'Pick a prototype on the left to preview it.',
  'preview.loading': 'Loading the prototype…',
  'preview.error': 'Could not read the prototype.',
  'preview.open': 'Open in browser',
  'preview.reload': 'Reload',
  'preview.badge': 'Preview — sandboxed, no network',
  'preview.width.label': 'Viewport width',
  'preview.width.auto': 'Fit',
  'preview.width.desktop': 'Desktop',
  'preview.width.tablet': 'Tablet',
  'preview.width.mobile': 'Phone',
}

/** Simplified Chinese copy. */
export const zh: Record<UedKey, string> = {
  'view.ued': '设计',
  'assistant.title': '助手',
  'files.label': '原型',
  'files.loading': '正在加载…',
  'files.empty': '这个目录下还没有原型。',
  'files.error': '读不到工作区目录。',
  'files.refresh': '刷新',
  'files.up': '上一级',
  'files.resize': '调整原型列表宽度',
  'preview.label': '原型预览',
  'preview.none': '在左边选一个原型来预览。',
  'preview.loading': '正在加载原型…',
  'preview.error': '读不到这个原型。',
  'preview.open': '在浏览器里打开',
  'preview.reload': '重新加载',
  'preview.badge': '预览 — 沙箱内运行，不联网',
  'preview.width.label': '预览宽度',
  'preview.width.auto': '自适应',
  'preview.width.desktop': '桌面',
  'preview.width.tablet': '平板',
  'preview.width.mobile': '手机',
}
