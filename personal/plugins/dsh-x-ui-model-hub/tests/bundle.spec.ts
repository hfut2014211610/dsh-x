/**
 * Bundle smoke test: execute the built client bundle the way the shell's
 * module table would (capture the factory, answer platform requires with
 * stubs), then drive `apply()` with a mock ctx and assert the settings
 * section registration. This catches wiring errors (bad slot name, missing
 * service, malformed registration) without a browser.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface CapturedRegistration {
  name: string
  id: string
  order?: number
  label?: () => string
}

function loadBundle() {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let captured: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  const windowStub = {
    __ModuleLoader__: {
      load: (entry: typeof captured) => {
        captured = entry as { id: string; factory: (require: (id: string) => unknown) => unknown }
      },
    },
  }
  const bootstrap = new Function('window', code)
  bootstrap(windowStub)
  if (captured === undefined) throw new Error('bundle did not register a factory')
  const requireStub = (id: string): unknown => {
    if (id === '@deepseek-ai/dsh-client-runtime/client') {
      return {
        createSnapshotStore: (initial: unknown) => ({
          getSnapshot: () => initial,
          update: () => undefined,
          subscribe: () => () => undefined,
        }),
      }
    }
    if (id === '@deepseek-ai/dsh-client-web-react') {
      return { bindSnapshotSelector: () => () => ({}) }
    }
    return {}
  }
  const exports = (captured as { factory: (require: (id: string) => unknown) => { apply?: unknown; inject?: unknown } })
    .factory(requireStub) as { apply: (ctx: never) => void; inject: string[] }
  return exports
}

describe('client bundle', () => {
  it('declares the expected service inject list', () => {
    const exports = loadBundle()
    expect(exports.inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('registers the model-hub settings section', () => {
    const exports = loadBundle()
    const registrations: CapturedRegistration[] = []
    const locales: Record<string, unknown> = {}
    const slotInjects: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => { fn() },
      locale: {
        register: (ns: string, dicts: unknown) => {
          locales[ns] = dicts
          return () => undefined
        },
        bind: () => (key: string) => key,
      },
      get: () => ({ api: {} }),
      remote: { $on: () => () => undefined },
      on: () => () => undefined,
      slots: {
        inject: (name: string, callback: () => unknown) => {
          slotInjects.push(name)
          callback()
        },
        register: (options: CapturedRegistration, _component: unknown) => {
          registrations.push(options)
          return () => undefined
        },
      },
    }
    exports.apply(ctx as never)
    expect(slotInjects).toEqual(['settings.section'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({ name: 'settings.section', id: 'model-hub', order: 20 })
    expect(typeof registrations[0]!.label).toBe('function')
    expect(Object.keys(locales)).toEqual(['settings.model-hub'])
  })
})
