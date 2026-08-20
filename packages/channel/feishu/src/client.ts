/**
 * 插件侧的桥接客户端。
 *
 * 插件**不认识 lark-cli**，也不认识飞书 API：它只往这条 socket 上发意图，
 * 剩下的归桥接。这样插件那半边全部可以脱开飞书单测，把这个类换成一个假的
 * 就行。
 *
 * 断线自动重连：桥接是常驻的，dsh 反而可能先起来。连不上不是错误状态，
 * 是"还没连上"，所以退避重试而不是抛。
 *
 * @module @deepseek-ai/dsh-feishu/client
 */

import { createConnection, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  FrameDecoder, PROTOCOL_VERSION, encodeFrame,
  type Ack, type CardActionFrame, type HelloFrame, type InboundFrame, type MessageFrame,
  type RequestableCommand, type SendableCommand,
} from './protocol.ts'

/** 收到桥接推来的东西时的回调。 */
export interface BridgeHandlers {
  /** 一条进来的消息（准入已经在桥接侧过掉了）。 */
  onMessage(frame: MessageFrame): void
  /** 卡片按钮被点了。 */
  onCardAction(frame: CardActionFrame): void
  /** 握手完成。会来不止一次：报过身份之后桥接会再发一帧带上正确的机器人。 */
  onReady(hello: HelloFrame): void
  /** 连接断了。 */
  onDisconnect(): void
  /** 记一笔，不打断。 */
  onError(error: unknown): void
}

/** 重连退避的上下界。 */
const RETRY_MIN_MS = 500
const RETRY_MAX_MS = 10_000
/** 带 id 的命令等回执的上限。 */
const ACK_TIMEOUT_MS = 15_000

/** 到桥接进程的客户端。 */
export class BridgeClient {
  private socket: Socket | undefined
  private decoder = new FrameDecoder()
  private retryMs = RETRY_MIN_MS
  private retryTimer: NodeJS.Timeout | undefined
  private disposed = false
  private readonly pending = new Map<string, {
    resolve: (ack: Ack) => void
    reject: (error: unknown) => void
    timer: NodeJS.Timeout
  }>()

  /** 上一次真正拨过去的端点，用来认出配置改了。 */
  private dialled: string | undefined

  /**
   * @param endpoint - 读出本地 socket 路径或命名管道；**每次拨号都重新读**，
   * 所以改配置不需要重建这个客户端，下一次连接就用新值。
   * @param handlers - 事件回调。
   */
  constructor(private readonly endpoint: () => string, private readonly handlers: BridgeHandlers) {}

  /** 连上去；断了会自己重连，直到 {@link dispose}。 */
  connect(): void {
    if (this.disposed || this.socket !== undefined) return
    this.dialled = this.endpoint()
    const socket = createConnection(this.dialled)
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('connect', () => { this.retryMs = RETRY_MIN_MS })
    socket.on('data', (chunk: string) => { this.ingest(chunk) })
    socket.on('error', (error: unknown) => { this.handlers.onError(error) })
    socket.on('close', () => { this.teardown() })
  }

  /** 发一条不需要回执的命令。连接不在时静默丢弃——桥接没在，回执也没处送。 */
  send(command: SendableCommand): void {
    const socket = this.socket
    if (socket === undefined || socket.destroyed) return
    socket.write(encodeFrame({ ...command, v: PROTOCOL_VERSION }))
  }

  /**
   * 发一条需要回执的命令（`card.open` / `ask`）。
   * @param command - 命令，`id` 由本方法生成。
   * @returns 桥接的回执。
   */
  request(command: RequestableCommand): Promise<Ack> {
    const socket = this.socket
    if (socket === undefined || socket.destroyed) {
      return Promise.reject(new Error('桥接没连上'))
    }
    const id = randomUUID()
    return new Promise<Ack>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`桥接回执超时：${command.kind}`))
      }, ACK_TIMEOUT_MS)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      socket.write(encodeFrame({ ...command, id, v: PROTOCOL_VERSION }))
    })
  }

  /**
   * 端点变了就重连，没变就不动。
   *
   * 配置里其余的值都是用到才读，唯独端点是拨号那一刻定死的——所以只有它需要
   * 一个显式的动作。已经连在旧地址上的连接必须先断，否则新值要等到下一次意外
   * 断线才会生效。
   * @returns 是否真的重连了。
   */
  redialIfMoved(): boolean {
    // 还没拨过号就无所谓"变了"：第一次 connect() 本来就会读当时的值。
    if (this.disposed || this.dialled === undefined) return false
    if (this.endpoint() === this.dialled) return false
    // teardown() 会照常安排退避重连，所以这里只要把旧连接放掉。
    this.socket?.destroy()
    if (this.socket === undefined) {
      // 本来就没连上：退避定时器还在等旧地址，让它立刻改用新的。
      if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
      this.retryTimer = undefined
      this.retryMs = RETRY_MIN_MS
      this.connect()
    }
    return true
  }

  /** 断开并停止重连。 */
  dispose(): void {
    this.disposed = true
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('客户端已关闭'))
    }
    this.pending.clear()
    this.socket?.destroy()
    this.socket = undefined
  }

  private ingest(chunk: string): void {
    for (const frame of this.decoder.push(chunk)) {
      try {
        this.dispatch(frame)
      } catch (error: unknown) {
        this.handlers.onError(error)
      }
    }
  }

  private dispatch(frame: unknown): void {
    if (typeof frame !== 'object' || frame === null) return
    const record = frame as Record<string, unknown>
    if (record.kind === 'ack') {
      const ack = record as unknown as Ack
      const entry = this.pending.get(ack.replyTo)
      if (entry === undefined) return
      this.pending.delete(ack.replyTo)
      clearTimeout(entry.timer)
      entry.resolve(ack)
      return
    }
    // 版本对不上就别猜，直接当错误报出来。
    if (record.v !== PROTOCOL_VERSION) {
      this.handlers.onError(new Error(`桥接协议版本不一致：收到 ${String(record.v)}，本端 ${PROTOCOL_VERSION}`))
      return
    }
    const inbound = record as unknown as InboundFrame
    switch (inbound.kind) {
      case 'hello':
        this.handlers.onReady(inbound)
        return
      case 'message':
        this.handlers.onMessage(inbound)
        return
      case 'card-action':
        this.handlers.onCardAction(inbound)
        return
      default:
        return
    }
  }

  private teardown(): void {
    this.socket = undefined
    this.decoder = new FrameDecoder()
    this.handlers.onDisconnect()
    if (this.disposed) return
    this.retryTimer = setTimeout(() => { this.connect() }, this.retryMs)
    this.retryTimer.unref()
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS)
  }
}
