/**
 * Dump a dsh JSONL session log (`.jsonl.zstd` frame-concatenated) to stdout.
 *
 * Usage (repo root, Node ^22.19 || >=24):
 *   node --import tsx/esm personal/scripts/dump-session.ts <session.jsonl.zstd> [type-filter]
 *
 * Example: print only request headers
 *   node --import tsx/esm personal/scripts/dump-session.ts ~/.dsh/sessions/<proj>/<sid>/session.jsonl.zstd request/header
 */
import { readFileSync } from 'node:fs'
import { decompressZstdFrame, scanZstdFrames } from '../../packages/session/session-persistence-jsonl/src/zstd.ts'

const [, , file, filter] = process.argv
if (file === undefined) {
  console.error('usage: dump-session.ts <session.jsonl.zstd> [type-filter]')
  process.exit(1)
}

const buffer = readFileSync(file)
const { frames, tornStart } = scanZstdFrames(buffer)
const lines: string[] = []
for (const frame of frames) {
  const plaintext = await decompressZstdFrame(buffer.subarray(frame.start, frame.end))
  lines.push(...plaintext.toString('utf8').trimEnd().split('\n'))
}
if (tornStart !== undefined) {
  console.error(`warning: torn tail frame at byte ${String(tornStart)} ignored`)
}
for (const line of lines) {
  if (filter !== undefined && !line.includes(`"type":"${filter}"`)) continue
  console.log(line)
}
