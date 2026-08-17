/**
 * Locale dictionaries for the writing view.
 * @module @deepseek-ai/dsh-client-ui-writing/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'ui-writing'

/** The writing dictionary key set (the source of truth for both locales). */
export type WritingKey = 'view.writing' | 'placeholder'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The writing view tab label and placeholder. */
    'ui-writing': WritingKey
  }
}

/** Simplified Chinese dictionary. */
export const zh: Record<WritingKey, string> = {
  'view.writing': '写作',
  'placeholder': '写作模式编辑器将显示在这里。',
}

/** English dictionary. */
export const en: Record<WritingKey, string> = {
  'view.writing': 'Writing',
  'placeholder': 'Writing mode editor will appear here.',
}
