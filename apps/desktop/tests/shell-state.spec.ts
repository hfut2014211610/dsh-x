import { describe, expect, it } from 'vitest'
import { createShellState, type ShellSnapshot } from '../src/shell-state.ts'

/** Collect snapshots emitted by one store. */
function collect(maxLogs?: number): { snapshots: ShellSnapshot[]; store: ReturnType<typeof createShellState> } {
  const snapshots: ShellSnapshot[] = []
  const onSnapshot = (snapshot: ShellSnapshot): void => { snapshots.push(snapshot) }
  const store = maxLogs === undefined ? createShellState(onSnapshot) : createShellState(onSnapshot, maxLogs)
  return { snapshots, store }
}

describe('createShellState', () => {
  it('starts in the discovering phase and publishes every change', () => {
    const { snapshots, store } = collect()
    expect(store.snapshot().phase).toBe('discovering')
    store.phase('launching', 'starting dsh web')
    store.runtime({ source: 'path', version: '1.0.0' })
    store.ready('http://127.0.0.1:9/')
    expect(snapshots.map(snapshot => snapshot.phase)).toEqual(['launching', 'launching', 'ready'])
    expect(snapshots[0]).toMatchObject({ phase: 'launching', detail: 'starting dsh web' })
    expect(snapshots[1]).toMatchObject({ runtime: { source: 'path', version: '1.0.0' } })
    expect(snapshots[2]).toMatchObject({ phase: 'ready', url: 'http://127.0.0.1:9/' })
  })

  it('bounds the log history', () => {
    const { store } = collect(3)
    for (let index = 0; index < 5; index += 1) store.log(`line ${String(index)}`)
    expect(store.snapshot().logs).toEqual(['line 2', 'line 3', 'line 4'])
  })

  it('emits copies: later mutations never rewrite a published snapshot', () => {
    const { snapshots, store } = collect()
    store.log('first')
    store.log('second')
    expect(snapshots[0]?.logs).toEqual(['first'])
    expect(snapshots[1]?.logs).toEqual(['first', 'second'])
  })

  it('a failed phase keeps the logs for the retry screen', () => {
    const { store } = collect()
    store.log('serving-instance: no dsh answers')
    store.phase('failed', 'no runtime')
    expect(store.snapshot()).toMatchObject({ phase: 'failed', detail: 'no runtime', logs: ['serving-instance: no dsh answers'] })
  })
})
