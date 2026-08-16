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
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { ensureBundledRuntime } from './bundled-runtime.ts'
import { DEFAULT_PROBE_ORIGIN, discoverRuntime } from './discovery.ts'
import { spawnRuntimeProcess } from './process-tree.ts'
import { startSidecar, type SidecarHandle } from './sidecar.ts'
import { createShellState, type ShellSnapshot } from './shell-state.ts'

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

/** Readiness deadlines: URL line, then HTTP 200 plus the handshake. */
const URL_TIMEOUT_MS = 120_000
const READY_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 250

/** One automatic restart after an unexpected runtime exit; then the user retries. */
let restartsUsed = 0
let connectToken = 0
let quitting = false
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let sidecar: SidecarHandle | undefined
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

async function connect(): Promise<void> {
  const token = connectToken + 1
  connectToken = token
  sidecar?.kill()
  sidecar = undefined

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
        exists: async path => existsSync(path),
        readFile: path => readFile(path),
        removeDir: async (path) => { await rm(path, { recursive: true, force: true }) },
        makeDir: async (path) => { await mkdir(path, { recursive: true }) },
        writeFile: async (path, contents) => { await writeFile(path, contents, 'utf8') },
        extract: async (archive, dir) => {
          const run = (command: string, args: readonly string[]): void => {
            const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600_000 })
            if (result.status !== 0) {
              throw new Error(`${command} exited ${String(result.status)}: ${String(result.stderr).slice(0, 300)}`)
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
    probeOrigin: process.env.DSH_DESKTOP_PROBE_ORIGIN ?? DEFAULT_PROBE_ORIGIN,
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
    if (current === sidecar) void onRuntimeExit(code)
  })
  state.ready(handle.url)
  log(`connected: ${handle.url}`)
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

async function onRuntimeExit(code: number | null): Promise<void> {
  if (quitting) return
  log(`runtime exited unexpectedly (code ${String(code)})`)
  if (restartsUsed < 1) {
    restartsUsed += 1
    log('restarting the runtime once')
    await connect()
    return
  }
  state.phase('failed', `The dsh runtime exited (code ${String(code)}). Retry to reconnect.`)
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
    { type: 'separator' },
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
  sidecar?.kill()
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
  restartsUsed = 0
  void connect()
})

app.on('second-instance', () => { showWindow() })
app.on('activate', () => { showWindow() })

app.on('before-quit', () => {
  quitting = true
  sidecar?.kill()
})

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  createWindow()
  createTray()
  void connect()
}).catch((error: unknown) => {
  console.error('[dsh-desktop-shell] boot failed:', error)
  app.exit(1)
})
