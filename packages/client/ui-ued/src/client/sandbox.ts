/**
 * The preview frame's isolation, kept apart from the view so it can be asserted
 * directly. The decisions and the Chromium measurements behind them are in this
 * package's README, under "The preview frame".
 *
 * @module @deepseek-ai/dsh-client-ui-ued/sandbox
 */

import { INSPECT_SCRIPT } from './inspect.ts'

/**
 * Every sandbox token the preview frame is ever given.
 *
 * `allow-scripts` alone. Adding `allow-same-origin` beside it would put the
 * framed document on the host's origin, from where it can reach
 * `parent.document`, delete its own `sandbox` attribute and reload with full
 * host privileges. Measured in Chromium: with `allow-scripts` the child's
 * `parent.document` access throws and the parent reads `contentDocument` as
 * `null`; add `allow-same-origin` and both succeed. Nothing about the preview
 * looks different when this is wrong, which is why it is asserted rather than
 * reviewed.
 */
export const PREVIEW_SANDBOX = 'allow-scripts'

/**
 * Tokens that must never appear in {@link PREVIEW_SANDBOX}. `allow-same-origin`
 * dissolves the boundary outright; the rest hand a prototype the ability to
 * navigate the whole app away, block the host UI thread behind `alert`, write
 * files, or submit a form off-app. A prototype needs none of them — it handles
 * its own submit in inline script.
 */
export const FORBIDDEN_SANDBOX_TOKENS: readonly string[] = [
  'allow-same-origin',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-modals',
  'allow-downloads',
  'allow-forms',
]

/**
 * The policy the framed document runs under. It enforces what the `ued` policy
 * section only asks the model for — self-contained, no network-loaded assets —
 * and closes the browser-trust fence's no-Origin GET gap by forbidding the
 * frame from issuing subresource requests at all.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  'img-src data:',
  "style-src 'unsafe-inline' data:",
  "script-src 'unsafe-inline'",
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`

/** How much the frame is asked to carry beyond the prototype itself. */
export interface PreviewOptions {
  /**
   * Inject the element picker ({@link INSPECT_SCRIPT}).
   *
   * Off by default, so this function's plain form stays exactly the document
   * the model wrote plus the policy. The view turns it on for every preview
   * rather than at the moment someone arms the picker: injecting later would
   * mean reloading the frame, and a prototype reloaded mid-inspection loses
   * whatever state the person navigated it into — which is usually the state
   * they wanted to point at.
   *
   * It grants the prototype nothing. `postMessage` to the embedder was never
   * gated by `sandbox`, so a hostile prototype could always talk to the host;
   * what changes is that the host now listens, and that listener is what
   * `readInspectMessage` hardens.
   */
  readonly inspect?: boolean
}

/** Head content inserted ahead of the prototype's own, policy always first. */
function preamble(options: PreviewOptions | undefined): string {
  // The policy leads unconditionally: a script inserted before it would run
  // under whatever the document declares for itself, which is the one thing
  // this insert exists to overrule.
  if (options?.inspect !== true) return CSP_META
  return `${CSP_META}<script>${INSPECT_SCRIPT}</script>`
}

/**
 * Wrap one prototype for `srcdoc` injection, putting the CSP where the parser
 * will honour it.
 *
 * A `srcdoc` document inherits the embedding document's CSP (measured), and
 * this app declares none — so the policy has to travel inside the document.
 * Placement is the whole difficulty: a meta element ahead of `<!doctype html>`
 * drops the page into quirks mode and changes how it renders, so the insert
 * goes after `<head>` when there is one, and manufactures a head otherwise.
 *
 * This is a defence in depth, not the defence: {@link PREVIEW_SANDBOX} is. A
 * prototype whose markup defeats the insert is still confined by the sandbox.
 * @param html - the prototype document, as the model wrote it.
 * @param options - what else the frame should carry; the picker is opt-in.
 * @returns markup for the frame's `srcdoc`.
 */
export function previewSrcdoc(html: string, options?: PreviewOptions): string {
  const inserted = preamble(options)
  const head = /<head\b[^>]*>/i.exec(html)
  if (head !== null) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${inserted}${html.slice(at)}`
  }
  const htmlTag = /<html\b[^>]*>/i.exec(html)
  if (htmlTag !== null) {
    const at = htmlTag.index + htmlTag[0].length
    return `${html.slice(0, at)}<head>${inserted}</head>${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype !== null) {
    return `${doctype[0]}<html><head>${inserted}</head>${html.slice(doctype[0].length)}</html>`
  }
  return `<!doctype html><html><head>${inserted}</head><body>${html}</body></html>`
}

/** Prototype file extensions this view previews. */
const PREVIEWABLE = ['.html', '.htm']

/**
 * Whether a workspace path is one this view renders.
 * @param path - workspace-relative document path.
 * @returns true for a prototype document.
 */
export function isPreviewable(path: string): boolean {
  const lower = path.toLowerCase()
  return PREVIEWABLE.some(extension => lower.endsWith(extension))
}
