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

/** 关掉 stdin 之后等 lark-cli 自己退的时长，超了才动手杀。 */
const STOP_GRACE_MS = 3_000

/** 消费者的回调。 */
export interface ConsumerHandlers {
  /** 收到一条事件（已经 JSON.parse 过）。 */
  onEvent(event: unknown): void
  /** lark-cli 写到 stderr 的东西：就绪标记、丢事件告警、错误。 */
  onDiagnostic(line: string): void
  /** 子进程退出了，即将重启。 */
  onExit(code: number | null, restartInMs: number): void
  /**
   * 刚 spawn 出一个子进程。
   *
   * 每次重启都会再报一次：pid 变了，桥接留给下次启动的那张字条就得跟着变，
   * 否则记的是一个已经不存在的进程。
   */
  onSpawn?(pid: number): void
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
   * @param command - 替代 `lark-cli` 的可执行名；不给就走 lark-cli 自己。
   *   别的进程已经独占了那个 EventKey 时用它把事件引过来——一个 EventKey 只
   *   允许一个消费者，抢不过就只能接一根管子。参数照旧追加在后面。
   */
  constructor(
    private readonly eventKey: string,
    private readonly handlers: ConsumerHandlers,
    private readonly command?: string,
    /** 可选的进程环境。用于让同一桥接进程分别持有不同飞书应用的唯一订阅。 */
    private readonly environment?: NodeJS.ProcessEnv,
  ) {}

  /** 起消费者；子进程退出会自动重启，直到 {@link stop}。 */
  start(): void {
    if (this.stopped || this.child !== undefined) return
    const extra = this.environment === undefined ? {} : { env: { ...process.env, ...this.environment } }
    let child: ChildProcessByStdio<Writable, Readable, Readable>
    if (this.command === undefined) {
      const invocation = larkCliInvocation(['event', 'consume', this.eventKey, '--as', 'bot'])
      child = spawn(invocation.file, [...invocation.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...extra,
      })
    } else {
      // 换了来源就整条命令交给 shell 跑，事件键追加在最后：填进来的是一行命令，
      // 里面本来就可能带参数和引号，按空格拆会把带空格的路径拆坏。
      child = spawn(`${this.command} ${this.eventKey}`, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
        ...extra,
      })
    }
    this.child = child
    // pid 在 spawn 失败时是 undefined；那种情况没有东西要回收。
    if (child.pid !== undefined) this.handlers.onSpawn?.(child.pid)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { this.ingestStdout(chunk) })
    child.stderr.on('data', (chunk: string) => { this.ingestStderr(chunk) })
    child.on('error', (error: Error) => { this.handlers.onDiagnostic(`spawn 失败：${error.message}`) })
    child.on('exit', (code: number | null) => { this.handleExit(code) })
  }

  /**
   * 停掉消费者并放弃重启。
   *
   * 关 stdin 是 lark-cli 认的那条正常收尾路径，它会把**服务端**那份订阅退掉。
   * 直接杀进程走不到这一步，订阅会留在服务端，下一次起来就抢不回来——lark-cli
   * 自己在 stderr 里也警告了这一点。所以这里先关 stdin，等它自己走；实在不走
   * 才动手，那是两害相权。
   * @returns 子进程退干净、或者等到超时为止。
   */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.child
    this.child = undefined
    if (child === undefined) return
    await new Promise<void>((resolve) => {
      const forced = setTimeout(() => {
        child.kill()
        resolve()
      }, STOP_GRACE_MS)
      forced.unref()
      child.once('exit', () => {
        clearTimeout(forced)
        resolve()
      })
      child.stdin.end()
    })
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
