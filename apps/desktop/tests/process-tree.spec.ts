import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { killProcessTree, spawnRuntimeProcess } from '../src/process-tree.ts'

const spawnCalls = vi.hoisted((): Array<{ command: string; options: Record<string, unknown> }> => [])
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  // The win32 call site passes only (command, options); POSIX passes (command, args, options).
  const fake = (
    command: string,
    argsOrOptions: readonly string[] | Record<string, unknown> | undefined,
    maybeOptions: Record<string, unknown> | undefined,
  ) => {
    const options = Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions
    spawnCalls.push({ command, options: { ...(options ?? {}) } })
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      stdout: PassThrough
      stderr: PassThrough
      kill: () => void
    }
    child.pid = 1618
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    return child
  }
  return { ...actual, spawn: fake } as unknown as typeof actual
})

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

describe('spawnRuntimeProcess', () => {
  // The win32 path resolves a PATH `dsh` through a shell wrapper; POSIX spawns
  // the shebang directly and never allocates a console.
  it.runIf(process.platform === 'win32')('hides the shell wrapper console so the app never sits next to a cmd window', () => {
    spawnRuntimeProcess({ command: 'dsh', args: [] }, ['web'])
    const last = spawnCalls.at(-1)
    expect(last?.options.shell).toBe(true)
    expect(last?.options.windowsHide).toBe(true)
  })
})
