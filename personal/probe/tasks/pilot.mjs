/**
 * Pilot batch of the outcome study: two tasks, two conditions, scored by
 * command exit codes rather than by anyone's reading of the transcript.
 *
 * WHAT THIS IS FOR. Every earlier instrument in `personal/probe/` measures a
 * lexical fingerprint of the reasoning, and the documentation keeps repeating
 * that a fingerprint is not capability. This is the first thing here that
 * measures whether the work came out right.
 *
 * ISOLATION. Each run happens in a detached git worktree, reset between runs,
 * so one run cannot see or inherit another's edits. The worktree needs two
 * things git does not give it:
 *
 *  - `node_modules`, junctioned from the main checkout (pnpm keeps most deps
 *    in per-package directories, so a few suites still cannot resolve their
 *    imports there — `EXCLUDE_SPEC` names the one that matters here, and the
 *    baseline is verified green before any run);
 *  - `personal/probe/`, copied in, because it is untracked and a worktree
 *    only carries tracked files.
 *
 * SCORING. Two gates per task: the task's own command must exit 0, and the
 * run must not have cheated (T1 forbids editing the tests it has to satisfy).
 * Nothing here inspects prose.
 *
 * VALIDITY. Every anchored run is checked against the preset's phase
 * contract. A run whose first request was not the anchored condition is
 * reported INVALID and its score is not counted, however it scored.
 *
 * Usage (repo root):
 *   node personal/probe/tasks/pilot.mjs --setup     # build the worktree once
 *   node personal/probe/tasks/pilot.mjs             # run the batch
 *   node personal/probe/tasks/pilot.mjs --only t1
 *   node personal/probe/tasks/pilot.mjs --only l1 --condition wide --runs 1
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const WT = resolve(REPO, '../.dsh-probe-worktree')
/**
 * Specs that cannot load in the worktree at all, so they fail on a clean tree
 * and would drown any real signal. pnpm keeps most dependencies in per-package
 * directories, and a worktree only gets the junctioned root, so anything
 * reaching for a package-local dep (`zod`, here) cannot resolve it.
 *
 * These must be excluded PER INVOCATION: passing several positional filters to
 * one vitest run makes it ignore `--exclude`, which is how the first version of
 * the L1 scorer managed to report a clean tree as red. Suites are therefore run
 * one at a time.
 */
const EXCLUDE_SPECS = ['typert.spec.ts', 'gen-tool-catalog.spec.ts']

/**
 * Run one suite directory and report whether it is green.
 * @param dir - suite path relative to the worktree.
 * @returns true when vitest exits 0.
 */
function suiteGreen(dir) {
  // The spec files are listed one by one rather than filtered with
  // `--exclude`. That flag does not override a positional filter: the excluded
  // file runs anyway, and its load error shows up only in the "Test Files"
  // line, never in "Tests" — which is how an unloadable spec was mistaken for a
  // green baseline twice before the selftest caught it.
  const specs = readdirSync(join(WT, dir))
    .filter(file => file.endsWith('.spec.ts'))
    .filter(file => !EXCLUDE_SPECS.includes(file))
    .map(file => `${dir}/${file}`)
  if (specs.length === 0) return false
  return run('npx', ['vitest', 'run', '--config', 'vitest.config.ts', ...specs], { cwd: WT }).status === 0
}

function flag(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  })
}

/** Build the worktree, its node_modules junction, and the probe copy. */
function setup() {
  if (existsSync(WT)) {
    console.log(`worktree already present at ${WT}`)
  } else {
    console.log(`creating worktree at ${WT}`)
    execFileSync('git', ['worktree', 'add', '--detach', WT, 'HEAD'], { cwd: REPO, stdio: 'inherit' })
  }
  const modules = join(WT, 'node_modules')
  if (!existsSync(modules)) {
    // A junction avoids copying ~1GB and needs no elevation on Windows.
    const result = process.platform === 'win32'
      ? run('cmd', ['/c', 'mklink', '/J', modules, join(REPO, 'node_modules')])
      : run('ln', ['-s', join(REPO, 'node_modules'), modules])
    if (result.status !== 0) throw new Error(`failed to link node_modules: ${result.stderr ?? ''}`)
  }
  linkPackageModules()
  cpSync(join(REPO, 'personal/probe'), join(WT, 'personal/probe'), { recursive: true })
  console.log('worktree ready')
}


/**
 * Link every package-local `node_modules` into the worktree.
 *
 * pnpm puts most dependencies inside each package rather than at the root, so
 * a worktree with only a root link cannot resolve them. That is not just a
 * test-running problem: tsx maps `@deepseek-ai/*` through the tsconfig it
 * finds from the CWD, so running the launcher with the worktree as CWD loads
 * the harness FROM the worktree, and the whole plugin tree fails on the first
 * package-local import. Six sessions were burned on that before this existed.
 */
function linkPackageModules() {
  const roots = ['packages', 'apps', 'vendor']
  const found = []
  const walk = (relative, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(join(REPO, relative), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = `${relative}/${entry.name}`
      if (entry.name === 'node_modules') found.push(child)
      else walk(child, depth + 1)
    }
  }
  for (const root of roots) walk(root, 0)

  let linked = 0
  for (const relative of found) {
    const target = join(WT, relative)
    if (existsSync(target)) continue
    if (!existsSync(dirname(target))) continue
    const result = process.platform === 'win32'
      ? run('cmd', ['/c', 'mklink', '/J', target, join(REPO, relative)])
      : run('ln', ['-s', join(REPO, relative), target])
    if (result.status === 0) linked += 1
  }
  console.log(`linked ${String(linked)} package-local node_modules`)
}

/** Return the worktree to the committed state, keeping the two grafted trees. */
function reset() {
  execFileSync('git', ['checkout', '--', '.'], { cwd: WT })
  execFileSync('git', ['clean', '-fd', '-e', 'node_modules', '-e', 'personal'], { cwd: WT })
  rmSync(join(WT, 'personal/probe/tests'), { recursive: true, force: true })
  rmSync(join(WT, 'ANSWER.md'), { force: true })
}

/** Files the run changed, relative to the worktree. */
function changedFiles() {
  const tracked = run('git', ['diff', '--name-only'], { cwd: WT }).stdout ?? ''
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: WT }).stdout ?? ''
  return [...tracked.split('\n'), ...untracked.split('\n')].map(line => line.trim()).filter(Boolean)
}

const TASKS = [
  {
    id: 'l1',
    timeout: 1800,
    runs: 3,
    prompt: [
      '这个仓库里有三处互不相关的回归，分别在 packages/core/session、packages/core/system-prompt、packages/core/tools 三个包里。',
      '跑下面这条命令可以看到全部 15 个失败：',
      '  npx vitest run --config vitest.config.ts packages/core/session/tests packages/core/system-prompt/tests packages/core/tools/tests --exclude "**/typert.spec.ts"',
      '请逐个定位真正的根因并修好，让这三个套件全部变绿。',
      '硬性要求：不要修改任何测试文件；不要用跳过、注释掉、放宽断言或改期望值的方式让它变绿。只改被测代码。',
    ].join('\n'),
    seed() {
      // Three unrelated one-line semantic changes, each in a different package,
      // each breaking its own suite. Anchored by text rather than line number so
      // an upstream edit fails the seed loudly instead of corrupting a random line.
      const edits = [
        ['packages/core/session/src/chunk-rows.ts',
          'if (next.seq !== prev.seq + 1) return false',
          'if (next.seq !== prev.seq + 2) return false'],
        ['packages/core/system-prompt/src/index.ts',
          '[...sectionByName.values()].sort((a, b) => a.order - b.order)',
          '[...sectionByName.values()].sort((a, b) => b.order - a.order)'],
        ['packages/core/tools/src/py-types.ts',
          'test(capped) ? capped.slice(0, -1) : capped',
          'test(capped) ? capped : capped'],
      ]
      for (const [file, from, to] of edits) {
        const path = join(WT, file)
        const text = readFileSync(path, 'utf8')
        if (!text.includes(from)) throw new Error(`l1 seed anchor missing in ${file} — upstream moved`)
        writeFileSync(path, text.replace(from, to), 'utf8')
      }
    },
    score() {
      const suites = [
        'packages/core/session/tests',
        'packages/core/system-prompt/tests',
        'packages/core/tools/tests',
      ]
      const red = suites.filter(dir => !suiteGreen(dir))
      const green = red.length === 0
      const touchedTests = changedFiles().filter(path => path.includes('/tests/'))
      return {
        passed: green && touchedTests.length === 0,
        detail: green
          ? (touchedTests.length === 0 ? 'all three suites green, tests untouched' : `green but edited ${touchedTests.join(', ')}`)
          : `still red: ${red.map(dir => dir.split('/').at(-2)).join(', ')}`,
      }
    },
  },
  {
    id: 't1',
    timeout: 600,
    prompt: '当前仓库有测试没过。运行 `npx vitest run --config vitest.config.ts packages/core/session/tests --exclude "**/typert.spec.ts"` 可以看到失败。请定位真正的原因并修好它。不要修改任何测试文件。',
    seed() {
      const file = join(WT, 'packages/core/session/src/chunk-rows.ts')
      const text = readFileSync(file, 'utf8')
      const from = 'if (next.seq !== prev.seq + 1) return false'
      const to = 'if (next.seq !== prev.seq + 2) return false'
      if (!text.includes(from)) throw new Error('t1 seed anchor not found — the upstream file moved')
      writeFileSync(file, text.replace(from, to), 'utf8')
    },
    score() {
      const green = suiteGreen('packages/core/session/tests')
      const touchedTests = changedFiles().filter(path => path.includes('/tests/'))
      return {
        passed: green && touchedTests.length === 0,
        detail: green
          ? (touchedTests.length === 0 ? 'suite green, tests untouched' : `suite green but edited ${touchedTests.join(', ')}`)
          : 'suite still red',
      }
    },
  },
  {
    id: 't6',
    timeout: 900,
    prompt: '请给 `personal/probe/lib/` 下的 `classifier.ts`、`phases.ts`、`log.ts` 补一套单元测试，用 node 自带的 `node:test`，放在 `personal/probe/tests/` 下。要求 `node --import tsx/esm --test personal/probe/tests/` 全部通过，并且这三个模块导出的函数基本都要覆盖到。',
    seed() {},
    score() {
      const testDir = join(WT, 'personal/probe/tests')
      if (!existsSync(testDir)) return { passed: false, detail: 'no personal/probe/tests directory' }
      const result = run('node', ['--import', 'tsx/esm', '--test', 'personal/probe/tests/'], { cwd: WT })
      if (result.status !== 0) return { passed: false, detail: 'node --test failed' }
      // Count how many of the three modules' exported functions the tests name.
      const exported = new Set()
      for (const module of ['classifier.ts', 'phases.ts', 'log.ts']) {
        const source = readFileSync(join(WT, 'personal/probe/lib', module), 'utf8')
        // Anchored at line start: an unanchored match also counts the word
        // where it appears inside a doc comment, which inflated the ceiling
        // the threshold below is measured against.
        for (const match of source.matchAll(/^export function (\w+)/gm)) exported.add(match[1])
      }
      const body = readdirSync(testDir)
        .map(file => readFileSync(join(testDir, file), 'utf8'))
        .join('\n')
      const covered = [...exported].filter(name => body.includes(name))
      return {
        // The bar has to sit under the ceiling. The three modules export nine
        // functions between them; the pilot first ran with a bar of twelve, which
        // made the task unpassable by construction and marked two correct runs
        // as failures. Eight of nine is "covered nearly everything".
        passed: covered.length >= 8,
        detail: `suite green, ${String(covered.length)}/${String(exported.size)} exported functions named`,
      }
    },
  },
]

/** Drive one condition and return the session log it produced. */
function driveOnce(task, condition) {
  // No shell: the prompt carries backticks and quotes, and a shell would eat
  // them (or execute them) before the launcher ever sees the text.
  const result = spawnSync(process.execPath, [
    join(HERE, 'run-condition.mjs'),
    '--condition', condition,
    '--cwd', WT,
    '--timeout', String(task.timeout),
    '--task', task.prompt,
  ], { cwd: REPO, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const match = /session:\s+(.+\.jsonl(?:\.zstd)?)/.exec(output)
  const session = match?.[1]?.trim()
  if (session === undefined) console.log(output.split('\n').slice(-12).join('\n'))
  return { session, output }
}

/** Ask the phase contract whether an anchored run really ran anchored. */
function verifyAnchored(session) {
  if (session === undefined) return { valid: false, detail: 'no session produced' }
  const result = spawnSync(process.execPath, [
    '--import', 'tsx/esm', join(REPO, 'personal/probe/analyze-session.ts'), session, '--json',
  ], { cwd: REPO, encoding: 'utf8' })
  try {
    const report = JSON.parse(result.stdout ?? '{}')
    const failed = (report.checks ?? []).filter(check => check.status === 'fail')
    return {
      valid: failed.length === 0,
      detail: failed.length === 0 ? 'phase contract clean' : `contract failed: ${failed.map(c => c.id).join(', ')}`,
      steps: report.steps,
      blocks: report.reasoning?.blocks,
    }
  } catch {
    return { valid: false, detail: 'could not read the session report' }
  }
}


/**
 * Prove the scorer can tell right from wrong BEFORE spending sessions on it.
 *
 * The first pilot batch shipped a threshold set above the achievable ceiling,
 * which marked two correct runs as failures and cost a whole batch. A scorer
 * is a measuring instrument; an instrument nobody calibrated produces numbers
 * nobody should trust.
 *
 * Three checks per task: clean tree must PASS, seeded tree must FAIL, and a
 * seeded tree with the seed reverted must PASS again.
 */
function selftest(task) {
  console.log(`\n=== selftest ${task.id} ===`)
  const results = []

  reset()
  const clean = task.score()
  results.push(['clean tree scores PASS', clean.passed === true, clean.detail])

  reset()
  task.seed()
  const seeded = task.score()
  results.push(['seeded tree scores FAIL', seeded.passed === false, seeded.detail])

  execFileSync('git', ['checkout', '--', '.'], { cwd: WT })
  const reverted = task.score()
  results.push(['reverted tree scores PASS', reverted.passed === true, reverted.detail])

  let ok = true
  for (const [label, passed, detail] of results) {
    console.log(`  [${passed ? 'ok  ' : 'BAD '}] ${label} — ${detail}`)
    if (!passed) ok = false
  }
  return ok
}

if (process.argv.includes('--selftest')) {
  if (!existsSync(WT)) {
    console.error('worktree missing — run with --setup first')
    process.exit(1)
  }
  const only = flag('--only')
  let allOk = true
  for (const task of TASKS) {
    if (only !== undefined && task.id !== only) continue
    if (!selftest(task)) allOk = false
  }
  reset()
  console.log(allOk ? '\nscorers discriminate' : '\nSCORER BROKEN — do not spend sessions on it')
  process.exit(allOk ? 0 : 1)
}

if (process.argv.includes('--setup')) {
  setup()
  process.exit(0)
}
if (!existsSync(WT)) {
  console.error('worktree missing — run with --setup first')
  process.exit(1)
}

const only = flag('--only')
const rows = []
for (const task of TASKS) {
  if (only !== undefined && task.id !== only) continue
  // One cell per invocation is the reliable unit: a whole batch is long enough
  // that anything supervising the process may cut it off mid-run, and a cell
  // that dies halfway leaves no usable row.
  const conditions = flag('--condition') === undefined ? ['anchored', 'wide'] : [flag('--condition')]
  const attempts = Number(flag('--runs') ?? (task.runs ?? 1))
  for (const condition of conditions) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`\n=== ${task.id} / ${condition} / run ${String(attempt)} ===`)
    reset()
    task.seed()
    const { session } = driveOnce(task, condition)
    const score = task.score()
    // The contract describes the anchored arm only, so a wide run is never
    // marked invalid by it — but a run that produced no session at all is
    // invalid in either arm, and saying so beats reporting a silent FAIL.
    const measured = session === undefined ? undefined : verifyAnchored(session)
    const validity = condition === 'anchored'
      ? (measured ?? { valid: false, detail: 'no session produced' })
      : {
          valid: session !== undefined,
          detail: session === undefined ? 'no session produced' : 'contract n/a for this arm',
          steps: measured?.steps,
          blocks: measured?.blocks,
        }
    rows.push({
      task: task.id,
      condition,
      attempt,
      passed: score.passed,
      detail: score.detail,
      valid: validity.valid,
      validity: validity.detail,
      steps: validity.steps,
      blocks: validity.blocks,
      session: session?.split(/[\\/]/).at(-2) ?? '(none)',
    })
    console.log(`  score    ${score.passed ? 'PASS' : 'FAIL'}  ${score.detail}`)
    console.log(`  validity ${validity.valid ? 'ok' : 'INVALID'}  ${validity.detail}`)
    }
  }
}

console.log('\n')
console.log('task  condition  score  steps  validity')
for (const row of rows) {
  console.log(
    `${row.task.padEnd(5)} ${row.condition.padEnd(10)} ${(row.passed ? 'PASS' : 'FAIL').padEnd(6)} ${String(row.steps ?? '?').padStart(5)}  ${row.valid ? '' : 'INVALID — '}${row.validity}`,
  )
}
mkdirSync(join(REPO, 'personal/probe/results'), { recursive: true })
const out = join(REPO, 'personal/probe/results', `pilot-${new Date().toISOString().replaceAll(':', '-')}.json`)
writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
console.log(`\nsaved ${out}`)
