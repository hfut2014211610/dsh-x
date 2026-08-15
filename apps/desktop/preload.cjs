// Loading-screen bridge: the sandboxed, context-isolated renderer gets exactly
// two capabilities — observing shell snapshots and requesting a retry. No node
// integration, no arbitrary IPC: contextBridge freezes this surface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktopShell', {
  onState: (listener) => {
    const handler = (_event, state) => { listener(state) }
    ipcRenderer.on('dsh-desktop-shell:state', handler)
    return () => { ipcRenderer.removeListener('dsh-desktop-shell:state', handler) }
  },
  retry: () => { ipcRenderer.send('dsh-desktop-shell:retry') },
})
