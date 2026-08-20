import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { spawnSubprocess } from '../src/spawn.ts'

const calls = vi.hoisted((): Array<{ file: string; args: string[]; options: Record<string, unknown> }> => [])
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const fake = (file: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ file, args, options })
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      stdout: PassThrough
      stderr: PassThrough
      kill: () => void
    }
    child.pid = 4212
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    return child
  }
  return { ...actual, spawn: fake } as unknown as typeof actual
})

describe('spawnSubprocess window suppression', () => {
  it('hides the child console so a console-less parent (desktop sidecar, detached bridge) never flashes one', () => {
    spawnSubprocess({
      argv: ['true'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 100,
    })
    expect(calls.at(-1)?.options.windowsHide).toBe(true)
  })
})
