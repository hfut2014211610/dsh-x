/**
 * session-guide — one short near-field guidance line after each real user
 * message, once the session is promoted.
 *
 * DISABLED BY DEFAULT. The composition mounts this row with `disabled: true`;
 * read the whole header before turning it on, because the evidence behind the
 * default text is weaker than the evidence behind the rest of this preset.
 *
 * WHY IT EXISTS. Everything else in this preset controls the FIRST request
 * and then stops. Over a long session the anchored conditions stay in the
 * prefix but their share of the context shrinks, and nothing re-states the
 * working posture. The community preset `yjh051108/dsh-router-standard`
 * (MIT) calls the countermeasure "近距离引导" — a fixed line appended right
 * after each user message — and reports a large single-task completion effect
 * from three anchors in it: recall what is already done, converge when the
 * information is complete, and do not spend reasoning on environment checks.
 *
 * WHY IT IS OFF. Three reasons, in order of weight:
 *
 *  1. The mechanism is unverified HERE. Nothing in this fork has measured
 *     dilution, let alone this remedy for it. `personal/probe/` exists to
 *     establish that baseline first; turning this on before it is measured
 *     replaces one unproven assumption with two.
 *  2. Upstream's own data says the effect INVERTS by model: the recall and
 *     convergence anchors lift Flash, and their P24 run has the same anchors
 *     scoring the Pro suite BELOW the naked configuration. A default-on row
 *     would silently apply the harmful arm to half the routes.
 *  3. The published implementation of the idea does not run. In
 *     `dsh-router-standard` v0.3.0, `preset/router-standard/router-bootstrap.mjs`
 *     calls `bandOf` and `extractText` in its `session/event` handler while
 *     importing neither, so the handler throws before injecting anything. The
 *     mechanism below is written from the description, not ported from that
 *     code, and its numbers were never observed by anyone.
 *
 * SO: measure with `personal/probe/compare-presets.ts`, turn this on, measure
 * again. The text is a starting point, not a result.
 *
 * HOW IT WORKS. The guidance enters through the `agent/pre-step` waterfall
 * and is spliced immediately after the step's CLAIMED message batch — the
 * same position and the same reasoning as `dsh-agent-instructions`: the
 * user's own prompt precedes it, driver-appended runtime context follows it.
 * That position also keeps the prefix cache intact, which is the whole reason
 * this is a suffix and not a system-prompt edit: a pre-step message is
 * durable, so turn N's guidance is still in history at turn N+1 and the
 * shared prefix only grows.
 *
 * IDEMPOTENCE is derived from durable events, like every other phase decision
 * in this preset: the guidance id is a function of the user message it
 * follows, so a resume, a reload, or a re-claimed batch produces the same id
 * and the already-guided check finds it.
 *
 * PHASE. Nothing is injected before promotion — the anchored first request
 * must stay byte-close to a Minimal session — and a `compaction/end` boundary
 * demotes the session, so the first post-compaction request is clean too.
 * This is belt and braces: `session-guide` is not in the context gate's
 * allowlist either, so the gate would strip it while unpromoted anyway.
 *
 * CONFIG:
 *  - `text`: the guidance line. A non-empty string; defaults below.
 *  - `complexText`: optional second line used when the user message looks
 *    complex. Absent (the default) means one line for every message.
 *  - `complexPattern`: regex SOURCE (string) marking a message complex.
 *  - `complexLengthThreshold`: character count above which a message is
 *    complex, default 120. Only consulted when `complexText` is set.
 *  - `promoteOn`: 'either' (default) | 'tool-call' | 'assistant-message'.
 *  - `includeSubagents`: boolean, default false.
 *  - `enabled`: boolean, default true — `false` keeps the row mounted and
 *    inert, for A/B without editing the row set.
 *
 * Robustness: every failure degrades to "inject nothing" and warns once. A
 * guidance bug must never break a step.
 */

import { createEpochPromotion } from './compaction-epoch.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-guide'

/** Durable session event types that count as a promotion signal per mode. */
const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

/** Every config key this plugin accepts — anything else is a typo. */
const ALLOWED_KEYS = new Set([
  'text', 'complexText', 'complexPattern', 'complexLengthThreshold',
  'promoteOn', 'includeSubagents', 'enabled',
])

/**
 * The three anchors, in the order upstream states them: recall, then
 * anti-runaway, then convergence. Deliberately short — this text repeats
 * once per user turn, so its cost is paid every turn for the whole session.
 */
const DEFAULT_TEXT = 'Before acting, review what you have already done in this session and continue from there; do not repeat completed steps. Do not spend reasoning on environment or tooling checks. Produce when your information is complete.'

/** `source.kind` of the messages this plugin emits. */
const GUIDE_KIND = 'session-guide'

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

/** Validate an optional boolean flag with a default. */
function booleanOption(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${name}: ${field} must be a boolean`)
  return value
}

/** Validate an optional non-empty string. */
function textOption(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name}: ${field} must be a non-empty string`)
  }
  return value
}

/** Compile the complexity regex at mount, so a bad pattern fails visibly. */
function patternOption(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name}: ${field} must be a non-empty regex source string`)
  }
  try {
    return new RegExp(value, 'i')
  } catch (error) {
    throw new TypeError(`${name}: ${field} is not a valid regex: ${String((error && error.message) || error)}`)
  }
}

/** Validate an optional positive integer. */
function positiveIntOption(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name}: ${field} must be a positive integer`)
  }
  return value
}

/** The plain text of a message's content blocks. */
function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block === 'string') parts.push(block)
    else if (typeof block?.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Register the near-field guidance injector. */
export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...ALLOWED_KEYS].sort().join(', ')}`,
    )
  }
  const promoteEvents = parsePromoteOn(source.promoteOn)
  const includeSubagents = booleanOption(source.includeSubagents, 'includeSubagents', false)
  const enabled = booleanOption(source.enabled, 'enabled', true)
  const text = textOption(source.text, 'text', DEFAULT_TEXT)
  const complexText = textOption(source.complexText, 'complexText', undefined)
  const complexPattern = patternOption(source.complexPattern, 'complexPattern')
  const complexLengthThreshold = positiveIntOption(source.complexLengthThreshold, 'complexLengthThreshold', 120)

  const promotion = createEpochPromotion(promoteEvents, { includeSubagents })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  /**
   * sessionId -> Set of user-message ids already guided. Seeded from the
   * durable log on first use (restart-safe), then maintained incrementally.
   */
  const guided = new Map()
  const guidedIds = (session) => {
    let known = guided.get(session.id)
    if (known !== undefined) return known
    known = new Set()
    for (const event of session.events) {
      if (event.type !== 'user/message') continue
      if (event.data?.source?.kind !== GUIDE_KIND) continue
      const forMessage = event.data?.source?.forMessage
      if (typeof forMessage === 'string') known.add(forMessage)
    }
    guided.set(session.id, known)
    return known
  }
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    if (event.data?.source?.kind !== GUIDE_KIND) return
    const forMessage = event.data?.source?.forMessage
    if (typeof forMessage === 'string') guidedIds(session).add(forMessage)
  })

  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid spamming.
    }
  }

  ctx.on('agent/pre-step', async ({ agent, messages: claimed }, next) => {
    // Downstream errors propagate untouched; only this plugin's logic is guarded.
    const decision = await next()
    if (enabled === false) return decision
    if (decision.kind === 'reject') return decision
    try {
      if (promotion.status(agent).promoted !== true) return decision
      const session = agent.session
      if (session === undefined) return decision
      if (!Array.isArray(claimed) || !Array.isArray(decision.messages)) return decision

      // One guidance per REAL user turn. A step that claims no user message
      // is a tool continuation: the guidance for that turn is already in
      // history, and repeating it per step would both cost tokens and read
      // as nagging.
      const userMessage = claimed.find((message) => message?.source?.kind === 'user')
      if (userMessage === undefined) return decision
      const userId = userMessage.id
      if (typeof userId !== 'string') return decision
      const already = guidedIds(session)
      if (already.has(userId)) return decision

      const body = complexText !== undefined && isComplex(messageText(userMessage))
        ? complexText
        : text
      already.add(userId)

      const guide = {
        id: `session-guide-${userId}`,
        role: 'user',
        content: [{ type: 'text', text: body }],
        source: { kind: GUIDE_KIND, form: 'guide', forMessage: userId },
      }

      // Fold in right after the claimed batch: the user's own prompt precedes
      // the guidance, driver-appended runtime context follows it. Same
      // placement rule as `dsh-agent-instructions`.
      const lastClaimed = decision.messages.findLastIndex((message) => claimed.includes(message))
      const at = lastClaimed < 0 ? decision.messages.length : lastClaimed + 1
      return { ...decision, messages: decision.messages.toSpliced(at, 0, guide) }
    } catch (error) {
      // A guidance bug must never break a step: emit nothing this turn.
      warnOnce(`${name}: guidance injection failed, skipping: ${String((error && error.message) || error)}`)
      return decision
    }
  }, { prepend: true })

  /**
   * Depth dispatch, only consulted when `complexText` is configured. The
   * heuristic is crude on purpose — length plus an optional caller-supplied
   * keyword pattern. Upstream ships a bilingual keyword list tuned on its own
   * routes; baking that list in here would import their tuning as if it were
   * a finding, so the pattern is left to the operator.
   */
  function isComplex(body) {
    if (body.length > complexLengthThreshold) return true
    return complexPattern !== undefined && complexPattern.test(body)
  }
}
