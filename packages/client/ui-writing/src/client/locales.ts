/** Locale dictionaries for the writing view. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'ui-writing'

/** The writing dictionary key set. */
export type WritingKey =
  | 'view.writing' | 'assistant.title'
  | 'tools.label' | 'tools.document' | 'tools.outline' | 'tools.search'
  | 'panel.document' | 'panel.outline' | 'panel.search' | 'panel.resize'
  | 'document.path' | 'document.pathPlaceholder' | 'document.untitled'
  | 'tree.label' | 'tree.heading' | 'tree.loading' | 'tree.empty' | 'tree.error' | 'tree.truncated' | 'tree.refresh'
  | 'outline.empty' | 'search.input' | 'search.placeholder' | 'search.empty'
  | 'editor.label' | 'editor.placeholder' | 'conflict.message'
  | 'mode.label' | 'mode.edit' | 'mode.preview' | 'preview.label'
  | 'action.close' | 'action.open' | 'action.reload' | 'action.retry' | 'action.newWindow'
  | 'action.save' | 'action.saving' | 'action.copy' | 'action.copied'
  | 'status.idle' | 'status.loading' | 'status.dirty' | 'status.saving'
  | 'status.saved' | 'status.external' | 'status.conflict' | 'status.error'
  | 'footer.characters' | 'footer.autosave'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Writing editor, document tools, and companion label copy. */
    'ui-writing': WritingKey
  }
}

/** Simplified Chinese dictionary. */
export const zh: Record<WritingKey, string> = {
  'view.writing': '写作模式',
  'assistant.title': '协作助手',
  'tools.label': '文档工具',
  'tools.document': '文件',
  'tools.outline': '大纲',
  'tools.search': '搜索',
  'panel.document': '打开文档',
  'panel.outline': '文档大纲',
  'panel.search': '搜索工作区',
  'panel.resize': '调整面板宽度',
  'document.path': '工作区相对路径',
  'document.pathPlaceholder': 'docs/subsystems/writing.md',
  'document.untitled': '未打开文档',
  'tree.label': '工作区文档目录',
  'tree.heading': '工作区文件',
  'tree.loading': '正在加载目录…',
  'tree.empty': '这个目录中没有文件。',
  'tree.error': '目录加载失败',
  'tree.truncated': '条目过多，仅显示开头部分。',
  'tree.refresh': '刷新目录',
  'outline.empty': '打开文档后，这里会显示标题和结构。',
  'search.input': '搜索文档',
  'search.placeholder': '输入标题或内容',
  'search.empty': '输入关键词搜索工作区文档。',
  'editor.label': '文档编辑器',
  'editor.placeholder': '从左侧打开一个文档，或在这里开始写作。',
  'mode.label': '文档显示模式',
  'mode.edit': '编辑',
  'mode.preview': '预览',
  'preview.label': '文档预览',
  'conflict.message': '文档已被模型或其他窗口修改。当前草稿尚未覆盖，可重新载入最新版本。',
  'action.close': '关闭',
  'action.copy': '复制',
  'action.copied': '已复制',
  'action.open': '打开文档',
  'action.reload': '重新载入',
  'action.retry': '重试',
  'action.newWindow': '在新窗口打开',
  'action.save': '保存',
  'action.saving': '保存中',
  'status.idle': '等待打开文档',
  'status.loading': '载入中',
  'status.dirty': '有未保存修改',
  'status.saving': '保存中',
  'status.saved': '已保存',
  'status.external': '已同步模型修改',
  'status.conflict': '检测到外部修改',
  'status.error': '操作失败',
  'footer.characters': '{count} 字',
  'footer.autosave': '版本保护已开启',
}

/** English dictionary. */
export const en: Record<WritingKey, string> = {
  'view.writing': 'Writing',
  'assistant.title': 'Assistant',
  'tools.label': 'Document tools',
  'tools.document': 'Files',
  'tools.outline': 'Outline',
  'tools.search': 'Search',
  'panel.document': 'Open document',
  'panel.outline': 'Document outline',
  'panel.search': 'Search workspace',
  'panel.resize': 'Resize the panel',
  'document.path': 'Workspace-relative path',
  'document.pathPlaceholder': 'docs/subsystems/writing.md',
  'document.untitled': 'No document open',
  'tree.label': 'Workspace document tree',
  'tree.heading': 'Workspace files',
  'tree.loading': 'Loading directory…',
  'tree.empty': 'This directory contains no files.',
  'tree.error': 'Directory failed to load',
  'tree.truncated': 'Too many entries; only the beginning is shown.',
  'tree.refresh': 'Refresh files',
  'outline.empty': 'Open a document to see its headings and structure.',
  'search.input': 'Search documents',
  'search.placeholder': 'Search titles or content',
  'search.empty': 'Enter a query to search workspace documents.',
  'editor.label': 'Document editor',
  'editor.placeholder': 'Open a document from the left, or start writing here.',
  'mode.label': 'Document display mode',
  'mode.edit': 'Edit',
  'mode.preview': 'Preview',
  'preview.label': 'Document preview',
  'conflict.message': 'The document changed in the assistant or another window. Your draft is preserved; reload to use the latest version.',
  'action.close': 'Close',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.open': 'Open document',
  'action.reload': 'Reload',
  'action.retry': 'Retry',
  'action.newWindow': 'Open in new window',
  'action.save': 'Save',
  'action.saving': 'Saving',
  'status.idle': 'Open a document',
  'status.loading': 'Loading',
  'status.dirty': 'Unsaved changes',
  'status.saving': 'Saving',
  'status.saved': 'Saved',
  'status.external': 'Assistant changes synced',
  'status.conflict': 'External change detected',
  'status.error': 'Action failed',
  'footer.characters': '{count} characters',
  'footer.autosave': 'Version protection on',
}
