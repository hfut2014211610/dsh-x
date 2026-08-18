/**
 * Analyze ONE stored session: the anchored-standard phase contract plus the
 * reasoning-trajectory fingerprint.
 *
 * Reads only local files. No network, no API key, no cost.
 *
 * Usage (repo root, Node ^22.19 || >=24):
 *   node --import tsx/esm personal/probe/analyze-session.ts --latest
 *   node --import tsx/esm personal/probe/analyze-session.ts <session.jsonl.zstd>
 *   node --import tsx/esm personal/probe/analyze-session.ts --latest --json
 *
 * Flags:
 *   --latest            newest session under $DSH_HOME/sessions (see --project)
 *   --project <text>    substring filter on the project directory name
 *   --json              machine-readable output instead of the text report
 *
 * The report never prints reasoning text, prompts, or file contents — only
 * counts, labels, and tool names.
 */
import { decodeLog, findLogs, presetOf, reasoningByMessage } from './lib/log.ts'
import { classifyReasoning, languageOf, summarize } from './lib/classifier.ts'
import { PRESET, checkPhases } from './lib/phases.ts'
import type { Record_ } from './lib/log.ts'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function has(name: string): boolean {
  return process.argv.includes(name)
}

/**
 * The positional argument, if any — the session path.
 *
 * A bare scan for "first arg not starting with --" is wrong: it also matches
 * the VALUE of a value-taking flag, so `--min-blocks 30` made "30" look like
 * a path. Values are skipped explicitly.
 */
function positionalArg(valueFlags: readonly string[]): string | undefined {
  const args = process.argv.slice(2)
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith('--')) continue
    const previous = args[index - 1]
    if (previous !== undefined && valueFlags.includes(previous)) continue
    return arg
  }
  return undefined
}

function resolveTarget(): string {
  const positional = positionalArg(['--project'])
  if (positional !== undefined) return positional
  if (!has('--latest')) {
    console.error('usage: analyze-session.ts <session.jsonl.zstd> | --latest [--project <text>] [--json]')
    process.exit(1)
  }
  const project = flag('--project')
  const logs = findLogs({ ...project === undefined ? {} : { project }, limit: 1 })
  const newest = logs[0]
  if (newest === undefined) {
    console.error('no stored sessions found — start a session first, or pass a path')
    process.exit(1)
  }
  return newest
}

/** Count real user turns — messages the person actually sent. */
function userTurns(records: readonly Record_[]): number {
  return records.filter((record) => {
    if (record.type !== 'user/message') return false
    const source = record.data?.source as Record<string, unknown> | undefined
    return source?.kind === 'user'
  }).length
}

/** Concatenate the real user prompts, for the language tell only. */
function userText(records: readonly Record_[]): string {
  const parts: string[] = []
  for (const record of records) {
    if (record.type !== 'user/message') continue
    const source = record.data?.source as Record<string, unknown> | undefined
    if (source?.kind !== 'user') continue
    const content = record.data?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const text = (part as Record<string, unknown>)?.text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join(' ')
}

const target = resolveTarget()
const log = await decodeLog(target)
const records = log.records

const phases = checkPhases(records)
const blocks = reasoningByMessage(records).map((entry) => classifyReasoning(entry.text))
const fingerprint = summarize(blocks)

const toolCounts: Record<string, number> = {}
for (const record of records) {
  if (record.type !== 'tool/call') continue
  const name = typeof record.data?.name === 'string' ? record.data.name : '?'
  toolCounts[name] = (toolCounts[name] ?? 0) + 1
}

const report = {
  session: log.id,
  path: log.path,
  preset: presetOf(records) ?? '(not recorded)',
  model: phases.headers[0]?.model ?? '(unknown)',
  promptLanguage: languageOf(userText(records)),
  userTurns: userTurns(records),
  turns: records.filter((record) => record.type === 'turn/start').length,
  steps: records.filter((record) => record.type === 'step/start').length,
  compactions: phases.compactions,
  tornTail: log.tornStart !== undefined,
  headers: phases.headers.map((header) => ({
    index: header.index,
    reason: header.reason,
    toolCount: header.tools.length,
    tools: header.tools,
    maxTokens: header.maxTokens,
    systemChars: header.system?.length ?? 0,
  })),
  checks: phases.checks,
  reasoning: {
    blocks: fingerprint.n,
    charsTotal: fingerprint.charsTotal,
    p50: fingerprint.p50,
    p90: fingerprint.p90,
    labels: fingerprint.labels,
    anchoredShare: Number(fingerprint.anchoredShare.toFixed(3)),
    firstTokens: fingerprint.firstTokens,
    avgPerBlock: fingerprint.avg,
  },
  tools: { calls: Object.values(toolCounts).reduce((sum, n) => sum + n, 0), breakdown: toolCounts },
}

if (has('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'skip' } as const
  console.log(`session   ${report.session}`)
  console.log(`preset    ${report.preset}`)
  console.log(`model     ${report.model}`)
  console.log(`turns     ${String(report.userTurns)} user / ${String(report.turns)} agent / ${String(report.steps)} steps`)
  console.log(`compact   ${String(report.compactions)} boundary/boundaries`)
  if (report.tornTail) console.log('warning   torn tail frame ignored — the log may be mid-write')
  console.log('')
  console.log(PRESET.source === 'preset'
    ? 'phase contract (expectations read from the live preset composition)'
    : 'phase contract (WARNING: preset composition not found — checking against built-in fallbacks, which may be stale)')
  for (const check of report.checks) {
    console.log(`  [${mark[check.status]}] ${check.id.padEnd(20)} ${check.detail}`)
  }
  console.log('')
  console.log('request headers (one per catalog change)')
  for (const header of report.headers) {
    const tools = header.tools.length <= 8 ? header.tools.join(', ') : `${header.tools.slice(0, 8).join(', ')}, +${String(header.tools.length - 8)} more`
    console.log(`  #${String(header.index)} ${header.reason.padEnd(7)} ${String(header.toolCount).padStart(2)} tools  [${tools}]`)
  }
  console.log('')
  console.log('reasoning fingerprint')
  console.log(`  blocks        ${String(report.reasoning.blocks)}  (p50 ${String(report.reasoning.p50)} chars, p90 ${String(report.reasoning.p90)})`)
  console.log(`  labels        ${JSON.stringify(report.reasoning.labels)}`)
  console.log(`  anchored      ${(report.reasoning.anchoredShare * 100).toFixed(1)}% minimal-like`)
  console.log(`  per block     we ${report.reasoning.avgPerBlock.we} / let's ${report.reasoning.avgPerBlock.lets} / let me ${report.reasoning.avgPerBlock.letMe}`)
  console.log(`  first tokens  ${report.reasoning.firstTokens}`)
  if (report.promptLanguage === 'zh') {
    console.log('  note          prompts are Chinese — the English lexicon labels are near-meaningless here (see lib/classifier.ts)')
  }
  console.log('')
  console.log(`tool calls    ${String(report.tools.calls)}  ${JSON.stringify(report.tools.breakdown)}`)
}
