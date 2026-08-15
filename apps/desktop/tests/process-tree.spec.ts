import { describe, expect, it } from 'vitest'
import { killProcessTree } from '../src/process-tree.ts'

/** Deps recording every kill delivery. */
function recorder(platform: NodeJS.Platform, signalError?: Error) {
  const taskkills: string[][] = []
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = []
  return {
    deps: {
      platform,
      taskkill: (args: readonly string[]) => { taskkills.push([...args]) },
      signalProcess: (pid: number, signal: NodeJS.Signals) => {
        if (signalError !== undefined) throw signalError
        signals.push({ pid, signal })
      },
    },
    taskkills,
    signals,
  }
}

describe('killProcessTree', () => {
  it('walks the tree with taskkill on Windows', () => {
    const { deps, taskkills } = recorder('win32')
    killProcessTree(3141, deps)
    expect(taskkills).toEqual([['/PID', '3141', '/T', '/F']])
  })

  it('signals the process group on POSIX', () => {
    const { deps, signals } = recorder('linux')
    killProcessTree(3141, deps)
    expect(signals).toEqual([{ pid: -3141, signal: 'SIGTERM' }])
  })

  it('falls back to the bare pid when the group is gone', () => {
    const groupGone = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = []
    killProcessTree(2718, {
      platform: 'darwin',
      taskkill: () => { throw new Error('posix never taskkills') },
      signalProcess: (pid, signal) => {
        if (pid < 0) throw groupGone
        signals.push({ pid, signal })
      },
    })
    expect(signals).toEqual([{ pid: 2718, signal: 'SIGTERM' }])
  })

  it('treats an already-dead tree as success', () => {
    const dead = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    expect(() =>{  killProcessTree(1618, {
      platform: 'linux',
      taskkill: () => { throw new Error('posix never taskkills') },
      signalProcess: () => { throw dead },
    }) }).not.toThrow()
  })

  it('surfaces a real signal failure', () => {
    expect(() =>{  killProcessTree(1414, {
      platform: 'linux',
      taskkill: () => { throw new Error('posix never taskkills') },
      signalProcess: () => { throw new Error('EPERM') },
    }) }).toThrow('EPERM')
  })
})
