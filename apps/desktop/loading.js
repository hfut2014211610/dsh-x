// Loading-screen rendering: a pure function of the latest shell snapshot.
// Runs sandboxed with no node integration; the preload bridge is the only IPC surface.
(function () {
  const stages = {
    discovering: 'Discovering the dsh runtime…',
    launching: 'Starting the dsh web runtime…',
    connecting: 'Connecting…',
    ready: 'Connected. Loading the app…',
    failed: 'Could not reach a dsh runtime.',
  }
  const bridge = window.dshDesktopShell
  if (bridge === undefined) return

  const stage = document.getElementById('stage')
  const detail = document.getElementById('detail')
  const runtime = document.getElementById('runtime')
  const logs = document.getElementById('logs')

  bridge.onState((state) => {
    document.body.className = state.phase
    stage.textContent = stages[state.phase] ?? state.phase
    detail.textContent = state.detail ?? ''
    runtime.textContent = ''
    if (state.runtime !== undefined) {
      runtime.appendChild(document.createTextNode('runtime: '))
      const code = document.createElement('code')
      code.textContent = `${state.runtime.source} · dsh ${state.runtime.version}`
      runtime.appendChild(code)
    }
    logs.textContent = state.logs.join('\n')
    logs.scrollTop = logs.scrollHeight
  })

  document.getElementById('retry').addEventListener('click', () => { bridge.retry() })
})()
