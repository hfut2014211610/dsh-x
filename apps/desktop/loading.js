// Loading-screen rendering: a pure function of the latest shell snapshot, plus
// one local clock. Runs sandboxed with no node integration; the preload bridge
// is the only IPC surface.
(function () {
  // Phrased as what the app is doing for the user, not as what the shell is
  // doing internally: nobody opening this app knows what a runtime is.
  const stages = {
    preparing: 'Unpacking DeepSeek Harness',
    discovering: 'Looking for the agent runtime',
    launching: 'Starting the agent runtime',
    connecting: 'Connecting',
    ready: 'Ready',
    failed: 'DeepSeek Harness could not start',
  }
  // Only the first run unpacks anything, and it is the one wait long enough to
  // be mistaken for a hang, so it says why it is taking a while.
  const hints = {
    preparing: 'First run: this happens once.',
  }
  const ORDER = ['preparing', 'discovering', 'launching', 'connecting', 'ready']

  const bridge = window.dshDesktopShell
  if (bridge === undefined) return

  const stage = document.getElementById('stage')
  const detail = document.getElementById('detail')
  const elapsed = document.getElementById('elapsed')
  const runtime = document.getElementById('runtime')
  const logs = document.getElementById('logs')
  const toggle = document.getElementById('toggle')
  const steps = [...document.querySelectorAll('.step')]

  let current = null

  /** Whole seconds only past the first few: a jittering counter reads worse. */
  function since (startedAt) {
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    if (seconds < 3) return ''
    if (seconds < 60) return ` · ${seconds}s`
    return ` · ${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }

  function paint () {
    if (current === null) return
    const phase = current.phase
    const failed = phase === 'failed'
    document.body.classList.toggle('failed', failed)
    document.body.classList.toggle('ready', phase === 'ready')
    stage.textContent = stages[phase] ?? phase
    detail.textContent = current.detail || hints[phase] || ''
    // A failed screen shows how long the attempt ran, not a clock still going.
    elapsed.textContent = failed ? '' : since(current.since)

    // Everything before the current phase is done; the current one sweeps.
    const at = ORDER.indexOf(phase)
    steps.forEach((element, index) => {
      const reached = at < 0 ? index === 0 : index < at
      element.classList.toggle('done', reached || phase === 'ready')
      element.classList.toggle('active', at < 0 ? index === 0 : index === at && phase !== 'ready')
    })

    runtime.textContent = ''
    if (current.runtime !== undefined) {
      const code = document.createElement('code')
      code.textContent = `dsh ${current.runtime.version} · ${current.runtime.source}`
      runtime.appendChild(code)
    }

    logs.textContent = current.logs.join('\n')
    logs.scrollTop = logs.scrollHeight
  }

  bridge.onState((state) => {
    const wasFailed = current !== null && current.phase === 'failed'
    current = state
    // A failure is the one time the log wall is the point, so it opens itself
    // — once, so a reader who closes it again is not overruled on every
    // subsequent snapshot.
    if (state.phase === 'failed' && !wasFailed) setLogs(true)
    paint()
  })

  function setLogs (open) {
    document.body.classList.toggle('logs-open', open)
    toggle.textContent = open ? 'Hide details' : 'Show details'
  }

  toggle.addEventListener('click', () => {
    setLogs(!document.body.classList.contains('logs-open'))
  })
  document.getElementById('retry').addEventListener('click', () => { bridge.retry() })

  // The phase clock has to advance between snapshots: the long waits are
  // exactly the ones that send no updates.
  setInterval(paint, 1000)
})()
