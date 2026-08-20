/**
 * Picking one element out of the preview frame.
 *
 * The frame runs `allow-scripts` without `allow-same-origin` (the reasoning is
 * in sandbox.ts), so the host cannot reach into it at all: `contentDocument`
 * reads as `null`. Picking therefore happens *inside* the frame, in an injected
 * script, and the answer comes back over `postMessage`.
 *
 * Two consequences shape everything in this module.
 *
 * **The message cannot be authenticated by origin.** A document in an opaque
 * origin posts with `event.origin === 'null'` — and so does every other
 * sandboxed frame on the page, which makes that string worth nothing as a
 * check. The only usable proof is object identity: `event.source` must be the
 * very `Window` this view framed. {@link readInspectMessage} takes that window
 * as an argument for exactly this reason.
 *
 * **The payload is untrusted.** The injected script shares a realm with the
 * prototype, which can forge any message it likes. Injecting grants the
 * prototype nothing new — `postMessage` to the parent was never gated by the
 * sandbox — but it does mean the host now *listens*, so everything arriving
 * here is capped, stripped of control characters, and only ever used as text.
 * Nothing from the frame is rendered as markup.
 *
 * @module @deepseek-ai/dsh-client-ui-ued/inspect
 */

/**
 * Tag shared by both directions of the channel. Not a secret and not a
 * defence — it only keeps this protocol apart from other `postMessage`
 * traffic on the same window.
 */
export const INSPECT_CHANNEL = 'dsh-ued-inspect'

/** Deepest hit stack the frame reports, and the host displays. */
export const MAX_CANDIDATES = 8

/** Caps applied to every string that crosses the boundary. */
const MAX_LABEL = 120
const MAX_SELECTOR = 240
const MAX_TEXT = 120
const MAX_HTML = 600

/** One element under the pointer, as the frame described it. */
export interface InspectCandidate {
  /** Depth in the hit stack: 0 is the topmost element, higher is further behind. */
  readonly depth: number
  /** Lowercased tag name. */
  readonly tag: string
  /** Display form, e.g. `button#submit.btn.primary`. */
  readonly label: string
  /** Best-effort CSS path from the document element. */
  readonly selector: string
  /** Collapsed text content, capped. */
  readonly text: string
  /** The element's own markup, shallow when the subtree is large. */
  readonly html: string
}

/** What the frame sends back. */
export type InspectMessage =
  /** The injected script is live; the host may arm it. */
  | { readonly type: 'ready' }
  /** A click landed while armed: the whole stack under that point. */
  | { readonly type: 'picked'; readonly candidates: readonly InspectCandidate[] }
  /** The person pressed Escape inside the frame. */
  | { readonly type: 'cancelled' }

/** What the host sends in. */
export type InspectCommand =
  | { readonly type: 'arm' }
  | { readonly type: 'disarm' }
  /** Outline one candidate by depth; a negative depth clears the outline. */
  | { readonly type: 'highlight'; readonly depth: number }

/** Drop control characters that would corrupt the composer draft; keep tab and newline. */
function clean(value: string, cap: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, cap)
}

/** Read one string field off an untrusted record. */
function stringAt(record: Record<string, unknown>, key: string, cap: number): string {
  const value = record[key]
  return typeof value === 'string' ? clean(value, cap) : ''
}

/** Narrow an untrusted value to a plain record. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Rebuild one candidate from untrusted data, or reject it outright. */
function candidateOf(value: unknown, depth: number): InspectCandidate | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const tag = stringAt(record, 'tag', 40)
  if (tag === '') return undefined
  return {
    depth,
    tag,
    label: stringAt(record, 'label', MAX_LABEL) || tag,
    selector: stringAt(record, 'selector', MAX_SELECTOR),
    text: stringAt(record, 'text', MAX_TEXT),
    html: stringAt(record, 'html', MAX_HTML),
  }
}

/**
 * Accept one message from the preview frame, or reject it.
 *
 * `source` is checked against `frame` by identity because origin cannot
 * distinguish this frame from any other sandboxed one — see the module note.
 * Everything that survives has been re-created field by field, so a forged
 * message can at worst put capped, control-character-free text on the screen.
 *
 * @param data - the event's `data`, of unknown shape.
 * @param source - the event's `source` window.
 * @param frame - the window this view framed, or null before it mounts.
 * @returns the accepted message, or undefined when anything fails to check out.
 */
export function readInspectMessage(
  data: unknown,
  source: unknown,
  frame: Window | null,
): InspectMessage | undefined {
  if (frame === null || source !== frame) return undefined
  const record = recordOf(data)
  if (record === undefined || record['source'] !== INSPECT_CHANNEL) return undefined
  const type = record['type']
  if (type === 'ready') return { type: 'ready' }
  if (type === 'cancelled') return { type: 'cancelled' }
  if (type !== 'picked') return undefined
  const raw = record['candidates']
  if (!Array.isArray(raw)) return undefined
  const candidates: InspectCandidate[] = []
  for (const entry of raw.slice(0, MAX_CANDIDATES)) {
    const candidate = candidateOf(entry, candidates.length)
    if (candidate !== undefined) candidates.push(candidate)
  }
  if (candidates.length === 0) return undefined
  return { type: 'picked', candidates }
}

/**
 * Post one command into the frame.
 *
 * The target origin has to be `'*'`: the frame's origin is opaque, so there is
 * no other value that would ever match. That is safe in the one direction —
 * the payload is a command with no secret in it, and only this frame receives
 * it.
 * @param frame - the framed window, or null before it mounts.
 * @param command - what the frame should do.
 */
export function postInspectCommand(frame: Window | null, command: InspectCommand): void {
  if (frame === null) return
  frame.postMessage({ source: INSPECT_CHANNEL, ...command }, '*')
}

/**
 * The reference that goes into the composer draft.
 *
 * Deliberately structural rather than prose: the person writes the request
 * themselves, and a generated sentence would need a locale the model does not
 * care about. Path and selector identify the element; the markup lets the
 * model find it when the selector has drifted since the prototype was written.
 * @param path - workspace-relative prototype path.
 * @param candidate - the element the person confirmed.
 * @returns draft text, ending in a newline so typing continues on a fresh line.
 */
export function annotationFor(path: string, candidate: InspectCandidate): string {
  const head = candidate.selector === ''
    ? `${path} · ${candidate.label}`
    : `${path} · ${candidate.selector}`
  return `${head}\n\`\`\`html\n${candidate.html}\n\`\`\`\n`
}

/**
 * Append one annotation to a draft, keeping whatever the person already typed.
 * @param draft - the current composer draft.
 * @param annotation - the block from {@link annotationFor}.
 * @returns the next draft.
 */
export function draftWith(draft: string, annotation: string): string {
  if (draft === '') return annotation
  return draft.endsWith('\n') ? `${draft}${annotation}` : `${draft}\n${annotation}`
}

/**
 * The script injected into the preview frame.
 *
 * Plain ES5-shaped source on purpose — it is read by whoever reviews this
 * boundary, and it runs in whatever engine the prototype runs in. It is inert
 * until the host arms it: three capture-phase listeners and one absolutely
 * positioned outline, all removed again on disarm, so a prototype at rest sees
 * an extra `<script>` element and nothing else.
 *
 * It must never contain the character sequence that would close its own
 * `<script>` element; the sandbox spec asserts that.
 */
export const INSPECT_SCRIPT = `(function () {
  var CHANNEL = ${JSON.stringify(INSPECT_CHANNEL)}
  var MAX = ${String(MAX_CANDIDATES)}
  var MAX_HTML = ${String(MAX_HTML)}
  var armed = false
  var stack = []
  var outline = null

  function post(message) {
    message.source = CHANNEL
    parent.postMessage(message, '*')
  }

  function box() {
    if (outline && outline.isConnected) return outline
    outline = document.createElement('div')
    outline.setAttribute('data-dsh-ued-outline', '')
    outline.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;'
      + 'box-sizing:border-box;border:2px solid #4c8dff;background:rgba(76,141,255,0.14);'
    // The prototype's own layout is written against body; hanging the outline
    // off documentElement keeps it out of body's child list, where a
    // :last-child or nth-child rule would notice it.
    document.documentElement.appendChild(outline)
    return outline
  }

  function drawOn(element) {
    if (!element) { hide(); return }
    var rect = element.getBoundingClientRect()
    var node = box()
    node.style.left = rect.left + 'px'
    node.style.top = rect.top + 'px'
    node.style.width = rect.width + 'px'
    node.style.height = rect.height + 'px'
    node.style.display = 'block'
  }

  function hide() {
    if (outline && outline.parentNode) outline.parentNode.removeChild(outline)
    outline = null
  }

  function classesOf(element) {
    var list = element.classList ? Array.prototype.slice.call(element.classList, 0, 3) : []
    return list.length === 0 ? '' : '.' + list.join('.')
  }

  function idOf(element) {
    var id = element.getAttribute ? element.getAttribute('id') : null
    // Only ids that are valid on their own as a selector take the shortcut;
    // anything else falls through to the positional path.
    return id && /^[A-Za-z][\\w-]*$/.test(id) ? id : ''
  }

  function selectorFor(element) {
    var parts = []
    var node = element
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var id = idOf(node)
      if (id !== '') { parts.unshift('#' + id); break }
      var tag = node.tagName.toLowerCase()
      var parent = node.parentElement
      if (!parent) { parts.unshift(tag); break }
      var seen = 0
      var index = 0
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === node.tagName) {
          seen++
          if (parent.children[i] === node) index = seen
        }
      }
      parts.unshift(seen > 1 ? tag + ':nth-of-type(' + index + ')' : tag)
      node = parent
    }
    return parts.join(' > ')
  }

  function markupOf(element) {
    var whole = element.outerHTML || ''
    if (whole.length <= MAX_HTML) return whole
    // Too big to carry: keep the opening tag, which is what identifies the
    // element, and say the subtree was elided rather than truncating mid-tag.
    var shallow = element.cloneNode(false)
    var empty = shallow.outerHTML || ''
    var close = '</' + element.tagName.toLowerCase() + '>'
    var at = empty.lastIndexOf(close)
    var open = at < 0 ? empty : empty.slice(0, at)
    return open + '\\u2026' + close
  }

  function describe(element) {
    var text = (element.textContent || '').replace(/\\s+/g, ' ').trim()
    return {
      tag: element.tagName.toLowerCase(),
      label: element.tagName.toLowerCase() + (idOf(element) === '' ? '' : '#' + idOf(element)) + classesOf(element),
      selector: selectorFor(element),
      text: text,
      html: markupOf(element),
    }
  }

  function pickAt(x, y) {
    // elementsFromPoint is the whole feature: it returns the entire hit stack
    // at that point, not just the topmost element, so something behind an
    // overlay is reachable without moving anything out of the way.
    var hits = document.elementsFromPoint(x, y) || []
    stack = []
    for (var i = 0; i < hits.length && stack.length < MAX; i++) {
      if (hits[i].hasAttribute && hits[i].hasAttribute('data-dsh-ued-outline')) continue
      stack.push(hits[i])
    }
    return stack
  }

  function onMove(event) {
    if (!armed) return
    var hits = pickAt(event.clientX, event.clientY)
    drawOn(hits[0])
  }

  function onClick(event) {
    if (!armed) return
    // The prototype must not act on this click: it is a pick gesture, and a
    // prototype that navigates or opens a dialog here would take the stage
    // away from what the person was pointing at.
    event.preventDefault()
    event.stopPropagation()
    var hits = pickAt(event.clientX, event.clientY)
    if (hits.length === 0) return
    var described = []
    for (var i = 0; i < hits.length; i++) described.push(describe(hits[i]))
    drawOn(hits[0])
    post({ type: 'picked', candidates: described })
  }

  function swallow(event) {
    if (!armed) return
    event.preventDefault()
    event.stopPropagation()
  }

  function onKey(event) {
    if (!armed || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    disarm()
    post({ type: 'cancelled' })
  }

  function arm() {
    if (armed) return
    armed = true
    document.documentElement.style.cursor = 'crosshair'
  }

  function disarm() {
    armed = false
    stack = []
    hide()
    document.documentElement.style.cursor = ''
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerdown', swallow, true)
  window.addEventListener('mousedown', swallow, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey, true)

  window.addEventListener('message', function (event) {
    // Only the embedder can be talking to this script; a prototype forging
    // commands to itself gains nothing it could not already do directly.
    if (event.source !== parent) return
    var data = event.data
    if (!data || data.source !== CHANNEL) return
    if (data.type === 'arm') arm()
    else if (data.type === 'disarm') disarm()
    else if (data.type === 'highlight') {
      if (typeof data.depth !== 'number' || data.depth < 0) hide()
      else drawOn(stack[data.depth])
    }
  })

  post({ type: 'ready' })
})()`
