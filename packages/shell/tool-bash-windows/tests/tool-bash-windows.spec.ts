/**
 * Windows bash tool: candidate discovery from a PATH-resolved git and from the
 * conventional roots; executable resolution preferring the configured path, then
 * a git-relative candidate, then a bare `bash`; the mount-time preflight caching
 * one executable; the spawn spec and working directory; a non-zero exit reported
 * as a failure; a silent success reporting its exit code; a failed stream read
 * tolerated; and a mount that rejects before publishing a tool it cannot back.
 */

import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalEnvironment,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as bashWindows from '@deepseek-ai/dsh-tool-bash-windows'

const SIGNAL = new AbortController().signal

/** Git Bash derived from a `git` on the D: drive. */
const GIT = win32.join('D:\\Tools\\Git', 'cmd', 'git.exe')
const GIT_BASH = win32.join('D:\\Tools\\Git', 'bin', 'bash.exe')

/** The only executables the mounted plugin may resolve. */
const GIT_RESOLVABLE: Readonly<Record<string, string>> = { git: GIT, [GIT_BASH]: GIT_BASH }

/** What one spawned child reports. */
interface ChildReport {
  exitCode?: number | null
  stdout?: string
  stderr?: string
  /** Make both collected readers reject, as a backend without buffers would. */
  unreadable?: boolean
  /** Reject `done`, as a spawn-level failure does. */
  spawnError?: Error
}

/** One settled child process, as the spawn seam must return it. */
function child(report: ChildReport = {}): SubprocessHandle {
  const reader = (text: string) => (): { readonly text: string } => {
    if (report.unreadable === true) throw new Error('reader unavailable')
    return { text }
  }
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: reader(report.stdout ?? '') },
      stderr: { readFrom: reader(report.stderr ?? '') },
    },
    done: report.spawnError === undefined
      ? Promise.resolve({ exitCode: report.exitCode ?? 0 })
      : Promise.reject(report.spawnError),
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  } as unknown as SubprocessHandle
}

/** What the fake seam resolves and reports. */
interface FakeConfig {
  /** Commands this seam resolves, each to the value it maps to. */
  resolvable?: Readonly<Record<string, string>>
  child?: ChildReport
}

/** A subprocess seam that resolves only the names the test allows. */
class FakeSubprocess extends SubprocessRuntime {
  /** Every command the plugin looked up, in order. */
  readonly lookups: string[] = []
  /** Commands this seam resolves, each to the value it maps to. */
  readonly resolvable: ReadonlyMap<string, string>
  /** Spawn specs the plugin requested. */
  readonly spawns: SubprocessSpawnSpec[] = []
  /** What each spawned child reports. */
  private report: ChildReport

  constructor(ctx: CordisContext, config: FakeConfig = {}) {
    super(ctx)
    this.resolvable = new Map(Object.entries(config.resolvable ?? {}))
    this.report = config.child ?? { exitCode: 0, stdout: 'ok' }
  }

  override async resolveExecutable(command: string): Promise<string> {
    this.lookups.push(command)
    const resolved = this.resolvable.get(command)
    if (resolved === undefined) throw new Error(`${command} missing`)
    return resolved
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    return child(this.report)
  }

  override terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    throw new Error('this tool never asks for a terminal')
  }

  override spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('this tool never asks for a terminal')
  }
}

/** A lookup seam recording every command it is asked to resolve. */
function lookupOnly(lookups: string[], available: string[]): bashWindows.ExecutableLookup {
  return {
    resolveExecutable: async (command: string) => {
      lookups.push(command)
      if (!available.includes(command)) throw new Error(`${command} missing`)
      return command
    },
  }
}

/** Mount the tools registry, the fake subprocess seam, and the plugin. */
async function mount(
  config: bashWindows.Config = {},
  fsConfig: FakeConfig = { resolvable: { git: GIT, [GIT_BASH]: GIT_BASH } },
): Promise<{ ctx: Context; fs: FakeSubprocess }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeSubprocess, fsConfig)
  const fs = ctx.get('subprocess') as FakeSubprocess
  await bashWindows.apply(ctx, config)
  return { ctx, fs }
}

let nextCall = 0

/** Call the `bash` tool and return its rendered text and failure flag. */
async function call(ctx: Context, args: unknown): Promise<{ text: string; failed: boolean }> {
  nextCall += 1
  const result = await ctx.tools.execute({
    callId: ToolCallId(`call-${nextCall}`),
    name: 'bash',
    arguments: args,
    signal: SIGNAL,
  })
  const text = result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  return { text, failed: result.isError }
}

describe('bash candidates', () => {
  it('puts the git-relative bash ahead of the environment roots', () => {
    const candidates = bashWindows.bashCandidates({}, GIT)
    expect(candidates[0]).toBe(GIT_BASH)
    expect(candidates).toContain(win32.join('D:\\Tools\\Git', 'cmd', 'bash.exe'))
    expect(candidates).toContain(win32.join('D:\\Tools', 'bin', 'bash.exe'))
  })

  it('drops the .exe suffix from a git resolved without one', () => {
    expect(bashWindows.bashCandidates({}, '/usr/local/bin/git')[0]).toBe('/usr/local/bin/bash')
  })

  it('skips git-derived candidates for a bare PATH name', () => {
    expect(bashWindows.bashCandidates({}, 'git')).toEqual([])
  })

  it('probes the conventional environment roots', () => {
    expect(bashWindows.bashCandidates({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\dev',
    }, undefined)).toEqual([
      win32.join('C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      win32.join('C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      win32.join('C:\\Users\\dev\\AppData\\Local', 'Programs', 'Git', 'bin', 'bash.exe'),
      win32.join('C:\\Users\\dev', 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    ])
  })

  it('deduplicates a root a git candidate already covered', () => {
    const candidates = bashWindows.bashCandidates({ ProgramFiles: 'D:\\Tools\\Git' }, GIT)
    expect(new Set(candidates).size).toBe(candidates.length)
  })
})

describe('bash executable resolution', () => {
  it('prefers the configured path', async () => {
    const lookups: string[] = []
    const shell = await bashWindows.resolveBashExecutable(
      lookupOnly(lookups, ['C:\\custom\\bash.exe']),
      'C:\\custom\\bash.exe',
      {},
      SIGNAL,
    )
    expect(shell).toBe('C:\\custom\\bash.exe')
    expect(lookups).toEqual(['C:\\custom\\bash.exe'])
  })

  it('rejects a configured path that is not executable', async () => {
    await expect(bashWindows.resolveBashExecutable(lookupOnly([], []), 'C:\\nope\\bash.exe', {}, SIGNAL))
      .rejects.toThrow(/configured bashPath/)
  })

  it('falls back through the git candidates to a bare bash', async () => {
    const lookups: string[] = []
    const shell = await bashWindows.resolveBashExecutable(
      lookupOnly(lookups, ['git', 'bash']),
      undefined,
      {},
      SIGNAL,
    )
    expect(shell).toBe('bash')
    expect(lookups[0]).toBe('git')
    expect(lookups.at(-1)).toBe('bash')
  })

  it('rejects when nothing resolves', async () => {
    await expect(bashWindows.resolveBashExecutable(lookupOnly([], []), undefined, {}, SIGNAL))
      .rejects.toThrow('Git Bash is unavailable')
  })
})

describe('windows bash tool', () => {
  it('registers bash and caches one executable for every call', async () => {
    const { ctx, fs } = await mount()
    expect(fs.lookups).toEqual(['git', GIT_BASH])
    expect(ctx.tools.schemas().some(s => s.name === 'bash')).toBe(true)

    await call(ctx, { command: 'printf ok' })
    await call(ctx, { command: 'printf ok' })
    expect(fs.lookups).toEqual(['git', GIT_BASH])
    expect(fs.spawns.map(spec => spec.argv))
      .toEqual([[GIT_BASH, '-c', 'printf ok'], [GIT_BASH, '-c', 'printf ok']])
    await ctx.fiber.dispose()
  })

  it('rejects the mount before publishing a tool it cannot back', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess, {})
    await expect(bashWindows.apply(ctx, {})).rejects.toThrow('Git Bash is unavailable')
    expect(ctx.tools.schemas().some(s => s.name === 'bash')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('requires the subprocess service', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await expect(bashWindows.apply(ctx, {})).rejects.toThrow(/subprocess service/)
    await ctx.fiber.dispose()
  })

  it('names the working directory explicitly', async () => {
    const { ctx, fs } = await mount()
    await call(ctx, { command: 'pwd', workdir: '/tmp' })
    expect(fs.spawns[0]?.cwd).toBe('/tmp')

    await call(ctx, { command: 'pwd' })
    expect(fs.spawns[1]?.cwd).toBe(process.cwd())
    await ctx.fiber.dispose()
  })

  it('bounds both output streams', async () => {
    const { ctx, fs } = await mount({ maxOutputBytes: 128 })
    await call(ctx, { command: 'yes' })
    expect(fs.spawns[0]?.stdio).toEqual({
      stdin: 'ignore',
      stdout: { maxBytes: 128 },
      stderr: { maxBytes: 128 },
    })
    await ctx.fiber.dispose()
  })

  it('reports a non-zero exit as a failure carrying the output', async () => {
    const { ctx } = await mount({}, { resolvable: GIT_RESOLVABLE, child: { exitCode: 2, stdout: 'out', stderr: 'boom' } })
    const result = await call(ctx, { command: 'false' })
    expect(result.failed).toBe(true)
    expect(result.text).toContain('out\nboom')
    await ctx.fiber.dispose()
  })

  it('reports a silent success by its exit code', async () => {
    const { ctx } = await mount({}, { resolvable: GIT_RESOLVABLE, child: { exitCode: 0 } })
    expect(await call(ctx, { command: 'true' })).toEqual({ text: 'exit code: 0 (no output)', failed: false })
    await ctx.fiber.dispose()
  })

  it('tolerates an unreadable collected stream', async () => {
    const { ctx } = await mount({}, { resolvable: GIT_RESOLVABLE, child: { exitCode: 0, unreadable: true } })
    expect(await call(ctx, { command: 'true' })).toEqual({ text: 'exit code: 0 (no output)', failed: false })
    await ctx.fiber.dispose()
  })

  it('surfaces a spawn failure', async () => {
    const { ctx } = await mount({}, { resolvable: GIT_RESOLVABLE, child: { spawnError: new Error('EPERM') } })
    expect((await call(ctx, { command: 'true' })).failed).toBe(true)
    await ctx.fiber.dispose()
  })

  it('runs nothing for a malformed command argument', async () => {
    const { ctx, fs } = await mount()
    await call(ctx, { command: 42 })
    expect(fs.spawns[0]?.argv).toEqual([GIT_BASH, '-c', ''])
    await ctx.fiber.dispose()
  })

  it('removes the tool when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess, { resolvable: GIT_RESOLVABLE })
    const fiber = await ctx.plugin(bashWindows, {})
    expect(ctx.tools.schemas().some(s => s.name === 'bash')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'bash')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('rejects an unknown config key at mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess, { resolvable: GIT_RESOLVABLE })
    await expect(bashWindows.apply(ctx, { nope: true } as never)).rejects.toThrow(/unknown config key/)
    await ctx.fiber.dispose()
  })
})
