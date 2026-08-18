import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

interface CapturedRegistration {
  name: string
  id: string
  order?: number
  label?: () => string
}

describe('ui-model-hub apply', () => {
  it('declares the expected service inject list', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('registers the model-hub settings section', () => {
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
      get: () => ({ rpc: {} }),
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
    apply(ctx as never)
    expect(slotInjects).toEqual(['settings.section'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({ name: 'settings.section', id: 'model-hub', order: 20 })
    expect(typeof registrations[0]!.label).toBe('function')
    expect(Object.keys(locales)).toEqual(['settings.model-hub'])
  })
})
