/**
 * Drive one headless task under one study condition, then report the session
 * it produced so the phase contract can verify the condition actually held.
 *
 * The outcome study needs both arms driven identically — same profile, same
 * task text, same everything except the first-request conditions. The
 * `headless` profile answers one task and exits, which makes that scriptable;
 * what it does NOT have is preset selection (its `--dump-config` shows a flat
 * composition with no `agentPresets` layer), so the anchored arm is applied as
 * a launcher `--patch` overlay built from `anchored.patch.template.yml`.
 *
 * The `wide` arm is the headless profile untouched: it already ships the full
 * catalog, `agent-instructions`, and `tool-skill` — the ordinary standard
 * first-request condition.
 *
 * Usage (repo root):
 *   node personal/probe/tasks/run-condition.mjs --condition anchored --task "..."
 *   node personal/probe/tasks/run-condition.mjs --condition wide --task "..."
 *
 * Flags:
 *   --condition anchored|wide   which arm to run (required)
 *   --task <text>               the task text (required)
 *   --cwd <path>                working directory for the run (default: repo root)
 *   --timeout <seconds>         abort the run after this long (default 900)
 *   --preset <id>               preset for the anchored arm (default anchored-standard)
 *   --keep-overlay              leave the generated overlay on disk for inspection
 *
 * Prints the final assistant message, then a `session:` line naming the
 * newest session log — feed that to `analyze-session.ts`.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

function flag(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const condition = flag('--condition')
const task = flag('--task')
if (condition !== 'anchored' && condition !== 'wide') {
  console.error('usage: run-condition.mjs --condition anchored|wide --task "<text>" [--cwd <path>]')
  process.exit(1)
}
if (task === undefined || task.length === 0) {
  console.error('--task is required')
  process.exit(1)
}

const cwd = flag('--cwd') ?? REPO
const timeoutSeconds = Number(flag('--timeout') ?? '900')

/** Newest session log under the harness home, with its mtime. */
function newestSession() {
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  let best
  let projects = []
  try {
    projects = readdirSync(root)
  } catch {
    return undefined
  }
  for (const project of projects) {
    let sessions = []
    try {
      sessions = readdirSync(join(root, project))
    } catch {
      continue
    }
    for (const session of sessions) {
      for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
        const path = join(root, project, session, name)
        try {
          const stats = statSync(path)
          if (best === undefined || stats.mtimeMs > best.mtime) best = { path, mtime: stats.mtimeMs }
        } catch {
          // absent variant
        }
      }
    }
  }
  return best
}

// Remember what existed before, so the run's own session can be identified
// rather than guessed at from a timestamp.
const before = newestSession()

// The launcher is invoked directly rather than through `pnpm dsh`. A shell
// in the middle would perform command substitution on backticks inside the
// task text, which every realistic task contains.
const args = ['--import', 'tsx/esm', join(REPO, 'apps/cli/src/bin.ts'), '--profile', 'headless']
let overlayPath
if (condition === 'anchored') {
  const template = readFileSync(join(HERE, 'anchored.patch.template.yml'), 'utf8')
  // The loader imports a plugin name as an ES module specifier. A bare
  // absolute win32 path is parsed as a URL with scheme "d:" and rejected
  // (ERR_UNSUPPORTED_ESM_URL_SCHEME), so the substitution emits a file URL.
  const overlay = template
    .replaceAll('%REPO%', pathToFileURL(REPO).href)
    .replaceAll('%REPO_PATH%', REPO.split(sep).join('/'))
    .replaceAll('%PRESET%', flag('--preset') ?? 'anchored-standard')
  overlayPath = join(mkdtempSync(join(tmpdir(), 'dsh-probe-')), 'anchored.patch.yml')
  writeFileSync(overlayPath, overlay, 'utf8')
  args.push('--patch', overlayPath)
}
args.push(task)

console.error(`condition ${condition}`)
console.error(`cwd       ${cwd}`)
if (overlayPath !== undefined) console.error(`overlay   ${overlayPath}`)
console.error('')

const child = spawn(process.execPath, args, {
  cwd,
  stdio: ['ignore', 'inherit', 'inherit'],
})

const timer = setTimeout(() => {
  console.error(`\nTIMEOUT after ${String(timeoutSeconds)}s — killing the run`)
  child.kill('SIGKILL')
}, timeoutSeconds * 1000)

child.on('exit', (code) => {
  clearTimeout(timer)
  const after = newestSession()
  console.error('')
  console.error(`exit      ${String(code)}`)
  if (after !== undefined && (before === undefined || after.path !== before.path || after.mtime > before.mtime)) {
    console.error(`session:  ${after.path}`)
    console.error(`verify:   node --import tsx/esm personal/probe/analyze-session.ts "${after.path}"`)
  } else {
    console.error('session:  (none produced — the run failed before the log was written)')
  }
  if (overlayPath !== undefined && !process.argv.includes('--keep-overlay')) {
    try {
      rmSync(dirname(overlayPath), { recursive: true, force: true })
    } catch {
      // leaving a temp dir behind is not worth failing the run over
    }
  }
  process.exit(code ?? 1)
})
