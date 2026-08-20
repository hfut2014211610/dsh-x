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
 * A host element takes the attributes directly. A fenced code block or a
 * display-math node renders as a component or a fragment, which has no
 * element to put them on and no props declared for them, so those get a
 * wrapper — `display: contents`, so it generates no box and the layout is the
 * same one the block had without it. The wrapper has no box to measure
 * either, which is why a caller reading geometry off a marked block has to
 * fall through to its first child.
 *
 * A block that renders as a bare string — raw HTML, which stays literal — is
 * left alone: wrapping a text node would change how adjacent literal text
 * coalesces, which is exactly what the parity fixtures pin.
 * @param element - the rendered block.
 * @param node - the mdast node it came from.
 * @param key - the block's stream-stable render key.
 * @returns the element, marked with its range where that is possible.
 */
function withSourceRange(element: ReactNode, node: Md.RootContent, key: number): ReactNode {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return element
  if (!isValidElement(element)) return element
  if (typeof element.type === 'string') {
    return cloneElement(element as ReactElement<Record<string, unknown>>, {
      'data-md-start': start,
      'data-md-end': end,
    })
  }
  return (
    <div key={key} style={{ display: 'contents' }} data-md-start={start} data-md-end={end}>
      {element}
    </div>
  )
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
    rendered.push(withSourceRange(element, node, key))
  }
  return rendered
}
