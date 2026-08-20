// 回收上次桥接留下的 lark-cli 消费者。有意思的不是顺利那条路，而是两条会杀错
// 进程的：pid 被重用了，以及命令行根本读不到。
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearOwnedConsumers, readOwnedConsumers, reapOwnedConsumers, writeOwnedConsumers,
  type OwnedConsumer, type ReapDeps,
} from '../bridge/owned-consumers.ts'

const MESSAGE = 'im.message.receive_v1'
const CARD = 'card.action.trigger'

function deps(
  records: readonly OwnedConsumer[],
  overrides: Partial<ReapDeps> = {},
): ReapDeps & { killed: number[]; cleared: () => number } {
  const killed: number[] = []
  let cleared = 0
  return {
    readRecords: async () => records,
    clearRecords: async () => { cleared += 1 },
    alive: () => true,
    commandLine: pid => `lark-cli event consume ${pid === 11 ? MESSAGE : CARD} --as bot`,
    kill: (pid) => { killed.push(pid) },
    ...overrides,
    killed,
    cleared: () => cleared,
  }
}

describe('reapOwnedConsumers', () => {
  it('kills the consumers the last bridge left holding their event keys', async () => {
    const environment = deps([{ pid: 11, eventKey: MESSAGE }, { pid: 12, eventKey: CARD }])

    const lines = await reapOwnedConsumers(environment)

    expect(environment.killed).toEqual([11, 12])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(MESSAGE)
    expect(environment.cleared()).toBe(1)
  })

  // A pid is not an identity. The operating system reuses them, and a note kept
  // from a previous boot names numbers that now belong to anything at all.
  it('leaves a reused pid alone when its command line is something else', async () => {
    const environment = deps([{ pid: 11, eventKey: MESSAGE }], {
      commandLine: () => 'C:\\Windows\\System32\\notepad.exe',
    })

    const lines = await reapOwnedConsumers(environment)

    expect(environment.killed).toEqual([])
    expect(lines).toEqual([])
    // Still cleared: a note kept past its launch gets re-examined forever, and
    // every re-examination is another chance for that pid to have moved on.
    expect(environment.cleared()).toBe(1)
  })

  // Unreadable is not the same as ours. Permission, or the process exiting
  // between the liveness check and the query — either way there is no evidence,
  // and an orphan someone has to kill by hand beats killing a stranger.
  it('leaves a process whose command line cannot be read', async () => {
    const environment = deps([{ pid: 11, eventKey: MESSAGE }], { commandLine: () => undefined })

    await reapOwnedConsumers(environment)

    expect(environment.killed).toEqual([])
  })

  it('skips a pid that is already gone', async () => {
    const commandLine = vi.fn(() => `lark-cli event consume ${MESSAGE}`)
    const environment = deps([{ pid: 11, eventKey: MESSAGE }], { alive: () => false, commandLine })

    await reapOwnedConsumers(environment)

    expect(environment.killed).toEqual([])
    // Nothing to identify: the liveness check already answered.
    expect(commandLine).not.toHaveBeenCalled()
  })

  it('clears the note when there was nothing recorded', async () => {
    const environment = deps([])

    expect(await reapOwnedConsumers(environment)).toEqual([])
    expect(environment.cleared()).toBe(1)
  })
})

describe('the note on disk', () => {
  it('round-trips, and overwrites rather than accumulating', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-owned-'))
    const path = join(dir, 'nested', 'owned-consumers.json')
    try {
      await writeOwnedConsumers(path, [{ pid: 11, eventKey: MESSAGE }, { pid: 12, eventKey: CARD }])
      expect(await readOwnedConsumers(path)).toEqual([{ pid: 11, eventKey: MESSAGE }, { pid: 12, eventKey: CARD }])

      // The note says what this bridge owns NOW; a consumer that stopped must
      // not stay in it, which is why the write is whole-file.
      await writeOwnedConsumers(path, [{ pid: 12, eventKey: CARD }])
      expect(await readOwnedConsumers(path)).toEqual([{ pid: 12, eventKey: CARD }])

      await clearOwnedConsumers(path)
      expect(await readOwnedConsumers(path)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The best a damaged note can do is nothing. Refusing to start over a file
  // whose only job is a fallback path would be the worse failure.
  it('reads a missing or damaged note as no note at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-owned-'))
    try {
      expect(await readOwnedConsumers(join(dir, 'absent.json'))).toEqual([])

      const damaged = join(dir, 'damaged.json')
      await writeFile(damaged, '{ not json', 'utf8')
      expect(await readOwnedConsumers(damaged)).toEqual([])

      // Shape, not just syntax: entries that are not records are dropped and
      // the rest still count.
      const mixed = join(dir, 'mixed.json')
      await writeFile(mixed, JSON.stringify([{ pid: 11, eventKey: MESSAGE }, { pid: 'x' }, 7]), 'utf8')
      expect(await readOwnedConsumers(mixed)).toEqual([{ pid: 11, eventKey: MESSAGE }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('clearing a note that was never written is not an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-owned-'))
    try {
      await expect(clearOwnedConsumers(join(dir, 'absent.json'))).resolves.toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes a file a person can read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-owned-'))
    const path = join(dir, 'owned-consumers.json')
    try {
      await writeOwnedConsumers(path, [{ pid: 11, eventKey: MESSAGE }])
      const text = await readFile(path, 'utf8')
      expect(text).toContain('\n  {\n')
      expect(text.endsWith('\n')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
