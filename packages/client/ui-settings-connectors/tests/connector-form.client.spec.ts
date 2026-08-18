/** The staged form behind a connector card: what it shows, and what a save writes. */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ConnectorForm, choiceField, durationField, textField,
} from '../src/client/connector-form.ts'

type Section = Record<string, unknown>

/** A settings scope standing in for the host document, with the writes it took. */
interface FakeScope extends SettingsScope<Section> {
  /** Replace the served snapshot and notify subscribers. */
  publish: (patch: Partial<SettingsScopeSnapshot<Section>>) => void
  /** Every set/unset that crossed this scope, in order. */
  writes: Array<{ op: 'set' | 'unset'; field: string; value?: unknown }>
}

/**
 * Build a scope whose writes land in the user layer and show through in the
 * effective value, which is what the host does when it takes a mutation.
 * @param options.base - composition layer a cleared field falls back to.
 * @param options.user - user layer the section starts with.
 * @param options.refuse - fields the host silently declines to write.
 * @returns the fake scope.
 */
function fakeScope(options: {
  base?: Section
  user?: Section
  refuse?: readonly string[]
} = {}): FakeScope {
  const base = options.base ?? {}
  const refuse = new Set(options.refuse ?? [])
  const listeners = new Set<() => void>()
  const writes: FakeScope['writes'] = []
  let snapshot: SettingsScopeSnapshot<Section> = {
    status: 'ready',
    value: { ...base, ...options.user ?? {} },
    base,
    user: { ...options.user ?? {} },
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const notify = (): void => { for (const listener of listeners) listener() }
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (field, value) => {
      writes.push({ op: 'set', field, value })
      if (!refuse.has(field)) {
        const user = { ...snapshot.user as Section, [field]: value }
        snapshot = { ...snapshot, user, value: { ...base, ...user } }
        notify()
      }
      return Promise.resolve()
    },
    unset: (field) => {
      writes.push({ op: 'unset', field })
      if (!refuse.has(field)) {
        const user = Object.fromEntries(
          Object.entries(snapshot.user as Section).filter(([key]) => key !== field),
        )
        snapshot = { ...snapshot, user, value: { ...base, ...user } }
        notify()
      }
      return Promise.resolve()
    },
    publish: (patch) => {
      snapshot = { ...snapshot, ...patch }
      notify()
    },
  }
}

const SPECS = [textField('presetId'), durationField('flushMs'), choiceField('density', ['compact', 'standard'])]

describe('field specs', () => {
  it('renders only a value of its own type and clears on an empty draft', () => {
    const text = textField('presetId')
    expect(text.format('writing')).toBe('writing')
    expect(text.format(7)).toBe('')
    expect(text.parse('  ')).toEqual({ kind: 'clear' })
    expect(text.parse('  writing  ')).toEqual({ kind: 'set', value: 'writing' })
  })

  it('takes whole non-negative milliseconds and refuses anything else', () => {
    const duration = durationField('flushMs')
    expect(duration.format(2500)).toBe('2500')
    expect(duration.format('2500')).toBe('')
    expect(duration.parse('')).toEqual({ kind: 'clear' })
    expect(duration.parse('2500')).toEqual({ kind: 'set', value: 2500 })
    expect(duration.parse('abc')).toBeUndefined()
    expect(duration.parse('1.5')).toBeUndefined()
    expect(duration.parse('-1')).toBeUndefined()
  })

  it('takes only the values it offers', () => {
    const choice = choiceField('density', ['compact', 'standard'])
    expect(choice.format('compact')).toBe('compact')
    // A stored value outside the offered set renders as no selection rather
    // than as an option the control cannot show.
    expect(choice.format('lavish')).toBe('')
    expect(choice.format(3)).toBe('')
    expect(choice.parse('')).toEqual({ kind: 'clear' })
    expect(choice.parse('standard')).toEqual({ kind: 'set', value: 'standard' })
    expect(choice.parse('lavish')).toBeUndefined()
  })
})

describe('ConnectorForm', () => {
  it('shows the effective value and marks a field the user layer carries', () => {
    const form = new ConnectorForm(fakeScope({ base: { flushMs: 2500 }, user: { presetId: 'writing' } }), SPECS)

    expect(form.field('presetId')).toEqual({ text: 'writing', overridden: true, invalid: false })
    // Inherited from the composition layer: shown, but not an override.
    expect(form.field('flushMs')).toEqual({ text: '2500', overridden: false, invalid: false })
    expect(form.state()).toMatchObject({ status: 'ready', writable: true, dirty: false, invalid: false })
  })

  it('reports the namespace as absent when this deployment serves no section', () => {
    const scope = fakeScope()
    const form = new ConnectorForm(scope, SPECS)
    scope.publish({ status: 'unavailable', writable: false })

    expect(form.state()).toMatchObject({ status: 'absent', writable: false })
  })

  it('carries the loading status through untouched', () => {
    const scope = fakeScope()
    const form = new ConnectorForm(scope, SPECS)
    scope.publish({ status: 'loading' })

    expect(form.state().status).toBe('loading')
  })

  it('stages an edit without writing, then writes every staged field on save', async () => {
    const scope = fakeScope({ base: { flushMs: 2500 } })
    const form = new ConnectorForm(scope, SPECS)
    const { edit } = form.actions()

    edit('presetId', 'writing')
    edit('flushMs', '4000')
    expect(scope.writes).toEqual([])
    expect(form.state()).toMatchObject({ dirty: true, invalid: false })

    await form.save()

    expect(scope.writes).toEqual([
      { op: 'set', field: 'presetId', value: 'writing' },
      { op: 'set', field: 'flushMs', value: 4000 },
    ])
    expect(form.state()).toMatchObject({ dirty: false, failed: false, saving: false })
  })

  it('drops a staged edit that restates what the section already carries', () => {
    const form = new ConnectorForm(fakeScope({ user: { presetId: 'writing' } }), SPECS)

    form.actions().edit('presetId', 'writing')

    expect(form.state().dirty).toBe(false)
  })

  it('blocks the save while a draft is not a value its field takes', async () => {
    const scope = fakeScope()
    const form = new ConnectorForm(scope, SPECS)

    form.actions().edit('flushMs', 'soon')

    expect(form.field('flushMs')).toEqual({ text: 'soon', overridden: false, invalid: true })
    expect(form.state()).toMatchObject({ dirty: true, invalid: true })
    await form.save()
    expect(scope.writes).toEqual([])
  })

  it('clears an override on reset and shows what the field falls back to', async () => {
    const scope = fakeScope({ base: { flushMs: 2500 }, user: { flushMs: 4000 } })
    const form = new ConnectorForm(scope, SPECS)

    form.actions().resetField('flushMs')

    expect(form.field('flushMs')).toEqual({ text: '2500', overridden: false, invalid: false })
    await form.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'flushMs' }])
    expect(form.field('flushMs').overridden).toBe(false)
  })

  it('writes nothing when a field with no override is reset', async () => {
    const scope = fakeScope({ base: { flushMs: 2500 } })
    const form = new ConnectorForm(scope, SPECS)

    form.actions().resetField('flushMs')

    expect(form.state().dirty).toBe(false)
    await form.save()
    expect(scope.writes).toEqual([])
  })

  it('clears the field when the draft is emptied', async () => {
    const scope = fakeScope({ base: { presetId: 'standard' }, user: { presetId: 'writing' } })
    const form = new ConnectorForm(scope, SPECS)

    form.actions().edit('presetId', '')
    await form.save()

    expect(scope.writes).toEqual([{ op: 'unset', field: 'presetId' }])
  })

  it('keeps the drafts and says so when the host did not take a write', async () => {
    const scope = fakeScope({ refuse: ['presetId'] })
    const form = new ConnectorForm(scope, SPECS)

    form.actions().edit('presetId', 'writing')
    await form.save()

    expect(form.state()).toMatchObject({ dirty: true, failed: true, saving: false })
    expect(form.field('presetId').text).toBe('writing')
  })

  it('clears the failure on the next edit', async () => {
    const scope = fakeScope({ refuse: ['presetId'] })
    const form = new ConnectorForm(scope, SPECS)
    form.actions().edit('presetId', 'writing')
    await form.save()

    form.actions().edit('presetId', 'ued')

    expect(form.state().failed).toBe(false)
  })

  it('writes through the action a card binds to its save button', async () => {
    const scope = fakeScope()
    const form = new ConnectorForm(scope, SPECS)
    const actions = form.actions()
    actions.edit('presetId', 'writing')

    actions.save()
    await vi.waitFor(() => { expect(scope.writes).toHaveLength(1) })

    expect(form.state().dirty).toBe(false)
  })

  it('refuses a second save while one is crossing the wire', async () => {
    const scope = fakeScope()
    const form = new ConnectorForm(scope, SPECS)
    form.actions().edit('presetId', 'writing')

    const first = form.save()
    await form.save()
    await first

    expect(scope.writes).toHaveLength(1)
  })

  it('drops every staged edit on discard, and does nothing when there is none', () => {
    const form = new ConnectorForm(fakeScope(), SPECS)
    const listener = vi.fn()
    const store = form.bind(() => form.state().dirty)
    store.subscribe(listener)

    form.actions().discard()
    expect(listener).not.toHaveBeenCalled()

    form.actions().edit('presetId', 'writing')
    expect(store.getSnapshot()).toBe(true)
    form.actions().discard()

    expect(store.getSnapshot()).toBe(false)
    expect(form.field('presetId').text).toBe('')
  })

  it('republishes when the scope moves underneath', () => {
    const scope = fakeScope()
    const form = new ConnectorForm(scope, SPECS)
    const store = form.bind(() => form.field('presetId').text)

    scope.publish({ value: { presetId: 'ued' } })

    expect(store.getSnapshot()).toBe('ued')
  })

  it('refuses to read a field the card never declared', () => {
    const form = new ConnectorForm(fakeScope(), SPECS)

    expect(() => form.field('nope')).toThrow('connector card has no field nope')
  })
})
