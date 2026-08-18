/**
 * 飞书桥接进程。
 *
 * 常驻，独立于 dsh。职责三件：
 *
 * 1. 当**唯一**的飞书事件消费者（一个 event key 只允许一个消费者，已实测）。
 * 2. 在本地 socket 上等 dsh 插件连进来，把过了准入的消息转给它。
 * 3. dsh 不在时自己回执，并把 dsh 拉起来。
 *
 * **socket 连着就等于 dsh 活着**，所以这里没有心跳文件、没有 pid 探活、没有
 * 过期阈值。一个跑了很久的回合会把 dsh 的事件循环占住，但 socket 照样连着，
 * 那正是"不该接管"的情形，用连接状态判断天然就对。
 *
 * 只依赖 node 内置和 lark-cli 子进程，**不 import 任何 dsh 包**——桥接能当兜底
 * 的前提就是它不跟着 dsh 一起崩。这条一旦破例，兜底就不成立了。
 *
 * 运行：`node --import tsx/esm bridge/main.ts`
 *
 * @module @personal/dsh-x-feishu/bridge/main
 */

import { createServer, type Server, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { get as httpGet } from 'node:http'
import {
  FrameDecoder, PROTOCOL_VERSION, defaultEndpoint, encodeFrame,
  type Ack, type OutboundCommand,
} from '../src/protocol.ts'
import {
  DEFAULT_POLICY, MessageDedup, admit, cardActionValue,
  type AccessPolicy, type LarkCardActionEvent, type LarkMessageEvent,
} from '../src/lark-events.ts'
import { EventConsumer } from './consumer.ts'
import { approvalCard, messageIdOf, patchCard, progressCard, replyMessage, sendMessage, resolveBotOpenId } from './lark.ts'

/** 桥接配置。 */
interface BridgeConfig {
  readonly endpoint: string
  readonly policy: AccessPolicy
  /** 机器人 open_id；留空则启动时向飞书问一次。 */
  readonly botOpenId: string
  /** 探这个地址判断 dsh 在不在，与桌面壳同一套。 */
  readonly probeOrigin: string
  /** dsh 不在时用什么命令拉起来。 */
  readonly launch: { readonly command: string; readonly args: readonly string[]; readonly cwd?: string }
}

const CONFIG_PATH = join(homedir(), '.dsh-x-feishu', 'config.json')

const DEFAULT_CONFIG: BridgeConfig = {
  endpoint: defaultEndpoint(),
  policy: DEFAULT_POLICY,
  botOpenId: '',
  probeOrigin: 'http://127.0.0.1:13080',
  launch: { command: 'pnpm', args: ['dsh', 'web'] },
}

function log(message: string): void {
  process.stdout.write(`[feishu-bridge] ${new Date().toISOString()} ${message}\n`)
}

async function loadConfig(): Promise<BridgeConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CONFIG
    const record = parsed as Partial<BridgeConfig>
    return {
      ...DEFAULT_CONFIG,
      ...record,
      policy: { ...DEFAULT_POLICY, ...(record.policy ?? {}) },
      launch: { ...DEFAULT_CONFIG.launch, ...(record.launch ?? {}) },
    }
  } catch {
    log(`没读到 ${CONFIG_PATH}，用默认配置（默认拒绝，谁都用不了，先去填名单）`)
    return DEFAULT_CONFIG
  }
}

/** 探 dsh 在不在。桌面壳判断"要不要自己拉运行时"用的是同一套。 */
function probeDsh(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpGet(origin, { timeout: 1500 }, (response) => {
      response.resume()
      resolve((response.statusCode ?? 500) < 500)
    })
    request.on('error', () => { resolve(false) })
    request.on('timeout', () => { request.destroy(); resolve(false) })
  })
}

/** 桥接主体。 */
class Bridge {
  private client: Socket | undefined
  private decoder = new FrameDecoder()
  private server: Server | undefined
  private readonly dedup = new MessageDedup()
  /** 插件给的 cardId → 飞书 message_id。 */
  private readonly cards = new Map<string, string>()
  /** cardId → 它属于哪个会话，收尾时要用。 */
  private readonly cardTitles = new Map<string, string>()
  private botOpenId = ''
  private launching = false
  /** chatKey → chatId，回消息要用。 */
  private readonly chats = new Map<string, string>()

  constructor(private readonly config: BridgeConfig) {}

  async start(): Promise<void> {
    this.botOpenId = this.config.botOpenId !== ''
      ? this.config.botOpenId
      : (await resolveBotOpenId()) ?? ''
    if (this.botOpenId === '') {
      log('取不到机器人 open_id，群里的 @ 判定会全部落空。在 config.json 里填 botOpenId')
    } else {
      log(`机器人身份 ${this.botOpenId}`)
    }

    this.server = createServer((socket) => { this.attach(socket) })
    this.server.on('error', (error: Error) => { log(`socket 服务端出错：${error.message}`) })
    this.server.listen(this.config.endpoint, () => {
      log(`在 ${this.config.endpoint} 上等 dsh 插件连进来`)
    })

    const handlers = {
      onDiagnostic: (line: string) => { log(`lark-cli: ${line}`) },
      onExit: (code: number | null, wait: number) => {
        log(`消费者退出（code=${String(code)}），${wait}ms 后重启`)
      },
    }
    new EventConsumer('im.message.receive_v1', {
      ...handlers,
      onEvent: (event: unknown) => { void this.onMessageEvent(event as LarkMessageEvent) },
    }).start()
    new EventConsumer('card.action.trigger', {
      ...handlers,
      onEvent: (event: unknown) => { this.onCardActionEvent(event as LarkCardActionEvent) },
    }).start()
  }

  /** dsh 插件连上来了。只认一个客户端，第二个连接把前一个顶掉。 */
  private attach(socket: Socket): void {
    if (this.client !== undefined) {
      log('又来一个客户端，顶掉旧的')
      this.client.destroy()
    }
    this.client = socket
    this.decoder = new FrameDecoder()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      for (const frame of this.decoder.push(chunk)) void this.onCommand(frame)
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      if (this.client === socket) this.client = undefined
      log('dsh 断开了')
    })
    socket.write(encodeFrame({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: this.botOpenId }))
    log('dsh 连上了')
  }

  private get dshOnline(): boolean {
    return this.client !== undefined && !this.client.destroyed
  }

  private send(frame: unknown): void {
    if (!this.dshOnline) return
    this.client?.write(encodeFrame(frame))
  }

  private async onMessageEvent(event: LarkMessageEvent): Promise<void> {
    const verdict = admit(event, this.config.policy, this.botOpenId)
    if (!verdict.ok) {
      // 不够格的消息根本不该穿过 socket 进到 dsh 里去建会话。
      if (verdict.reason !== 'from-bot' && verdict.reason !== 'not-a-message') {
        log(`挡下一条消息：${verdict.reason}`)
      }
      return
    }
    const message = verdict.message
    // 去重键是 message_id 不是 event_id，schema 里专门写了这一句。
    if (!this.dedup.admit(message.messageId)) {
      log(`重投的消息，跳过：${message.messageId}`)
      return
    }
    this.chats.set(message.chatKey, message.chatId)

    if (this.dshOnline) {
      this.send({ v: PROTOCOL_VERSION, kind: 'message', ...message })
      return
    }
    // dsh 不在：自己回执，然后把它拉起来。不在桥接里跑 agent。
    await replyMessage(message.messageId, 'text', { text: 'dsh 现在不在，我去把它拉起来，起来后你再说一次。' })
    void this.launchDsh()
  }

  private onCardActionEvent(event: LarkCardActionEvent): void {
    const chatId = event.chat_id ?? ''
    const messageId = event.message_id ?? ''
    if (messageId === '') return
    this.send({
      v: PROTOCOL_VERSION,
      kind: 'card-action',
      chatKey: chatId,
      messageId,
      operatorId: event.operator_id ?? '',
      value: cardActionValue(event),
    })
  }

  private async launchDsh(): Promise<void> {
    if (this.launching) return
    this.launching = true
    try {
      // 先探再拉：dsh 可能活着但插件还没挂上来，这时候再起一个就是两个实例。
      if (await probeDsh(this.config.probeOrigin)) {
        log('dsh 在服务，只是插件还没连上，不重复拉起')
        return
      }
      const { command, args, cwd } = this.config.launch
      log(`拉起 dsh：${command} ${args.join(' ')}`)
      const child = spawn(command, [...args], { cwd, detached: true, stdio: 'ignore', shell: process.platform === 'win32' })
      child.unref()
    } catch (error: unknown) {
      log(`拉不起来：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      // 给它一点时间起来，免得连着拉好几个。
      setTimeout(() => { this.launching = false }, 30_000).unref()
    }
  }

  private ack(id: string, ok: boolean, extra: Partial<Ack> = {}): void {
    this.send({ v: PROTOCOL_VERSION, kind: 'ack', replyTo: id, ok, ...extra })
  }

  private async onCommand(frame: unknown): Promise<void> {
    if (typeof frame !== 'object' || frame === null) return
    const command = frame as OutboundCommand
    switch (command.kind) {
      case 'reply': {
        const chatId = this.chats.get(command.chatKey) ?? command.chatKey
        const payload = { text: command.text }
        const result = command.replyTo !== undefined
          ? await replyMessage(command.replyTo, 'text', payload)
          : await sendMessage(chatId, 'text', payload)
        if (!result.ok) log(`回消息失败：${result.error ?? ''}`)
        return
      }
      case 'card.open': {
        const chatId = this.chats.get(command.chatKey) ?? command.chatKey
        const card = progressCard(command.title, '开始', command.text, command.stoppable ? { chatKey: command.chatKey } : undefined)
        const result = command.replyTo !== undefined
          ? await replyMessage(command.replyTo, 'interactive', card)
          : await sendMessage(chatId, 'interactive', card)
        const messageId = messageIdOf(result)
        if (!result.ok || messageId === undefined) {
          this.ack(command.id, false, { error: result.error ?? '发卡片没拿到 message_id' })
          return
        }
        this.cards.set(command.id, messageId)
        this.cardTitles.set(command.id, command.title)
        this.ack(command.id, true, { cardId: command.id })
        return
      }
      case 'card.update': {
        const messageId = this.cards.get(command.cardId)
        if (messageId === undefined) return
        const title = this.cardTitles.get(command.cardId) ?? '正在处理'
        const result = await patchCard(messageId, progressCard(title, command.stage, command.text))
        if (!result.ok) log(`更新卡片失败：${result.error ?? ''}`)
        return
      }
      case 'card.close': {
        const messageId = this.cards.get(command.cardId)
        if (messageId === undefined) return
        const title = this.cardTitles.get(command.cardId) ?? '已完成'
        const stage = command.outcome === 'completed' ? '完成' : command.outcome
        const result = await patchCard(messageId, progressCard(title, stage, command.text))
        if (!result.ok) log(`收尾卡片失败：${result.error ?? ''}`)
        this.cards.delete(command.cardId)
        this.cardTitles.delete(command.cardId)
        return
      }
      case 'ask': {
        const chatId = this.chats.get(command.chatKey) ?? command.chatKey
        const result = await sendMessage(chatId, 'interactive', approvalCard(command.askId, command.title, command.detail))
        this.ack(command.id, result.ok, result.ok ? {} : { error: result.error ?? '发审批卡片失败' })
        return
      }
      default:
        return
    }
  }
}

const config = await loadConfig()
const bridge = new Bridge(config)
await bridge.start()
