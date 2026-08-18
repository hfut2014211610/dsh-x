/**
 * The preview frame's isolation, kept apart from the view so it can be asserted
 * directly. The decisions and the Chromium measurements behind them are in this
 * package's README, under "The preview frame".
 *
 * @module @deepseek-ai/dsh-client-ui-ued/sandbox
 */

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
 * @returns markup for the frame's `srcdoc`.
 */
export function previewSrcdoc(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html)
  if (head !== null) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${CSP_META}${html.slice(at)}`
  }
  const htmlTag = /<html\b[^>]*>/i.exec(html)
  if (htmlTag !== null) {
    const at = htmlTag.index + htmlTag[0].length
    return `${html.slice(0, at)}<head>${CSP_META}</head>${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype !== null) {
    return `${doctype[0]}<html><head>${CSP_META}</head>${html.slice(doctype[0].length)}</html>`
  }
  return `<!doctype html><html><head>${CSP_META}</head><body>${html}</body></html>`
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
