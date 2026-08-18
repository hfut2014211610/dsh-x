/**
 * 解析 lark-cli 的无 shell 启动方式。
 *
 * Windows 的 npm 全局命令是 `lark-cli.cmd`，`execFile('lark-cli', ...)` 不会解析它。
 * 从 PATH 里的 npm 根目录找到官方 run.js 后交给当前 Node 执行，参数仍按 argv 传递。
 *
 * @module @personal/dsh-x-feishu/bridge/cli
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
