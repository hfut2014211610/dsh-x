/**
 * Repair pre-fix forked Session logs into readable current-format successors.
 *
 * Two historical vocabularies make a pre-v3 log unreadable under the released
 * migration policy without the log being corrupt:
 *
 * 1. `user/message` sources with `kind: 'instruction-hint'` — the anchored
 *    preset's pre-fix hint. The released V2 source audit refuses this
 *    fork-only kind, so every Session that ever injected the hint fails to
 *    migrate. The repaired log carries the released
 *    `{ kind: 'plugin', plugin: 'instruction-hint', form: 'instructions' }`
 *    source instead.
 * 2. `subagent/descriptor` events with `version: 2` — shipped by pre-0.1.2
 *    alpha releases. The v0-to-v1 edge refuses any descriptor version other
 *    than 3. The repaired log preserves the descriptor as version 2 (the
 *    current reader accepts it and treats the child as not resumable).
 *
 * The tool never rewrites a committed generation. For each affected Session it
 * builds a repaired copy under a temporary root, lets the real persistence
 * backend publish a current-generation successor there, patches the descriptor
 * version back inside that successor when needed, verifies the successor
 * reads, then copies it beside the original as `session.v3.jsonl.zstd`. The
 * original file is copied to a timestamped backup directory first.
 *
 * Usage (repo root, Node ^22.19 || >=24):
 *   node --import tsx/esm personal/scripts/repair-session-formats.ts
 *   node --import tsx/esm personal/scripts/repair-session-formats.ts --apply
 *   node --import tsx/esm personal/scripts/repair-session-formats.ts --apply --only hint
 *   node --import tsx/esm personal/scripts/repair-session-formats.ts --home C:\Users\me\.dsh
 */
import { constants } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  compressZstdFrame,
  decompressZstdFrame,
  scanZstdFrames,
} from '../../packages/session/session-persistence-jsonl/src/zstd.ts'

type JsonRecord = Record<string, unknown>

interface DecodedFrame {
  readonly bytes: Buffer
  readonly text: string
}

interface Task {
  readonly project: string
  readonly sessionDir: string
  readonly generationName: string
  readonly path: string
  readonly id: string
  readonly hintCount: number
  readonly descriptors: JsonRecord[]
  readonly frames: DecodedFrame[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function* messageSources(row: JsonRecord): Generator<JsonRecord, void, void> {
  const data = isRecord(row['data']) ? row['data'] : undefined
  if (data === undefined) return
  switch (row['type']) {
    case 'user/message': {
      const source = isRecord(data['source']) ? data['source'] : undefined
      if (source !== undefined) yield source
      return
    }
    case 'assistant/message':
    case 'tool/result': {
      const message = isRecord(data['message']) ? data['message'] : undefined
      const source = isRecord(message?.['source']) ? message['source'] : undefined
      if (source !== undefined) yield source
      return
    }
    case 'agent/inbox/spliced': {
      for (const member of asArray(data['inserted'])) {
        const source = isRecord(member) && isRecord(member['source']) ? member['source'] : undefined
        if (source !== undefined) yield source
      }
      return
    }
    case 'session/title-llm-request': {
      for (const member of asArray(data['messages'])) {
        const source = isRecord(member) && isRecord(member['source']) ? member['source'] : undefined
        if (source !== undefined) yield source
      }
      return
    }
  }
}

function isInstructionHintSource(source: JsonRecord): boolean {
  return source['kind'] === 'instruction-hint'
    || (source['kind'] === 'plugin' && source['plugin'] === 'instruction-hint')
}

function patchInstructionHint(row: JsonRecord): boolean {
  let changed = false
  for (const source of messageSources(row)) {
    if (source['kind'] !== 'instruction-hint') continue
    source['kind'] = 'plugin'
    source['plugin'] = 'instruction-hint'
    source['form'] = 'instructions'
    changed = true
  }
  return changed
}

function stripVersion(data: JsonRecord): JsonRecord {
  const copy = { ...data }
  delete copy['version']
  return copy
}

function descriptorPayload(row: JsonRecord): JsonRecord | undefined {
  if (row['type'] !== 'subagent/descriptor') return undefined
  const data = isRecord(row['data']) ? row['data'] : undefined
  if (data === undefined || data['version'] !== 2) return undefined
  return stripVersion(data)
}

async function readDecodedFrames(path: string): Promise<DecodedFrame[]> {
  const buffer = await readFile(path)
  const { frames, tornStart } = scanZstdFrames(buffer)
  if (tornStart !== undefined) {
    throw new Error(`torn final frame at byte ${String(tornStart)}`)
  }
  const decoded: DecodedFrame[] = []
  for (const frame of frames) {
    const text = (await decompressZstdFrame(buffer.subarray(frame.start, frame.end))).toString('utf8')
    decoded.push({ bytes: buffer.subarray(frame.start, frame.end), text })
  }
  return decoded
}

function parseRows(frames: readonly DecodedFrame[]): JsonRecord[] {
  const rows: JsonRecord[] = []
  for (const frame of frames) {
    for (const line of frame.text.split('\n')) {
      if (line.length === 0) continue
      rows.push(JSON.parse(line) as JsonRecord)
    }
  }
  return rows
}

async function rewriteFrames(
  frames: readonly DecodedFrame[],
  rewrite: (row: JsonRecord) => boolean,
): Promise<Buffer> {
  const out: Buffer[] = []
  for (const frame of frames) {
    const lines = frame.text.split('\n')
    let frameChanged = false
    const rewritten = lines.map((line) => {
      if (line.length === 0) return line
      const row = JSON.parse(line) as JsonRecord
      if (!rewrite(row)) return line
      frameChanged = true
      return JSON.stringify(row)
    })
    out.push(frameChanged
      ? await compressZstdFrame(Buffer.from(rewritten.join('\n'), 'utf8'))
      : frame.bytes)
  }
  return Buffer.concat(out)
}

async function openWithPersistence(
  root: string,
  id: string,
  accessMode: 'read' | 'write',
): Promise<number> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const persistence = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
  try {
    const handle = await ctx.sessionPersistence.open(SessionId(id), accessMode)
    let events = 0
    if (accessMode === 'read') {
      const result = await handle.read(0)
      events = result.events.length
    }
    await handle.close()
    return events
  } finally {
    await persistence.dispose().catch(() => {})
    await ctx.fiber.dispose().catch(() => {})
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function generationName(sessionDir: string): Promise<{ name: string; version: number } | undefined> {
  let best: { name: string; version: number } | undefined
  for (const name of await readdir(sessionDir)) {
    const match = /^session(?:\.(v(\d+)))?\.jsonl(?:\.zstd)?$/.exec(name)
    if (match === null) continue
    const version = match[2] === undefined ? 0 : Number(match[2])
    if (best === undefined || version > best.version) best = { name, version }
  }
  return best
}

async function scanRoot(sessionsRoot: string, only: 'hint' | 'descriptor' | 'all'): Promise<Task[]> {
  const tasks: Task[] = []
  for (const project of await readdir(sessionsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectPath = join(sessionsRoot, project.name)
    for (const session of await readdir(projectPath, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const sessionDir = join(projectPath, session.name)
      const generation = await generationName(sessionDir)
      if (generation === undefined || generation.version >= 3) continue
      const path = join(sessionDir, generation.name)
      let frames: DecodedFrame[]
      let rows: JsonRecord[]
      try {
        frames = await readDecodedFrames(path)
        rows = parseRows(frames)
      } catch {
        continue
      }
      const header = rows[0]
      if (!isRecord(header) || typeof header['id'] !== 'string') continue
      const id = header['id']
      let hintCount = 0
      const descriptors: JsonRecord[] = []
      for (const row of rows) {
        for (const source of messageSources(row)) {
          if (isInstructionHintSource(source)) hintCount++
        }
        const payload = descriptorPayload(row)
        if (payload !== undefined) descriptors.push(payload)
      }
      const hasHint = hintCount > 0
      const hasDescriptor = descriptors.length > 0
      if (only === 'hint' && !hasHint) continue
      if (only === 'descriptor' && !hasDescriptor) continue
      if (!hasHint && !hasDescriptor) continue
      tasks.push({
        project: project.name,
        sessionDir: session.name,
        generationName: generation.name,
        path,
        id,
        hintCount,
        descriptors,
        frames,
      })
    }
  }
  return tasks
}

async function repairOne(task: Task, backupRoot: string): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-session-repair-'))
  try {
    const tempSessionsRoot = join(tempRoot, 'sessions')
    const tempSessionDir = join(tempSessionsRoot, task.project, task.sessionDir)
    await mkdir(tempSessionDir, { recursive: true })

    // Temporarily normalize descriptor v2 -> v3 so the released migration
    // accepts the log; the published successor is patched back to v2 below.
    const patched = await rewriteFrames(task.frames, (row) => {
      const hintChanged = patchInstructionHint(row)
      let descriptorChanged = false
      if (row['type'] === 'subagent/descriptor') {
        const data = isRecord(row['data']) ? row['data'] : undefined
        if (data !== undefined && data['version'] === 2) {
          data['version'] = 3
          descriptorChanged = true
        }
      }
      return hintChanged || descriptorChanged
    })
    await writeFile(join(tempSessionDir, task.generationName), patched)

    await openWithPersistence(tempSessionsRoot, task.id, 'write')
    const tempV3 = join(tempSessionDir, 'session.v3.jsonl.zstd')
    if (!await exists(tempV3)) {
      throw new Error('write-open did not publish session.v3.jsonl.zstd')
    }

    if (task.descriptors.length > 0) {
      const v3Frames = await readDecodedFrames(tempV3)
      const remaining = task.descriptors.map(body => ({ body }))
      const reverted = await rewriteFrames(v3Frames, (row) => {
        if (row['type'] !== 'subagent/descriptor') return false
        const data = isRecord(row['data']) ? row['data'] : undefined
        if (data === undefined || data['version'] !== 3) return false
        const copy = stripVersion(data)
        const index = remaining.findIndex(entry => isDeepStrictEqual(entry.body, copy))
        if (index < 0) return false
        remaining.splice(index, 1)
        data['version'] = 2
        return true
      })
      if (remaining.length > 0) {
        throw new Error(`could not revert ${String(remaining.length)} descriptor event(s) in the v3 successor`)
      }
      await writeFile(tempV3, reverted)
    }

    await openWithPersistence(tempSessionsRoot, task.id, 'read')

    await mkdir(join(backupRoot, task.project, task.sessionDir), { recursive: true })
    await copyFile(
      task.path,
      join(backupRoot, task.project, task.sessionDir, task.generationName),
      constants.COPYFILE_EXCL,
    )

    const realSessionDir = join(task.path, '..')
    const realSessionsRoot = join(realSessionDir, '..', '..')
    const destination = join(realSessionDir, 'session.v3.jsonl.zstd')
    if (await exists(destination)) {
      throw new Error('destination session.v3.jsonl.zstd already exists')
    }
    await copyFile(tempV3, destination, constants.COPYFILE_EXCL)

    const events = await openWithPersistence(realSessionsRoot, task.id, 'read')
    if (events <= 0) {
      await rm(destination, { force: true })
      throw new Error('repaired session read back zero events')
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function parseArgs(): {
  home: string
  apply: boolean
  only: 'hint' | 'descriptor' | 'all'
} {
  const args = process.argv.slice(2)
  let home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  let apply = false
  let only: 'hint' | 'descriptor' | 'all' = 'all'
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--apply') apply = true
    else if (arg === '--home') home = args[++i] ?? home
    else if (arg === '--only') {
      const value = args[++i]
      if (value === 'hint' || value === 'descriptor' || value === 'all') only = value
    }
  }
  return { home, apply, only }
}

async function main(): Promise<void> {
  const { home, apply, only } = parseArgs()
  const sessionsRoot = join(home, 'sessions')
  const tasks = await scanRoot(sessionsRoot, only)
  console.log(`found ${String(tasks.length)} affected session(s) under ${sessionsRoot}`)
  for (const task of tasks) {
    console.log([
      `  ${task.project}/${task.sessionDir}`,
      `gen=${task.generationName}`,
      `hints=${String(task.hintCount)}`,
      `descriptors=${String(task.descriptors.length)}`,
    ].join(' '))
  }
  if (!apply) {
    console.log('dry run — pass --apply to repair')
    return
  }
  if (tasks.length === 0) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupRoot = join(home, `session-repair-backup-${stamp}`)
  await mkdir(backupRoot, { recursive: true })
  let repaired = 0
  let failed = 0
  for (const task of tasks) {
    try {
      await repairOne(task, backupRoot)
      repaired++
      console.log(`repaired ${task.project}/${task.sessionDir}`)
    } catch (error) {
      failed++
      console.error(`FAILED ${task.project}/${task.sessionDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`done: ${String(repaired)} repaired, ${String(failed)} failed`)
  console.log(`backup: ${backupRoot}`)
  if (failed > 0) process.exitCode = 1
}

await main()
