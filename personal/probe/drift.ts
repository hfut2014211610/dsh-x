/**
 * Does the anchor HOLD? — trajectory drift within long sessions.
 *
 * Every other instrument here measures the FIRST request. That is what the
 * preset controls, but it is not what the preset CLAIMS: the claim is that
 * first-request conditions anchor the whole session. A single-request replay
 * cannot test that, however many cells it runs, because the thing at issue
 * only exists after step 1.
 *
 * The stored logs are long-horizon by construction, so drift is measurable
 * for free. This script walks one session's reasoning blocks in order,
 * buckets them by position, and reports the fingerprint per bucket. A flat
 * profile means the anchor held; a monotone slide toward `let me` means it
 * eroded, and roughly WHERE it eroded.
 *
 * It also segments by COMPACTION EPOCH. The preset deliberately re-narrows
 * the catalog at every `compaction/end` on the theory that the first
 * post-compaction request is a second first request. If that theory holds,
 * the fingerprint should RECOVER after a boundary rather than keep sliding
 * through it — a sharper test of the re-anchor design than the phase
 * contract, which only proves the catalog narrowed, not that narrowing
 * changed anything.
 *
 * Reads only local files. No network, no API key, no cost.
 *
 * Usage (repo root):
 *   node --import tsx/esm personal/probe/drift.ts --latest
 *   node --import tsx/esm personal/probe/drift.ts <session.jsonl.zstd>
 *   node --import tsx/esm personal/probe/drift.ts --all --min-blocks 50
 *
 * Flags:
 *   --latest          newest stored session
 *   --all             every stored session with enough blocks
 *   --buckets <n>     position buckets per session (default 10)
 *   --min-blocks <n>  skip sessions with fewer blocks (default 30)
 *   --project <text>  substring filter on the project directory name
 *   --json            machine-readable output
 */
import { decodeLog, findLogs, presetOf } from './lib/log.ts'
import { classifyReasoning, summarize } from './lib/classifier.ts'
import { BOOTSTRAP_TOOLS, headerTimeline } from './lib/phases.ts'
import type { Record_ } from './lib/log.ts'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
function has(name: string): boolean {
  return process.argv.includes(name)
}

const buckets = Number(flag('--buckets') ?? '10')
const minBlocks = Number(flag('--min-blocks') ?? '30')
const asJson = has('--json')

/** One reasoning block with the position metadata drift analysis needs. */
interface Block {
  /** 0-based index among the session's reasoning blocks. */
  index: number
  /** Agent turn the block belongs to. */
  turn: number
  /** How many `compaction/end` boundaries preceded it. */
  epoch: number
  text: string
}

/**
 * Reasoning blocks in order, each tagged with its compaction epoch.
 *
 * Same joining rule as `lib/log.ts` (the `reasoning-chunks` members of one
 * turn:step form one block), but this walk also tracks boundaries, which the
 * plain reader discards.
 */
function blocksOf(records: readonly Record_[]): Block[] {
  const byKey = new Map<string, { turn: number, epoch: number, parts: string[] }>()
  const order: string[] = []
  let epoch = 0
  for (const record of records) {
    if (record.type === 'compaction/end') {
      epoch += 1
      continue
    }
    if (record.type !== 'reasoning-chunks') continue
    const data = record.data ?? {}
    const turn = typeof data.turn === 'number' ? data.turn : -1
    const key = `e${String(epoch)}:t${String(turn)}:s${String(data.step ?? '?')}`
    let entry = byKey.get(key)
    if (entry === undefined) {
      entry = { turn, epoch, parts: [] }
      byKey.set(key, entry)
      order.push(key)
    }
    const texts = data.texts
    if (Array.isArray(texts)) entry.parts.push(...texts.filter((part): part is string => typeof part === 'string'))
  }
  return order.map((key, index) => {
    const entry = byKey.get(key)
    return { index, turn: entry?.turn ?? -1, epoch: entry?.epoch ?? 0, text: (entry?.parts ?? []).join('') }
  })
}

/** Fold a group of blocks into the rates drift is read from. */
function rates(group: readonly Block[]): { n: number, weOnly: number, letMe: number, p50: number, turns: number } {
  const fingerprint = summarize(group.map((block) => classifyReasoning(block.text)))
  return {
    n: group.length,
    weOnly: fingerprint.weOnlyShare,
    letMe: fingerprint.letMeShare,
    p50: fingerprint.p50,
    turns: new Set(group.map((block) => block.turn)).size,
  }
}

function bar(share: number): string {
  const filled = Math.round(share * 20)
  return '#'.repeat(filled) + '.'.repeat(20 - filled)
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

const targets: string[] = []
const explicit = positionalArg(['--buckets', '--min-blocks', '--project'])
if (explicit !== undefined) targets.push(explicit)
else {
  const project = flag('--project')
  const found = findLogs({ ...project === undefined ? {} : { project }, limit: 250 })
  if (has('--all')) targets.push(...found)
  else if (found[0] !== undefined) targets.push(found[0])
}
if (targets.length === 0) {
  console.error('usage: drift.ts <session.jsonl.zstd> | --latest | --all')
  process.exit(1)
}

const reports = []
for (const path of targets) {
  let log
  try {
    log = await decodeLog(path)
  } catch {
    continue
  }
  const blocks = blocksOf(log.records)
  if (blocks.length < minBlocks) continue
  const headers = headerTimeline(log.records)
  const firstHeader = headers[0]
  const anchored = firstHeader !== undefined
    && firstHeader.tools.length === BOOTSTRAP_TOOLS.length
    && BOOTSTRAP_TOOLS.every((name) => firstHeader.tools.includes(name))

  const size = Math.ceil(blocks.length / buckets)
  const positional = []
  for (let i = 0; i < blocks.length; i += size) positional.push(rates(blocks.slice(i, i + size)))
  const epochs = [...new Set(blocks.map((block) => block.epoch))]
    .sort((a, b) => a - b)
    .map((epoch) => ({ epoch, ...rates(blocks.filter((block) => block.epoch === epoch)) }))

  reports.push({
    session: log.id,
    preset: presetOf(log.records) ?? '(unrecorded)',
    model: firstHeader?.model ?? '(unknown)',
    anchored,
    blocks: blocks.length,
    compactions: epochs.length - 1,
    overall: rates(blocks),
    positional,
    epochs,
  })
}

if (asJson) {
  console.log(JSON.stringify(reports, null, 2))
} else if (reports.length === 0) {
  console.log(`no session had >= ${String(minBlocks)} reasoning blocks`)
} else {
  for (const report of reports) {
    console.log('')
    console.log(`${report.session}   ${report.preset} / ${report.model}   ${report.anchored ? 'ANCHORED' : 'wide'} first request`)
    console.log(`${String(report.blocks)} blocks, ${String(report.compactions)} compaction boundary/boundaries, overall we-only ${(report.overall.weOnly * 100).toFixed(0)}% / letMe ${(report.overall.letMe * 100).toFixed(0)}%`)
    console.log('  position   blocks  we-only                letMe    p50')
    for (const [index, bucket] of report.positional.entries()) {
      const from = String(Math.round((index / report.positional.length) * 100)).padStart(3)
      const to = String(Math.round(((index + 1) / report.positional.length) * 100)).padStart(3)
      console.log(`  ${from}-${to}%  ${String(bucket.n).padStart(6)}  ${bar(bucket.weOnly)} ${(bucket.weOnly * 100).toFixed(0).padStart(3)}%  ${(bucket.letMe * 100).toFixed(0).padStart(3)}%  ${String(bucket.p50).padStart(5)}`)
    }
    const head = report.positional[0]
    const tail = report.positional[report.positional.length - 1]
    if (head !== undefined && tail !== undefined) {
      const delta = (tail.weOnly - head.weOnly) * 100
      const verdict = Math.abs(delta) < 10 ? 'STABLE' : delta < 0 ? 'DECAY' : 'RISE'
      console.log(`  trend: we-only ${(head.weOnly * 100).toFixed(0)}% -> ${(tail.weOnly * 100).toFixed(0)}%  (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} pts) ${verdict}`)
    }
    if (report.compactions > 0) {
      console.log('  by compaction epoch (does the re-anchor recover the fingerprint?)')
      for (const epoch of report.epochs) {
        console.log(`    epoch ${String(epoch.epoch)}  ${String(epoch.n).padStart(4)} blocks  we-only ${(epoch.weOnly * 100).toFixed(0).padStart(3)}%  letMe ${(epoch.letMe * 100).toFixed(0).padStart(3)}%  p50 ${String(epoch.p50)}`)
      }
    }
  }
}
