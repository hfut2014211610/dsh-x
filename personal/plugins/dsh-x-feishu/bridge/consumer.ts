/**
 * 飞书事件消费者：spawn `lark-cli event consume`，把 stdout 的 NDJSON 变成事件。
 *
 * **一个 event key 只允许一个消费者**（已实测确认），所以整个部署里只有桥接
 * 进程跑这个类。dsh 插件永远不碰它——这正是把桥接做成独立常驻进程的原因。
 *
 * 不加 `--quiet`：技能里写明那个开关会把丢事件的告警一起藏掉。宁可日志吵，
 * 也不要静悄悄地漏消息。
 *
 * @module @personal/dsh-x-feishu/bridge/consumer
 */

import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { larkCliInvocation } from './cli.ts'

/** 重启退避的上下界。 */
const RESTART_MIN_MS = 1_000
const RESTART_MAX_MS = 30_000

/** 消费者的回调。 */
export interface ConsumerHandlers {
  /** 收到一条事件（已经 JSON.parse 过）。 */
  onEvent(event: unknown): void
  /** lark-cli 写到 stderr 的东西：就绪标记、丢事件告警、错误。 */
  onDiagnostic(line: string): void
  /** 子进程退出了，即将重启。 */
  onExit(code: number | null, restartInMs: number): void
}

/**
 * 一个 event key 的常驻消费者。
 */
export class EventConsumer {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | undefined
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private restartMs = RESTART_MIN_MS
  private restartTimer: NodeJS.Timeout | undefined
  private stopped = false

  /**
   * @param eventKey - 要订阅的 EventKey，例如 `im.message.receive_v1`。
   * @param handlers - 回调。
   * @param command - lark-cli 的可执行名，测试可以换成假的。
   */
  constructor(
    private readonly eventKey: string,
    private readonly handlers: ConsumerHandlers,
    private readonly command?: string,
  ) {}

  /** 起消费者；子进程退出会自动重启，直到 {@link stop}。 */
  start(): void {
    if (this.stopped || this.child !== undefined) return
    const args = ['event', 'consume', this.eventKey, '--as', 'bot']
    const invocation = this.command === undefined
      ? larkCliInvocation(args)
      : { file: this.command, args }
    const child = spawn(invocation.file, [...invocation.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { this.ingestStdout(chunk) })
    child.stderr.on('data', (chunk: string) => { this.ingestStderr(chunk) })
    child.on('error', (error: Error) => { this.handlers.onDiagnostic(`spawn 失败：${error.message}`) })
    child.on('exit', (code: number | null) => { this.handleExit(code) })
  }

  /** 停掉消费者并放弃重启。 */
  stop(): void {
    this.stopped = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    this.child?.stdin.end()
    this.child = undefined
  }

  private ingestStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let index = this.stdoutBuffer.indexOf('\n')
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (line !== '') {
        try {
          this.handlers.onEvent(JSON.parse(line))
        } catch {
          // 坏行不该把消费者带停，但要让人看见。
          this.handlers.onDiagnostic(`解析不了的事件行：${line.slice(0, 200)}`)
        }
      }
      index = this.stdoutBuffer.indexOf('\n')
    }
  }

  private ingestStderr(chunk: string): void {
    this.stderrBuffer += chunk
    let index = this.stderrBuffer.indexOf('\n')
    while (index >= 0) {
      const line = this.stderrBuffer.slice(0, index).trim()
      this.stderrBuffer = this.stderrBuffer.slice(index + 1)
      if (line !== '') this.handlers.onDiagnostic(line)
      index = this.stderrBuffer.indexOf('\n')
    }
  }

  private handleExit(code: number | null): void {
    this.child = undefined
    if (this.stopped) return
    const wait = this.restartMs
    this.handlers.onExit(code, wait)
    this.restartTimer = setTimeout(() => { this.start() }, wait)
    this.restartTimer.unref()
    this.restartMs = Math.min(this.restartMs * 2, RESTART_MAX_MS)
    // 跑满一分钟没退过就认为稳住了，把退避收回来。
    setTimeout(() => { if (this.child !== undefined) this.restartMs = RESTART_MIN_MS }, 60_000).unref()
  }
}
