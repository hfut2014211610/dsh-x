/**
 * The desktop shell main process (Stage A sidecar shape): one Electron window
 * over the official `dsh --profile web` runtime. The shell discovers a runtime
 * (serving instance, PATH, npx cache, or the bundled installer runtime),
 * spawns it on loopback with an OS-assigned port, completes the readiness
 * handshake, and only then loads the web UI. All agent behavior stays in the
 * existing plugin tree; the shell owns window, tray, and process lifecycle.
 * @module @deepseek-ai/dsh-desktop-shell/main
 */

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { ensureBundledRuntime } from './bundled-runtime.ts'
import { DEFAULT_PROBE_ORIGIN, discoverRuntime } from './discovery.ts'
import { DEFAULT_HEALTH_OPTIONS, startHealthWatch } from './health.ts'
import { reapOwnedRuntime, type OwnedRuntimeRecord } from './owned-runtime.ts'
import { killProcessTree, spawnRuntimeProcess } from './process-tree.ts'
import { createRestartPolicy } from './restart-policy.ts'
import { describeOrigin } from './rpc-probe.ts'
import { startSidecar, type SidecarHandle } from './sidecar.ts'
import { createShellState, type ShellSnapshot } from './shell-state.ts'
import { checkForUpdate, downloadUpdate, type UpdaterDeps, type UpdateFeed } from './updater.ts'

/** Directory holding this compiled entry (package `lib/`); assets sit beside it. */
const HERE = dirname(fileURLToPath(import.meta.url))

/** Loading screen + preload shipped at the package root. */
const LOADING_PAGE = join(HERE, '..', 'loading.html')
const PRELOAD_SCRIPT = join(HERE, '..', 'preload.cjs')
const TRAY_ICON = join(HERE, '..', 'assets', 'tray.png')

/** IPC channel carrying shell snapshots to the loading screen. */
const STATE_CHANNEL = 'dsh-desktop-shell:state'
/** IPC channel carrying retry requests from the loading screen. */
const RETRY_CHANNEL = 'dsh-desktop-shell:retry'

/**
 * Where in-app updates come from. This fork publishes its own installers, and
 * the electron-builder default would infer the UPSTREAM repository from the
 * package manifest, pointing every update check at releases that never carry
 * this fork's builds.
 */
const UPDATE_REPOSITORY = 'hfut2014211610/dsh-x'
/** How long after a connection the unattended update check waits. */
const UPDATE_CHECK_DELAY_MS = 20_000

/** Readiness deadlines: URL line, then HTTP 200 plus the handshake. */
const URL_TIMEOUT_MS = 120_000
const READY_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 250

/** Answers every runtime fault: restart with backoff, or stop and show why. */
const restartPolicy = createRestartPolicy()
let connectToken = 0
let quitting = false
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let sidecar: SidecarHandle | undefined
/** Stops the liveness watch over the connected runtime; replaced per connect. */
let stopHealthWatch: (() => void) | undefined
/** Pending restart timer, so a quit or a manual retry can cancel the wait. */
let restartTimer: NodeJS.Timeout | undefined
/** Guards against two update checks overlapping (launch timer plus tray click). */
let updateInFlight = false
/** A verified installer waiting for the quit that will run it. */
let pendingInstaller: string | undefined
/** Origin the connected runtime serves; every other navigation leaves the app. */
let servedOrigin: string | undefined
/** The loading screen's own file URL, the one file navigation the window allows. */
let loadingPageUrl: string | undefined

const state = createShellState(pushState)

// Electron's internal navigation bookkeeping leaks its own rejected promise
// when the web app supersedes our loadURL during boot (ERR_ABORTED); the
// shell's awaited loadURL is handled separately below. Record what this
// process did not await quietly instead of letting Node print a warning for
// a promise this shell never held.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message.includes('ERR_ABORTED')) return
  console.error('[dsh-desktop-shell] unhandled rejection:', reason)
})

function pushState(snapshot: ShellSnapshot): void {
  const contents = mainWindow?.webContents
  if (contents !== undefined && !contents.isDestroyed()) contents.send(STATE_CHANNEL, snapshot)
}

function log(line: string): void {
  console.log(`[dsh-desktop-shell] ${line}`)
  state.log(line)
}

/** Where this launch notes the runtime it owns, for the next launch to reap. */
function ownedRuntimePath(): string {
  return join(app.getPath('userData'), 'owned-runtime.json')
}

/** Note the runtime this launch owns; a failure to write only costs a reap. */
async function recordOwnedRuntime(record: OwnedRuntimeRecord): Promise<void> {
  try {
    await writeFile(ownedRuntimePath(), JSON.stringify(record), 'utf8')
  } catch (error) {
    log(`could not record the owned runtime: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Drop the note; an absent file is the expected case, not a failure. */
async function clearOwnedRuntime(): Promise<void> {
  await rm(ownedRuntimePath(), { force: true }).catch(() => {})
}

/**
 * Stop the runtime a previous launch owned but never got to kill — the shell
 * itself was killed, so its quit path never ran. Runs before discovery so the
 * orphan cannot still be holding the resources the new runtime wants.
 */
async function reapPreviousRuntime(): Promise<void> {
  const line = await reapOwnedRuntime({
    readRecord: async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(ownedRuntimePath(), 'utf8'))
        if (typeof parsed !== 'object' || parsed === null) return undefined
        const { pid, origin } = parsed as Record<string, unknown>
        if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined
        if (typeof origin !== 'string' || origin === '') return undefined
        return { pid, origin }
      } catch {
        return undefined
      }
    },
    clearRecord: clearOwnedRuntime,
    describes: async origin => await describeOrigin(origin, fetch, () => crypto.randomUUID(), 2_000) !== undefined,
    alive: (pid) => {
      try {
        // Signal 0 delivers nothing and throws ESRCH for a pid nobody owns.
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    killTree: (pid) => {
      killProcessTree(pid, {
        platform: process.platform,
        taskkill: (args) => { spawnSync('taskkill', args) },
        signalProcess: (target, signal) => { process.kill(target, signal) },
      })
    },
  })
  if (line !== undefined) log(line)
}

async function connect(): Promise<void> {
  const token = connectToken + 1
  connectToken = token
  if (restartTimer !== undefined) {
    clearTimeout(restartTimer)
    restartTimer = undefined
  }
  stopHealthWatch?.()
  stopHealthWatch = undefined
  sidecar?.kill()
  sidecar = undefined
  await clearOwnedRuntime()

  // Materialize the bundled runtime before discovery can select it. A
  // shipping failure degrades loudly (trail + failed screen) rather than
  // silently falling through to sources a clean machine does not have.
  let bundledRoot = ''
  if (app.isPackaged) {
    state.phase('preparing')
    log('preparing the bundled runtime')
    try {
      const runtime = await ensureBundledRuntime({
        archivePath: join(process.resourcesPath, 'dsh-runtime.zip'),
        targetDir: join(app.getPath('userData'), 'dsh-runtime'),
        exists: path => Promise.resolve(existsSync(path)),
        readFile: path => readFile(path),
        removeDir: async (path) => { await rm(path, { recursive: true, force: true }) },
        makeDir: async (path) => { await mkdir(path, { recursive: true }) },
        writeFile: async (path, contents) => { await writeFile(path, contents, 'utf8') },
        extract: (archive, dir) => {
          const run = (command: string, args: readonly string[]): void => {
            // A cold Windows machine extracts the bundled runtime's tens of
            // thousands of small files under real-time antivirus scanning;
            // the bound covers that first run without keeping a stuck tar
            // alive indefinitely.
            const result = spawnSync(command, args, { encoding: 'utf8', timeout: 900_000 })
            if (result.status !== 0) {
              throw new Error(`${command} exited ${String(result.status)}: ${result.stderr.slice(0, 300)}`)
            }
          }
          // bsdtar reads zip archives. On Windows, resolve the SYSTEM bsdtar by
          // absolute path: a PATH `tar` may be GNU tar (MSYS), which neither
          // reads zip nor accepts a `D:` drive letter.
          const tarCommand = process.platform === 'win32'
            ? join(process.env.SystemRoot ?? 'C:\\Windows', 'system32', 'tar.exe')
            : 'tar'
          try {
            run(tarCommand, ['-xf', archive, '-C', dir])
          } catch (tarError) {
            log(`tar extraction unavailable (${tarError instanceof Error ? tarError.message : String(tarError)}); trying unzip`)
            run('unzip', ['-q', archive, '-d', dir])
          }
          return Promise.resolve()
        },
      })
      if (runtime !== undefined) {
        bundledRoot = runtime.root
        log(`bundled runtime ready (dsh ${runtime.version})`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      log(`bundled runtime preparation failed: ${detail}`)
      state.phase('failed', `The bundled runtime could not be prepared: ${detail}`)
      return
    }
  }

  state.phase('discovering')
  log('discovering a dsh runtime')
  const outcome = await discoverRuntime({
    fetchImpl: fetch,
    execFile: (command, args) => {
      const result = spawnSync(command, args, {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 10_000,
      })
      return Promise.resolve({ stdout: result.stdout, code: result.status ?? -1 })
    },
    readJson: async (path) => {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as unknown
      } catch {
        return undefined
      }
    },
    listDirs: async (path) => {
      try {
        return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
      } catch {
        return []
      }
    },
    npxCacheDirs: [
      join(homedir(), '.npm', '_npx'),
      process.env.LOCALAPPDATA === undefined ? '' : join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'),
    ].filter(dir => dir !== ''),
    bundledRoot,
    // `--expose-internals` precedes the entry script: the web profile's HMR
    // row requires it, and the CLI's own respawn does not reach an
    // electron-as-node child. PATH `dsh` manages its own flags.
    runtimeLauncher: { command: process.execPath, args: ['--expose-internals'], env: { ELECTRON_RUN_AS_NODE: '1' } },
    // An installed app never attaches: a runtime it did not spawn is one it
    // must not stop, and quitting would leave a server running behind the
    // user's back. An explicit override still wins in both directions — it is
    // how the packaged smoke forces the spawn path and how a developer points
    // the shell at a specific instance.
    probeOrigin: process.env.DSH_DESKTOP_PROBE_ORIGIN ?? (app.isPackaged ? '' : DEFAULT_PROBE_ORIGIN),
    randomUuid: () => crypto.randomUUID(),
  })
  for (const line of outcome.trail) log(line)
  if (outcome.candidate === undefined) {
    state.phase('failed', 'No validated dsh runtime found. Install dsh (npm i -g @deepseek-ai/dsh) or retry.')
    return
  }
  if (token !== connectToken) return
  state.runtime({ source: outcome.candidate.source, version: outcome.candidate.version })

  state.phase('launching', outcome.candidate.source === 'serving-instance' ? 'attaching' : 'starting dsh web')
  let handle: SidecarHandle
  try {
    handle = await startSidecar(outcome.candidate, {
      spawn: spawnRuntimeProcess,
      fetchImpl: fetch,
      randomUuid: () => crypto.randomUUID(),
      sleep: ms => new Promise((resolve) => { setTimeout(resolve, ms) }),
      now: () => Date.now(),
    }, { urlTimeoutMs: URL_TIMEOUT_MS, readyTimeoutMs: READY_TIMEOUT_MS, pollIntervalMs: POLL_INTERVAL_MS })
  } catch (error) {
    if (token !== connectToken) return
    const detail = error instanceof Error ? error.message : String(error)
    log(`connection failed: ${detail}`)
    if (error instanceof Error && 'outputTail' in error) {
      for (const line of (error as { outputTail: readonly string[] }).outputTail) log(line)
    }
    state.phase('failed', detail)
    return
  }
  if (token !== connectToken) {
    handle.kill()
    return
  }
  sidecar = handle
  servedOrigin = new URL(handle.url).origin
  // Only the live sidecar's exit restarts anything: a handle retired by retry
  // or reconnection dies on purpose.
  const current = handle
  handle.onExit((code) => {
    if (current === sidecar) void onRuntimeFault(`the runtime exited (code ${String(code)})`)
  })
  if (handle.owned && handle.pid !== undefined) {
    await recordOwnedRuntime({ pid: handle.pid, origin: servedOrigin })
  }
  // A runtime can stop answering without exiting, and only a probe sees that.
  // Attached instances are excluded: this shell neither owns nor restarts one.
  if (handle.owned) {
    const origin = servedOrigin
    stopHealthWatch = startHealthWatch(
      {
        probe: async () => await describeOrigin(origin, fetch, () => crypto.randomUUID(), 2_000) !== undefined,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (timer) => { clearTimeout(timer as NodeJS.Timeout) },
      },
      DEFAULT_HEALTH_OPTIONS,
      (reason) => {
        if (current === sidecar) void onRuntimeFault(reason)
      },
    )
  }
  state.ready(handle.url)
  log(`connected: ${handle.url}`)
  // After the window is useful, never before it: a check that runs during boot
  // competes with the runtime for the same cold network and delays the thing
  // the user actually opened the app for.
  setTimeout(() => { void checkUpdates(false) }, UPDATE_CHECK_DELAY_MS).unref()
  const window = mainWindow
  if (window !== undefined && !window.isDestroyed()) {
    try {
      await window.loadURL(handle.url)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      // ERR_ABORTED means the page superseded our navigation (the web app
      // redirects while booting); anything else is a real load failure.
      if (!detail.includes('ERR_ABORTED')) {
        log(`window load failed: ${detail}`)
        state.phase('failed', detail)
      } else {
        log('window navigation superseded during boot (ERR_ABORTED)')
      }
    }
  }
}

/**
 * Answer one runtime fault — an exit, or a runtime that stopped answering.
 *
 * Both faults get the same treatment because they mean the same thing to the
 * user: the app stopped working. The policy decides whether this one is worth
 * another attempt and how long to wait, and a fault that spends the budget
 * stops on the failed screen with its reason, where the retry button resets
 * the policy and starts the budget over.
 * @param detail - what went wrong, in the user's terms.
 */
async function onRuntimeFault(detail: string): Promise<void> {
  if (quitting) return
  stopHealthWatch?.()
  stopHealthWatch = undefined
  log(detail)
  const decision = restartPolicy.onFault(Date.now())
  if (!decision.restart) {
    // The dead runtime is no longer ours to reap on the next launch, and the
    // shell is still running, so nothing else will clear the note.
    await clearOwnedRuntime()
    state.phase('failed', `${detail}. ${decision.reason}. Retry to reconnect.`)
    return
  }
  log(decision.reason)
  if (decision.delayMs === 0) {
    await connect()
    return
  }
  state.phase('launching', `retrying in ${String(Math.round(decision.delayMs / 1000))}s`)
  restartTimer = setTimeout(() => {
    restartTimer = undefined
    void connect()
  }, decision.delayMs)
}

/** Repository, running version, and platform for one update check. */
function updateFeed(): UpdateFeed {
  return { repository: UPDATE_REPOSITORY, currentVersion: app.getVersion(), platform: process.platform }
}

/** Real collaborators for the updater: HTTP, a streamed download, and a hash. */
function updaterDeps(): UpdaterDeps {
  return {
    fetchImpl: fetch,
    downloadDir: app.getPath('userData'),
    download: async (url, targetPath, onProgress) => {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok || response.body === null) {
        throw new Error(`downloading the update answered ${String(response.status)}`)
      }
      const total = Number(response.headers.get('content-length') ?? 0)
      let received = 0
      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      body.on('data', (chunk: Buffer) => {
        received += chunk.length
        onProgress(received, total)
      })
      await pipeline(body, createWriteStream(targetPath))
      return received
    },
    sha512: async (path) => {
      const hash = createHash('sha512')
      await pipeline(createReadStream(path), hash)
      // electron-builder records the digest base64-encoded, not as hex.
      return hash.digest('base64')
    },
  }
}

/**
 * Check for a newer build and, with the user's consent, fetch and stage it.
 *
 * Runs unattended shortly after a connection and on demand from the tray. An
 * unattended check that finds nothing says nothing: the only outcomes that
 * interrupt anyone are an available update and, when the user asked, the
 * answer to what they asked.
 * @param announce - whether to report "no update" and failures in a dialog.
 */
async function checkUpdates(announce: boolean): Promise<void> {
  if (updateInFlight) return
  if (!app.isPackaged) {
    if (announce) {
      await dialog.showMessageBox({
        type: 'info',
        message: 'Updates apply to installed builds',
        detail: 'This window is running from a source checkout, which updates through git rather than through the installer.',
      })
    }
    return
  }
  updateInFlight = true
  try {
    const feed = updateFeed()
    const deps = updaterDeps()
    const found = await checkForUpdate(feed, deps)
    log(`update check: ${found.detail}`)
    if (found.status !== 'available') {
      if (announce) {
        await dialog.showMessageBox({
          type: found.status === 'current' ? 'info' : 'warning',
          message: found.status === 'current' ? 'DeepSeek Harness is up to date' : 'Could not check for updates',
          detail: found.detail,
        })
      }
      return
    }
    const offer = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `DeepSeek Harness ${found.version} is available`,
      detail: `You are running ${feed.currentVersion}. The update downloads in the background and installs when you quit.`,
    })
    if (offer.response !== 0) return
    log(`downloading update ${found.version}`)
    let lastReported = 0
    const staged = await downloadUpdate(found, feed, deps, (received, total) => {
      // One line per decile: the download is tens of megabytes and the log is
      // a bounded ring the loading screen renders.
      const percent = total === 0 ? 0 : Math.floor((received / total) * 10) * 10
      if (percent > lastReported) {
        lastReported = percent
        log(`update download: ${String(percent)}%`)
      }
    })
    log(staged.detail)
    pendingInstaller = staged.path
    const install = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart and install', 'Install on quit'],
      defaultId: 0,
      cancelId: 1,
      message: `DeepSeek Harness ${staged.version} is ready to install`,
      detail: 'The installer replaces this app in place and reopens it.',
    })
    if (install.response === 0) quit()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    log(`update failed: ${detail}`)
    pendingInstaller = undefined
    if (announce) {
      await dialog.showMessageBox({ type: 'error', message: 'The update could not be installed', detail })
    }
  } finally {
    updateInFlight = false
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Harness',
    icon: nativeImage.createFromPath(join(HERE, '..', 'build', 'icon.png')),
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  mainWindow = window
  window.once('ready-to-show', () => { window.show() })
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  void window.loadFile(LOADING_PAGE).then(() => {
    loadingPageUrl = window.webContents.getURL()
    pushState(state.snapshot())
  })
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON))
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { showWindow() } },
    { label: 'Check for updates…', click: () => { void checkUpdates(true) } },
    { type: 'separator' },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => { quit() } },
  ]))
  tray.on('click', () => { showWindow() })
}

function showWindow(): void {
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  window.show()
  window.focus()
}

function quit(): void {
  quitting = true
  if (restartTimer !== undefined) {
    clearTimeout(restartTimer)
    restartTimer = undefined
  }
  stopHealthWatch?.()
  stopHealthWatch = undefined
  sidecar?.kill()
  // Synchronous on purpose: `before-quit` gives no chance to await, and a note
  // left behind would make the next launch hunt a pid this quit already killed.
  try {
    rmSync(ownedRuntimePath(), { force: true })
  } catch {
    // A note we cannot delete costs one harmless reap attempt next launch.
  }
  // Last, and only once the runtime is down: the installer replaces files this
  // process is running from, so it must not start while the app still holds
  // them. `openPath` hands it to the shell and returns; the quit below is what
  // releases the app for it to replace.
  if (pendingInstaller !== undefined) {
    const installer = pendingInstaller
    pendingInstaller = undefined
    log(`launching the installer: ${installer}`)
    void shell.openPath(installer)
  }
  app.quit()
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const allowed = (loadingPageUrl !== undefined && url === loadingPageUrl)
      || (servedOrigin !== undefined && url.startsWith(servedOrigin))
    if (allowed) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
})

ipcMain.on(RETRY_CHANNEL, () => {
  // A person asking for a retry is new information the rolling window does not
  // have: they may have freed the port or fixed the install the loop was
  // failing on, so the budget starts over rather than staying spent.
  restartPolicy.reset()
  void connect()
})

app.on('second-instance', () => { showWindow() })
app.on('activate', () => { showWindow() })

app.on('before-quit', () => { quit() })

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  createWindow()
  createTray()
  void reapPreviousRuntime().then(connect)
}).catch((error: unknown) => {
  console.error('[dsh-desktop-shell] boot failed:', error)
  app.exit(1)
})
