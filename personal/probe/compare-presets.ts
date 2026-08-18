/**
 * Aggregate every stored session and compare ANCHORED against WIDE first
 * requests.
 *
 * This is the A/B the `anchored-standard` note leaves open: its trajectory
 * claim is inherited from an upstream reproduction, never checked against
 * this fork's own routes. Running real work under each preset and comparing
 * the groups here is the cheapest honest answer available — no API calls, no
 * synthetic task.
 *
 * GROUPING IS BY OBSERVED CONDITION, NOT BY LABEL. A session is `anchored`
 * when its FIRST `request/header` carried exactly the bootstrap tool pair;
 * `wide` otherwise. The preset label is unreliable on its own:
 * `agent-preset/selected` is only appended when a preset is explicitly
 * picked, so a session may run anchored while its label reads
 * `(unrecorded)`. The header is the ground truth about what the model
 * actually saw, so the header decides the group and the label is reported
 * beside it.
 *
 * READ THE RESULT CAREFULLY. This is observational, not a controlled
 * experiment: sessions differ in task, model, language, and length, and you
 * chose the preset per session yourself. A difference between groups is a
 * hypothesis worth a controlled replay (`replay-first-request.ts`), never a
 * finding on its own. Small `n` is the normal case — the per-group session
 * count is printed first for that reason.
 *
 * Usage (repo root):
 *   node --import tsx/esm personal/probe/compare-presets.ts
 *   node --import tsx/esm personal/probe/compare-presets.ts --project DSH-X --limit 250
 *   node --import tsx/esm personal/probe/compare-presets.ts --days 14 --lang zh --json
 *
 * Flags:
 *   --project <text>  substring filter on the project directory name
 *   --limit <n>       scan at most this many logs, newest first (default 120)
 *   --days <n>        only sessions modified within the last n days
 *   --lang en|zh      keep only sessions whose prompts are in that language
 *   --min-blocks <n>  ignore sessions with fewer reasoning blocks (default 3)
 *   --by-preset       group by preset label instead of by observed condition
 *   --json            machine-readable output
 */
import { decodeLog, findLogs, presetOf, reasoningByMessage } from './lib/log.ts'
import { classifyReasoning, languageOf, summarize } from './lib/classifier.ts'
import { BOOTSTRAP_TOOLS, checkPhases } from './lib/phases.ts'
import type { Record_ } from './lib/log.ts'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const project = flag('--project')
const limit = Number(flag('--limit') ?? '120')
const daysRaw = flag('--days')
const days = daysRaw === undefined ? undefined : Number(daysRaw)
const lang = flag('--lang')
const minBlocks = Number(flag('--min-blocks') ?? '3')
const byPreset = process.argv.includes('--by-preset')
const asJson = process.argv.includes('--json')

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

/** One session reduced to the fields the comparison needs. */
interface Row {
  id: string
  preset: string
  model: string
  language: 'zh' | 'en'
  /** Whether request #1 carried exactly the bootstrap pair. */
  anchored: boolean
  firstCatalogSize: number
  blocks: number
  weOnlyShare: number
  letMeShare: number
  medianBlockChars: number
  we: number
  letMe: number
  steps: number
  toolCalls: number
  contractFailures: string[]
}

const logs = findLogs({
  ...project === undefined ? {} : { project },
  ...days === undefined ? {} : { since: Date.now() - days * 86_400_000 },
  limit,
})

const rows: Row[] = []
let skippedShort = 0
let skippedLang = 0
let unreadable = 0

for (const path of logs) {
  let records: readonly Record_[]
  try {
    records = (await decodeLog(path)).records
  } catch {
    unreadable += 1
    continue
  }
  const blocks = reasoningByMessage(records).map((entry) => classifyReasoning(entry.text))
  if (blocks.length < minBlocks) {
    skippedShort += 1
    continue
  }
  const language = languageOf(userText(records))
  if (lang !== undefined && language !== lang) {
    skippedLang += 1
    continue
  }
  const fingerprint = summarize(blocks)
  const phases = checkPhases(records)
  const first = phases.headers[0]
  const anchored = first !== undefined
    && first.tools.length === BOOTSTRAP_TOOLS.length
    && BOOTSTRAP_TOOLS.every((name) => first.tools.includes(name))
  rows.push({
    id: path.split(/[\\/]/).at(-2) ?? path,
    preset: presetOf(records) ?? '(unrecorded)',
    model: first?.model ?? '(unknown)',
    language,
    anchored,
    firstCatalogSize: first?.tools.length ?? 0,
    blocks: fingerprint.n,
    weOnlyShare: fingerprint.weOnlyShare,
    letMeShare: fingerprint.letMeShare,
    medianBlockChars: fingerprint.p50,
    we: Number(fingerprint.avg.we),
    letMe: Number(fingerprint.avg.letMe),
    steps: records.filter((record) => record.type === 'step/start').length,
    toolCalls: records.filter((record) => record.type === 'tool/call').length,
    // The contract only describes anchored sessions; running it against a
    // wide session would report the preset's absence as a defect.
    contractFailures: anchored
      ? phases.checks.filter((check) => check.status === 'fail').map((check) => check.id)
      : [],
  })
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

const groups = new Map<string, Row[]>()
for (const row of rows) {
  const key = byPreset ? row.preset : (row.anchored ? 'anchored (2-tool first request)' : 'wide (full first catalog)')
  const bucket = groups.get(key)
  if (bucket === undefined) groups.set(key, [row])
  else bucket.push(row)
}

const summaryRows = [...groups.entries()]
  .map(([group, members]) => ({
    group,
    sessions: members.length,
    presets: [...new Set(members.map((row) => row.preset))].join(', '),
    languages: [...new Set(members.map((row) => row.language))].sort().join('/'),
    blocks: members.reduce((sum, row) => sum + row.blocks, 0),
    weOnlyShare: mean(members.map((row) => row.weOnlyShare)),
    letMeShare: mean(members.map((row) => row.letMeShare)),
    wePerBlock: mean(members.map((row) => row.we)),
    letMePerBlock: mean(members.map((row) => row.letMe)),
    medianBlockChars: Math.round(mean(members.map((row) => row.medianBlockChars))),
    stepsPerSession: mean(members.map((row) => row.steps)),
    toolCallsPerSession: mean(members.map((row) => row.toolCalls)),
    contractFailures: members.filter((row) => row.contractFailures.length > 0).length,
  }))
  .sort((a, b) => b.sessions - a.sessions)

const scanned = { logs: logs.length, used: rows.length, skippedShort, skippedLang, unreadable }

if (asJson) {
  console.log(JSON.stringify({ scanned, groups: summaryRows, sessions: rows }, null, 2))
} else {
  console.log(`scanned ${String(scanned.logs)} logs — ${String(scanned.used)} usable, ${String(scanned.skippedShort)} too short (<${String(minBlocks)} reasoning blocks), ${String(scanned.skippedLang)} filtered by language, ${String(scanned.unreadable)} unreadable`)
  console.log('')
  if (summaryRows.length === 0) {
    console.log('nothing to compare yet — run some real work under each preset first')
  } else {
    const head = ['group', 'n', 'lang', 'blocks', 'we-only%', 'letMe%', 'we/blk', 'letMe/blk', 'p50 chars', 'steps', 'tools', 'contract✗']
    const widths = [32, 3, 5, 6, 9, 7, 7, 10, 10, 6, 6, 9]
    console.log(head.map((cell, index) => cell.padEnd(widths[index] ?? 8)).join(' '))
    for (const row of summaryRows) {
      const cells = [
        row.group,
        String(row.sessions),
        row.languages,
        String(row.blocks),
        `${(row.weOnlyShare * 100).toFixed(1)}%`,
        `${(row.letMeShare * 100).toFixed(1)}%`,
        row.wePerBlock.toFixed(1),
        row.letMePerBlock.toFixed(1),
        String(row.medianBlockChars),
        row.stepsPerSession.toFixed(1),
        row.toolCallsPerSession.toFixed(1),
        String(row.contractFailures),
      ]
      console.log(cells.map((cell, index) => cell.padEnd(widths[index] ?? 8)).join(' '))
    }
    console.log('')
    for (const row of summaryRows) {
      console.log(`  ${row.group} → presets: ${row.presets}`)
    }
    console.log('')
    console.log('we-only% = blocks using we/let\'s with no "let me"; letMe% = blocks containing "let me".')
    console.log('Groups differ in task, model and length as well as first-request condition — a gap is a hypothesis, not a result.')
  }

  const broken = rows.filter((row) => row.contractFailures.length > 0)
  if (broken.length > 0) {
    console.log('')
    console.log('anchored sessions failing the phase contract:')
    for (const row of broken.slice(0, 20)) {
      console.log(`  ${row.preset.padEnd(20)} ${row.id}  ${row.contractFailures.join(', ')}`)
    }
  }
}
