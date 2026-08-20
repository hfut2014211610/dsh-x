/**
 * Source-range marking for a settled Markdown render.
 *
 * A caller that owns the text it renders — an editor showing a document in a
 * reading view — needs to get from a rendered block back to the characters
 * behind it. The mdast nodes know; the DOM does not.
 *
 * This lives in its own file rather than inside `render.tsx` on purpose. That
 * file's output is pinned byte-for-byte against the pipeline it replaced, it
 * is the one most likely to change under it, and marking is not part of what
 * it does — it is something one caller does to its result afterwards.
 * @module @deepseek-ai/dsh-client-ui-primitives/markdown/source-positions
 */

import { cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type * as Md from 'mdast'
import { renderBlocks } from './render.tsx'
import type { MarkdownRenderContext } from './render.tsx'

/**
 * Stamp one rendered block with the source range behind it.
 *
 * Only a host element takes the attributes: a fragment has no element to
 * carry them, and a component would receive props it never declared. Fenced
 * code, display math, and raw HTML render as those, so they stay unmarked and
 * a caller has to have an answer for a block with no range.
 * @param element - the rendered block.
 * @param node - the mdast node it came from.
 * @returns the element, stamped when it can carry the attributes.
 */
function withSourceRange(element: ReactNode, node: Md.RootContent): ReactNode {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return element
  if (!isValidElement(element) || typeof element.type !== 'string') return element
  return cloneElement(element as ReactElement<Record<string, unknown>>, {
    'data-md-start': start,
    'data-md-end': end,
  })
}

/**
 * Render top-level blocks the way `renderBlocks` does, marking each one with
 * the source offsets it was parsed from.
 *
 * One node per call so the mapping from element to node survives the drop of
 * nodes that render nothing — `renderBlocks` filters those out, and a batched
 * call would leave the two lists misaligned with no way to tell which node
 * went missing. Document order is preserved across the calls, which is what
 * the context's footnote numbering counts on.
 * @param nodes - the document's top-level nodes, in order.
 * @param context - the pass state, mutated in document order as usual.
 * @returns the rendered blocks, empty renders already dropped.
 */
export function renderBlocksWithSource(
  nodes: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): ReactNode[] {
  const rendered: ReactNode[] = []
  for (const [key, node] of nodes.entries()) {
    const [element] = renderBlocks([{ node, key }], context)
    if (element === undefined) continue
    rendered.push(withSourceRange(element, node))
  }
  return rendered
}
