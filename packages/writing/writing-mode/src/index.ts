/**
 * Writing-mode system-prompt section.
 * @module @deepseek-ai/dsh-writing-mode
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'writing-mode'
export const inject = ['systemPrompt']

const WRITING_POLICY = 'You are in writing mode. The only supported way to change a document is through document_edit, using the version returned by a prior document_read. Do not use shell redirection, write, edit, or generic file tools for document content. A new document goes where the person asked for it, or at the workspace root; do not put one inside a directory the project already maintains for something else — a documentation tree, a source tree — unasked, because those carry conventions and checks this session cannot see.'

/** Register the writing:policy system-prompt section. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'writing:policy',
    order: 90,
    text: WRITING_POLICY,
  })
}
