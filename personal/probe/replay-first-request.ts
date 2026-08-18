/**
 * Controlled replay of a real first request — the PAID instrument.
 *
 * `compare-presets.ts` can only correlate: its groups differ in task, model,
 * and length as well as in first-request condition. This script removes that
 * confound by holding the task fixed and varying one lever at a time, using
 * the EXACT system prompt and tool schemas lifted from a stored session's
 * `request/header` rather than hand-written fixtures. That matters: every
 * upstream reproduction of this effect approximated the schemas and shipped a
 * 1024-token output cap in the same change, so their "tool schema" lever was
 * never cleanly separated. Here the schemas are byte-real and the cap is an
 * explicit, separately controlled flag.
 *
 * The preset bundles THREE levers, and this script separates all three:
 * the SYSTEM text, the TOOL CATALOG, and the AUTO-INJECTED CONTEXT the
 * context gate suppresses. Cells A-D form the system x catalog 2x2; cells
 * E and F add the injected context lifted from a real wide session, so
 * A vs E isolates injection at a fixed system and catalog, and F is the
 * COMPLETE ordinary standard first request (D omits injection, so D alone
 * is not that baseline).
 *
 * COST: this sends real requests to a real endpoint and spends real money.
 * Nothing is sent without `--run`; the default is a dry run that prints the
 * plan and the estimated request count.
 *
 * Usage (repo root):
 *   node --import tsx/esm personal/probe/replay-first-request.ts
 *   node --import tsx/esm personal/probe/replay-first-request.ts --run --n 3
 *   node --import tsx/esm personal/probe/replay-first-request.ts --run \
 *     --session <anchored.jsonl.zstd> --wide-session <wide.jsonl.zstd>
 *
 * Flags:
 *   --session <path>       anchored source session (default: newest anchored)
 *   --wide-session <path>  wide source session; enables the 2x2
 *   --n <k>                runs per cell (default 3)
 *   --model <a,b>          model ids to run, comma-separated (default: the
 *                          session header's). Every model runs every cell, so
 *                          a per-model difference is directly comparable.
 *   --provider <name>      provider route name, for base-URL and key lookup
 *   --protocol <p>         `openai` (default) or `anthropic` — must match the
 *                          protocol the harness routes these models under
 *   --thinking-budget <k>  anthropic extended-thinking budget
 *   --max-tokens <k>       output cap (default: the session header's, clamped)
 *   --prompt <text>        replace the lifted user message
 *   --cells A,B            run only these cells
 *   --run                  actually send requests
 *
 * Nothing is printed but counts, labels, and tool names — no reasoning text,
 * no prompt text, no key.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeLog, findLogs } from './lib/log.ts'
import { classifyReasoning, languageOf, summarize } from './lib/classifier.ts'
import { BOOTSTRAP_TOOLS, headerTimeline } from './lib/phases.ts'
import { parseProtocol, resolveRoute, sendTurn } from './lib/endpoint.ts'
import type { Record_ } from './lib/log.ts'
import type { HeaderSnapshot } from './lib/phases.ts'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const runs = Number(flag('--n') ?? '3')
const live = process.argv.includes('--run')

/** The raw `request/header` records, which still carry full tool schemas. */
function rawHeaders(records: readonly Record_[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const record of records) {
    if (record.type !== 'request/header') continue
    const header = record.data?.header
    if (typeof header === 'object' && header !== null) out.push(header as Record<string, unknown>)
  }
  return out
}

/** The first message the person actually sent, as plain text. */
function firstUserText(records: readonly Record_[]): string | undefined {
  for (const record of records) {
    if (record.type !== 'user/message') continue
    const source = record.data?.source as Record<string, unknown> | undefined
    if (source?.kind !== 'user') continue
    const content = record.data?.content
    if (!Array.isArray(content)) continue
    const parts = content
      .map((part) => (part as Record<string, unknown>)?.text)
      .filter((text): text is string => typeof text === 'string')
    if (parts.length > 0) return parts.join('\n')
  }
  return undefined
}

/**
 * The auto-injected context a session's first request carried, in log order.
 *
 * These are real `user/message` events whose `source.kind` marks them as
 * harness-produced rather than typed by the person — the AGENTS.md digest,
 * the skill catalog, runtime-context snapshots. Lifting them keeps the
 * injection arm byte-real like the other two.
 */
function injectedContext(records: readonly Record_[]): string[] {
  const kinds = new Set(['agent-instructions', 'skill-catalog', 'runtime-context', 'plugin'])
  const out: string[] = []
  for (const record of records) {
    if (record.type !== 'user/message') continue
    const source = record.data?.source as Record<string, unknown> | undefined
    if (typeof source?.kind !== 'string' || !kinds.has(source.kind)) continue
    const content = record.data?.content
    if (!Array.isArray(content)) continue
    const text = content
      .map((part) => (part as Record<string, unknown>)?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('')
    if (text.length > 0) out.push(text)
  }
  return out
}

function isAnchored(header: HeaderSnapshot | undefined): boolean {
  return header !== undefined
    && header.tools.length === BOOTSTRAP_TOOLS.length
    && BOOTSTRAP_TOOLS.every((name) => header.tools.includes(name))
}

/** Pick the newest stored session matching a predicate on its header timeline. */
async function pickSession(want: 'anchored' | 'wide'): Promise<string> {
  for (const path of findLogs({ limit: 250 })) {
    let records: readonly Record_[]
    try {
      records = (await decodeLog(path)).records
    } catch {
      continue
    }
    const headers = headerTimeline(records)
    if (headers.length === 0 || firstUserText(records) === undefined) continue
    const anchored = isAnchored(headers[0])
    if (want === 'anchored' ? anchored : !anchored) return path
  }
  throw new Error(`no stored ${want} session found — run one first, or pass an explicit path`)
}

const anchoredPath = flag('--session') ?? await pickSession('anchored')
const anchoredLog = await decodeLog(anchoredPath)
const anchoredHeaders = rawHeaders(anchoredLog.records)
const anchoredTimeline = headerTimeline(anchoredLog.records)
const first = anchoredHeaders[0]
if (first === undefined) throw new Error(`${anchoredPath} has no request/header event`)
if (!isAnchored(anchoredTimeline[0])) {
  throw new Error(`${anchoredPath} did not start anchored — its first catalog is [${(anchoredTimeline[0]?.tools ?? []).join(', ')}]`)
}

const promptText = flag('--prompt') ?? firstUserText(anchoredLog.records)
if (promptText === undefined) throw new Error(`${anchoredPath} contains no user message — pass --prompt`)

const anchoredSystem = typeof first.system === 'string' ? first.system : undefined
const anchoredTools = (Array.isArray(first.tools) ? first.tools : [])

// The widest catalog this session ever showed — the realistic "wide" arm when
// no separate wide session is supplied.
const widestLocal = anchoredHeaders.reduce((best, header) => {
  const size = Array.isArray(header.tools) ? header.tools.length : 0
  const bestSize = Array.isArray(best.tools) ? best.tools.length : 0
  return size > bestSize ? header : best
}, first)

// The wide arm comes from a real wide session when one exists, so both arms
// are byte-real. Falling back to this session's own widest header keeps the
// script usable on a fresh machine, but that arm is only bootstrap + the
// discovery tools, which is a much weaker contrast — say so rather than let
// a narrow contrast read as a null result.
const widePath = flag('--wide-session') ?? await pickSession('wide').catch(() => undefined)
let wideSystem = anchoredSystem
let wideTools = (Array.isArray(widestLocal.tools) ? widestLocal.tools : [])
let wideSource = `${anchoredLog.id} widest header (${String(wideTools.length)} tools) — NO wide session available, weak contrast`
// The injection arm needs a session that actually carried injected context;
// an anchored session by construction has none, so it comes from the wide one.
let injected: string[] = []
if (widePath !== undefined) {
  const wideLog = await decodeLog(widePath)
  const wideFirst = rawHeaders(wideLog.records)[0]
  if (wideFirst === undefined) throw new Error(`${widePath} has no request/header event`)
  wideSystem = typeof wideFirst.system === 'string' ? wideFirst.system : undefined
  wideTools = (Array.isArray(wideFirst.tools) ? wideFirst.tools : [])
  wideSource = `${wideLog.id} header#0 (${String(wideTools.length)} tools, system ${String(wideSystem?.length ?? 0)} chars)`
  injected = injectedContext(wideLog.records)
}

const anchoredConfig = first.config as Record<string, unknown> | undefined
const protocol = parseProtocol(flag('--protocol') ?? process.env.PROBE_PROTOCOL)
const thinkingBudgetFlag = flag('--thinking-budget')

// The logged cap belongs to the session's own route. It is honoured when the
// replay targets that same model, but a probe reads the FIRST reasoning block
// and the model stops on its own well before any large cap — so the default is
// clamped, both to bound a runaway bill and to keep the anthropic thinking
// budget in a range the API accepts.
const MAX_TOKENS_CEILING = 32_768
const liftedMaxTokens = typeof anchoredConfig?.maxTokens === 'number' ? anchoredConfig.maxTokens : 8192
const maxTokens = flag('--max-tokens') !== undefined
  ? Number(flag('--max-tokens'))
  : Math.min(liftedMaxTokens, MAX_TOKENS_CEILING)

// The 2x2 is the point: A vs B isolates the CATALOG lever at a fixed system,
// A vs C isolates the SYSTEM lever at a fixed catalog, and D is the ordinary
// standard-preset condition. Cells C and D need a wide system to exist; when
// the wide arm fell back to this session's own header, the system is the same
// text and those two cells would duplicate A and B.
interface Cell { id: string, system: string | undefined, tools: unknown[], context?: string[] }
const allCells: Cell[] = [
  { id: 'A-minimal-system+bootstrap-pair', system: anchoredSystem, tools: anchoredTools },
  { id: 'B-minimal-system+wide-catalog', system: anchoredSystem, tools: wideTools },
]
if (wideSystem !== anchoredSystem) {
  allCells.push(
    { id: 'C-wide-system+bootstrap-pair', system: wideSystem, tools: anchoredTools },
    { id: 'D-wide-system+wide-catalog', system: wideSystem, tools: wideTools },
  )
}
// The injection arm. E holds system and catalog at the anchored values and
// varies ONLY the injected context, which is what the context gate controls;
// F is the complete ordinary first request, injection included.
if (injected.length > 0) {
  allCells.push({ id: 'E-minimal+bootstrap+injection', system: anchoredSystem, tools: anchoredTools, context: injected })
  if (wideSystem !== anchoredSystem) {
    allCells.push({ id: 'F-wide+wide+injection', system: wideSystem, tools: wideTools, context: injected })
  }
}
const only = flag('--cells')?.split(',').map((name) => name.trim().toUpperCase())
const cells = only === undefined
  ? allCells
  : allCells.filter((cell) => only.includes(cell.id.slice(0, 1)))

// Every named model runs every cell, so a per-model difference in the SAME
// cell is directly comparable — which matters here, because the upstream
// claim this probe exists to check is itself model-dependent.
const models = (flag('--model') ?? anchoredTimeline[0]?.model ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name.length > 0)
if (models.length === 0) throw new Error('no model — pass --model, or point --session at a session whose header records one')
const providerFlag = flag('--provider') ?? (typeof anchoredConfig?.provider === 'string' ? anchoredConfig.provider : undefined)

console.log(`anchored source  ${anchoredLog.id} (${String(anchoredTools.length)} tools, system ${String(anchoredSystem?.length ?? 0)} chars)`)
console.log(`wide source      ${wideSource}`)
console.log(`prompt           ${String(promptText.length)} chars, language ${languageOf(promptText)}`)
console.log(`models           ${models.join(', ')}`)
console.log(`protocol         ${protocol}   maxTokens ${String(maxTokens)}${maxTokens < liftedMaxTokens ? ` (clamped from the session header's ${String(liftedMaxTokens)})` : ''}`)
console.log(`injected ctx     ${injected.length === 0 ? '(none found — cells E/F skipped)' : `${String(injected.length)} message(s), ${String(injected.reduce((sum, text) => sum + text.length, 0))} chars`}`)
console.log(`cells            ${cells.map((cell) => cell.id).join(', ')}`)
console.log(`requests         ${String(models.length * cells.length * runs)} (${String(models.length)} models x ${String(cells.length)} cells x ${String(runs)} runs)`)

if (!live) {
  console.log('')
  console.log('DRY RUN — nothing sent. Add --run to spend real API calls.')
  process.exit(0)
}

const results: Record<string, unknown>[] = []
for (const model of models) {
  const route = resolveRoute({ model, ...providerFlag === undefined ? {} : { provider: providerFlag } })
  console.log('')
  console.log(`── ${model} @ ${route.baseUrl} (${protocol}, key from ${route.keySource})`)
  for (const cell of cells) {
    const classified = []
    const toolNames: string[] = []
    let outputTokens = 0
    let failures = 0
    for (let run = 0; run < runs; run += 1) {
      try {
        const turn = await sendTurn({
          route,
          protocol,
          system: cell.system,
          user: promptText,
          tools: cell.tools,
          ...cell.context === undefined ? {} : { contextMessages: cell.context },
          maxTokens,
          ...thinkingBudgetFlag === undefined ? {} : { thinkingBudget: Number(thinkingBudgetFlag) },
        })
        classified.push(classifyReasoning(turn.reasoning, turn.content.length > 0))
        toolNames.push(...turn.toolNames)
        outputTokens += turn.outputTokens ?? 0
      } catch (error) {
        // One bad run must not discard the cell; a cell that lost runs says so.
        failures += 1
        console.log(`   run ${String(run + 1)} failed: ${String((error as Error).message).slice(0, 160)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    const fingerprint = summarize(classified)
    results.push({
      model,
      protocol,
      cell: cell.id,
      runs,
      failures,
      toolCount: cell.tools.length,
      injectedChars: (cell.context ?? []).reduce((sum, text) => sum + text.length, 0),
      labels: fingerprint.labels,
      weOnlyShare: Number(fingerprint.weOnlyShare.toFixed(3)),
      letMeShare: Number(fingerprint.letMeShare.toFixed(3)),
      avgPerBlock: fingerprint.avg,
      reasoningChars: fingerprint.charsTotal,
      medianBlockChars: fingerprint.p50,
      firstTokens: fingerprint.firstTokens,
      toolsRequested: toolNames,
      outputTokens,
    })
    const note = failures > 0 ? `  (${String(failures)} failed)` : ''
    console.log(`   ${cell.id.padEnd(34)} we ${fingerprint.avg.we} / let's ${fingerprint.avg.lets} / let me ${fingerprint.avg.letMe}  |  we-only ${(fingerprint.weOnlyShare * 100).toFixed(0)}%  letMe ${(fingerprint.letMeShare * 100).toFixed(0)}%  |  ${String(fingerprint.charsTotal)} chars  |  ${fingerprint.firstTokens}${note}`)
  }
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replaceAll(':', '-')
const outPath = join(outDir, `replay-${stamp}.json`)
writeFileSync(outPath, `${JSON.stringify({
  models,
  protocol,
  maxTokens,
  runs,
  anchoredSource: anchoredLog.id,
  wideSource,
  promptChars: promptText.length,
  promptLanguage: languageOf(promptText),
  results,
}, null, 2)}\n`, 'utf8')
console.log('')
console.log(`saved ${outPath}`)
