import { describe, expect, it } from 'vitest'
import { RunQueue } from '../src/queue.ts'

/** 造一个手动可控的任务，便于断言执行时序。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('RunQueue', () => {
  it('同一时刻只跑一个——共用工作区靠这条不互相覆盖', async () => {
    const queue = new RunQueue()
    const first = deferred()
    const running: string[] = []

    const a = queue.enqueue(async () => { running.push('a-start'); await first.promise; running.push('a-end') })
    const b = queue.enqueue(async () => { running.push('b-start') })

    await Promise.resolve()
    expect(running).toEqual(['a-start'])

    first.resolve()
    await Promise.all([a, b])
    expect(running).toEqual(['a-start', 'a-end', 'b-start'])
  })

  it('先进先出', async () => {
    const queue = new RunQueue()
    const order: number[] = []
    await Promise.all([1, 2, 3].map(n => queue.enqueue(async () => { order.push(n) })))
    expect(order).toEqual([1, 2, 3])
  })

  it('要等的时候给身位，直接开跑的不打扰', async () => {
    const queue = new RunQueue()
    const gate = deferred()
    const notices: number[] = []

    const a = queue.enqueue(() => gate.promise, (p) => { notices.push(p) })
    const b = queue.enqueue(async () => {}, (p) => { notices.push(p) })
    const c = queue.enqueue(async () => {}, (p) => { notices.push(p) })

    // 第一个直接跑，没有回执；后两个分别排在第 1、第 2 位。
    expect(notices).toEqual([1, 2])

    gate.resolve()
    await Promise.all([a, b, c])
  })

  it('一个任务抛错不拖垮后面的', async () => {
    const queue = new RunQueue()
    const done: string[] = []
    const bad = queue.enqueue(async () => { throw new Error('boom') })
    const good = queue.enqueue(async () => { done.push('ok') })

    await expect(bad).rejects.toThrow('boom')
    await good
    expect(done).toEqual(['ok'])
  })

  it('关闭后在等的一律 reject，新入队也 reject', async () => {
    const queue = new RunQueue()
    const gate = deferred()
    const running = queue.enqueue(() => gate.promise)
    const waiting = queue.enqueue(async () => {})

    queue.dispose()
    await expect(waiting).rejects.toThrow('队列已经关闭')
    await expect(queue.enqueue(async () => {})).rejects.toThrow('队列已经关闭')

    gate.resolve()
    await running
  })

  it('depth 只数还没开跑的', async () => {
    const queue = new RunQueue()
    const gate = deferred()
    const a = queue.enqueue(() => gate.promise)
    const b = queue.enqueue(async () => {})
    await Promise.resolve()
    expect(queue.busy).toBe(true)
    expect(queue.depth).toBe(1)
    gate.resolve()
    await Promise.all([a, b])
    expect(queue.depth).toBe(0)
  })
})
