/**
 * ued-mode — the UED-mode policy section.
 *
 * Design work arrives as many small instructions rather than one generation
 * request, so this preset's value is concurrency: each revision runs in its own
 * continuable child while the parent session stays answerable. The two hazards
 * that creates are not covered by any tool's own contract, which is why they
 * are policy:
 *
 *  - `documents` guards writes by version, so a losing edit fails with
 *    `DOCUMENT_STALE_VERSION` rather than clobbering. Re-reading and re-applying
 *    on top of the current content is the recovery; restoring the earlier read
 *    is the lost update the guard exists to prevent.
 *  - The guard says nothing about conflicting INTENT. Two threads told to
 *    restyle the same button both succeed, and the later write silently
 *    replaces the earlier one. Nothing in the runtime can detect that, so the
 *    policy sends the model back to the user before it happens.
 *
 * Lives beside the composition rather than in a package because it is one
 * preset's policy: `dsh-agent-presets` resolves a relative row from the preset
 * directory, so the file travels with a copy of the preset.
 *
 * Design note: personal/docs/notes/proposed/2026-08-18-ued-mode.md
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ued-mode'

/** The prompt registry this plugin contributes its policy section to. */
export const inject = ['systemPrompt']

/** Every config key this plugin accepts — anything else is a typo. */
const ALLOWED_KEYS = new Set(['delegationTool', 'maxActiveThreads'])

/** Prompt-section order, matching `writing:policy`: after the persona, before tool guidance. */
const SECTION_ORDER = 90

/**
 * Read one required non-empty string config field.
 * @param value - the raw config value.
 * @param field - the config key, for the failure message.
 * @returns the validated string.
 */
function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name}: ${field} must be a non-empty string`)
  }
  return value
}

/**
 * Read one required positive-integer config field.
 * @param value - the raw config value.
 * @param field - the config key, for the failure message.
 * @returns the validated integer.
 */
function requiredPositiveInteger(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name}: ${field} must be an integer >= 1`)
  }
  return value
}

/**
 * The policy text, with the deployment's delegation tool name and thread cap.
 * @param delegationTool - the model-facing name of this preset's `tool-subagent` instance.
 * @param maxActiveThreads - how many design threads may run at once.
 * @returns the rendered policy section.
 */
function policyText(delegationTool, maxActiveThreads) {
  return [
    'You are in UED mode. You design user interfaces by producing and iterating on self-contained HTML prototypes.',
    '',
    'ARTIFACTS. One prototype is one self-contained `.html` file in the workspace: markup, styles, and any script inline, with no build step and no network-loaded assets. One file per screen. There is no intermediate representation — the HTML is the design, and the user opens it in a browser.',
    '',
    'EDITING. The only supported way to change a prototype is `document_edit` with the version returned by a prior `document_read`. Create new files with `document_create`. Do not use shell redirection or generic file tools for prototype content.',
    '',
    `CONCURRENCY. Revision instructions arrive one after another and each is small. Start a \`${delegationTool}\` thread for a revision instead of applying it inline, and keep answering the user while threads run — a child inherits this session's completed turns, so its instruction can be as short as the one you received. Send further work about an artifact to the thread that already owns it with \`send_message\` rather than starting a second one; \`list_agents\` shows what is running and \`interrupt_agent\` stops one. Keep at most ${String(maxActiveThreads)} threads active at once.`,
    '',
    'A thread keeps working after your turn ends. Do not read its artifact to check on it before its settlement notice arrives: a missing or half-written file at that moment says nothing about whether the thread will succeed, and re-sending the work only duplicates it. Report what you started, and let the notice tell you how it ended.',
    '',
    'CONFLICTS. Version guarding prevents lost writes, not conflicting intent. Apply these in order:',
    '1. Give each thread its own artifact — one screen or one file per thread. A multi-screen prototype splits this way with no conflicts at all; prefer it whenever the work allows.',
    '2. When an edit fails with `DOCUMENT_STALE_VERSION`, read the document again and re-apply your own change on top of the current content. Never write back the content you read before the failure.',
    '3. When neither fits, have the threads return proposed changes and apply them yourself in this session.',
    '',
    'Before two threads change the same visual element — the same button, the same spacing, the same color — stop and ask the user which one to make. Version guarding does not cover this: both threads report success and the later write silently replaces the other intent.',
  ].join('\n')
}

/**
 * Register the `ued:policy` system-prompt section.
 * @param ctx - the preset's agent-plane context.
 * @param config - `delegationTool` and `maxActiveThreads`, both required.
 */
export function apply(ctx, config) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(config).filter(key => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...ALLOWED_KEYS].sort().join(', ')}`,
    )
  }
  const delegationTool = requiredString(config.delegationTool, 'delegationTool')
  const maxActiveThreads = requiredPositiveInteger(config.maxActiveThreads, 'maxActiveThreads')

  ctx.systemPrompt.section({
    name: 'ued:policy',
    order: SECTION_ORDER,
    text: policyText(delegationTool, maxActiveThreads),
  })
}
