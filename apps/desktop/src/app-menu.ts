/**
 * The window's own menu bar.
 *
 * Until now the shell set none, which does not mean there was none — Electron
 * installs a default menu built for developing Electron, so a shipped build
 * offered Reload, Force Reload and Toggle Developer Tools, and offered nothing
 * about the product itself. The one thing a person actually looks for up there
 * — what version am I on, is there a newer one — lived only in the tray, which
 * is not where anyone looks while they are inside the window.
 *
 * The template is data, built apart from the Electron call that installs it, so
 * what the menu offers can be asserted without a running app.
 * @module @deepseek-ai/dsh-desktop-shell/app-menu
 */

/** One item in the built template; the shape Electron's Menu.buildFromTemplate takes. */
export interface MenuItemTemplate {
  label?: string
  role?: string
  type?: 'separator'
  accelerator?: string
  click?: () => void
  submenu?: MenuItemTemplate[]
}

/** What the menu needs to be able to do. */
export interface AppMenuActions {
  about: () => void
  checkUpdates: () => void
  quit: () => void
}

/**
 * Build the application menu template.
 *
 * Deliberately short. Everything the default menu carried that this app has no
 * use for is gone — reloading the window drops the connection to the runtime
 * behind it, and a developer tools item in a shipped build is an invitation to
 * a support conversation nobody wants. Copy, paste and select-all stay: a
 * window with a text editor in it needs the keyboard accelerators those roles
 * carry, and on macOS the Edit menu is where the system expects them.
 * @param actions - what the product items do.
 * @param platform - the host platform; macOS keeps About under the app menu.
 * @returns the template, ready for Menu.buildFromTemplate.
 */
export function appMenuTemplate(
  actions: AppMenuActions,
  platform: NodeJS.Platform = process.platform,
): MenuItemTemplate[] {
  const about: MenuItemTemplate = { label: 'About DeepSeek Harness', click: actions.about }
  const updates: MenuItemTemplate = { label: 'Check for Updates…', click: actions.checkUpdates }
  const edit: MenuItemTemplate = {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  }
  const window: MenuItemTemplate = {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
  }
  if (platform === 'darwin') {
    // macOS puts About and Quit in the application menu and nowhere else;
    // duplicating them under Help would be two of each.
    return [
      {
        label: 'DeepSeek Harness',
        submenu: [about, updates, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { label: 'Quit', accelerator: 'Command+Q', click: actions.quit }],
      },
      edit,
      window,
    ]
  }
  return [
    {
      label: 'File',
      submenu: [{ label: 'Quit', accelerator: 'Ctrl+Q', click: actions.quit }],
    },
    edit,
    window,
    { label: 'Help', submenu: [updates, { type: 'separator' }, about] },
  ]
}
