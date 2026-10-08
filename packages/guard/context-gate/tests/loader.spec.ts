/**
 * REAL-composition tier (packages/AGENTS.md): boot the context-gate Loader
 * fixture as a subprocess through the same app/boot path a deployment uses, with
 * a real injection source in the composition, and assert the model-visible
 * surface the gate produces before and after the session's promotion signal.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL(
  './fixtures/loader/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  './fixtures/loader/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface GateReport {
  contextsBefore: number
  contextsAfter: number
  messagesBefore: number
  messagesAfter: number
}

describe('context gate through a real Loader composition', () => {
  it('suppresses injected context and step messages until the session promotes', async () => {
    let report: GateReport | undefined
    const { stderr } = await runLoaderSmoke({
      label: 'context-gate loader smoke',
      tempDirPrefix: 'context-gate-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'context-gate-loader-report.json'), 'utf8')) as GateReport
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(report).toBeDefined()
    // The fixture's `time-context` row contributes one runtime context and one
    // step message, so a zero here can only mean the gate suppressed them.
    expect(report?.contextsBefore).toBe(0)
    expect(report?.messagesBefore).toBe(0)
    expect(report?.contextsAfter).toBeGreaterThan(0)
    expect(report?.messagesAfter).toBeGreaterThan(0)
  }, 90_000)
})
