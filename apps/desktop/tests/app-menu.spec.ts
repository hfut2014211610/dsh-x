// The window menu. The shell set none, which is not the same as having none —
// Electron installs a default built for developing Electron, so a shipped
// build offered Toggle Developer Tools and said nothing about the product.
import { describe, expect, it, vi } from 'vitest'
import { appMenuTemplate, type MenuItemTemplate } from '../src/app-menu.ts'

function actions() {
  return { about: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn() }
}

/** Every label and role in the tree, so a test can ask what the menu offers. */
function flatten(template: readonly MenuItemTemplate[]): string[] {
  return template.flatMap(item => [
    ...item.label === undefined ? [] : [item.label],
    ...item.role === undefined ? [] : [item.role],
    ...item.submenu === undefined ? [] : flatten(item.submenu),
  ])
}

describe('appMenuTemplate', () => {
  it('offers the two product questions a menu bar is opened for', () => {
    const handlers = actions()
    const labels = flatten(appMenuTemplate(handlers, 'win32'))

    expect(labels).toContain('About DeepSeek Harness')
    expect(labels).toContain('Check for Updates…')
  })

  // Reloading drops the connection to the runtime behind the window, and a
  // developer tools item in a shipped build is a support conversation waiting
  // to happen.
  it('carries nothing from the default developer menu', () => {
    const labels = flatten(appMenuTemplate(actions(), 'win32'))

    for (const unwanted of ['reload', 'forceReload', 'toggleDevTools', 'togglefullscreen']) {
      expect(labels).not.toContain(unwanted)
    }
  })

  // A window with a text editor in it needs the accelerators these roles
  // carry; dropping them to keep the menu short would break Ctrl+C.
  it('keeps the editing roles', () => {
    const labels = flatten(appMenuTemplate(actions(), 'win32'))

    expect(labels).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']))
  })

  // macOS puts About and Quit in the application menu and nowhere else;
  // a Help menu carrying them too would be two of each.
  it('puts About in the application menu on macOS, and not also under Help', () => {
    const template = appMenuTemplate(actions(), 'darwin')

    expect(template[0]?.label).toBe('DeepSeek Harness')
    expect(flatten(template[0]?.submenu ?? [])).toContain('About DeepSeek Harness')
    expect(template.some(item => item.label === 'Help')).toBe(false)
  })

  it('puts About under Help elsewhere', () => {
    const template = appMenuTemplate(actions(), 'win32')
    const help = template.find(item => item.label === 'Help')

    expect(flatten(help?.submenu ?? [])).toContain('About DeepSeek Harness')
  })

  it('wires each product item to the action it names', () => {
    const handlers = actions()
    const labels = new Map<string, MenuItemTemplate>()
    const walk = (items: readonly MenuItemTemplate[]): void => {
      for (const item of items) {
        if (item.label !== undefined) labels.set(item.label, item)
        if (item.submenu !== undefined) walk(item.submenu)
      }
    }
    walk(appMenuTemplate(handlers, 'win32'))

    labels.get('About DeepSeek Harness')?.click?.()
    labels.get('Check for Updates…')?.click?.()
    labels.get('Quit')?.click?.()

    expect(handlers.about).toHaveBeenCalledTimes(1)
    expect(handlers.checkUpdates).toHaveBeenCalledTimes(1)
    expect(handlers.quit).toHaveBeenCalledTimes(1)
  })
})
