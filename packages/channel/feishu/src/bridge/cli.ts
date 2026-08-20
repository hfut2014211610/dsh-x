/**
 * 解析 lark-cli 的无 shell 启动方式。
 *
 * Windows 的 npm 全局命令是 `lark-cli.cmd`，`execFile('lark-cli', ...)` 不会解析它。
 * 从 PATH 里的 npm 根目录找到官方 run.js 后交给当前 Node 执行，参数仍按 argv 传递。
 *
 * @module @deepseek-ai/dsh-feishu/bridge/cli
 */

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** 一次可直接传给 spawn/execFile 的调用。 */
export interface CliInvocation {
  readonly file: string
  readonly args: readonly string[]
}

let windowsEntry: string | undefined

function resolveWindowsEntry(): string | undefined {
  if (windowsEntry !== undefined) return windowsEntry
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js')
    if (existsSync(candidate)) {
      windowsEntry = candidate
      return candidate
    }
  }
  return undefined
}

/**
 * 一次调用要覆盖的环境变量。
 *
 * `LARKSUITE_CLI_CONFIG_DIR` 决定这条命令**以哪个飞书应用的身份跑**。同一台机器
 * 上往往还装着别的工具的 profile，环境默认那份多半是它们的——所以每一次出站调用
 * 都显式带上目标目录，一次都不靠环境。
 *
 * 两个 notifier 开关一直开着：它们会往 JSON 输出里塞 `_notice`，而出站调用的
 * 返回值是要解析的。
 * @param configDir - 以哪份 lark-cli profile 的身份跑；空串沿用环境默认。
 * @returns 要覆盖的环境变量。
 */
export function larkCliEnvironment(configDir: string): NodeJS.ProcessEnv {
  const directory = configDir.trim()
  return {
    ...directory === '' ? {} : { LARKSUITE_CLI_CONFIG_DIR: directory },
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  }
}

/**
 * 组一次不经过 shell 的 lark-cli 调用。
 * @param args - 传给 lark-cli 的 argv。
 * @returns 无需 shell 的可执行文件与参数。
 */
export function larkCliInvocation(args: readonly string[]): CliInvocation {
  if (process.platform !== 'win32') return { file: 'lark-cli', args }
  const entry = resolveWindowsEntry()
  return entry === undefined
    ? { file: 'lark-cli.exe', args }
    : { file: process.execPath, args: [entry, ...args] }
}
