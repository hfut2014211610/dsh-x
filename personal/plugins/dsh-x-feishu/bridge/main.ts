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
 * 进来的每条事件都记得**是哪个飞书应用收到的**，出去的每一次调用都以那个应用
 * 的身份发。接了两个应用还共用一个出站身份的话，会出现"A 的机器人被 @，B 的
 * 机器人回话"，而卡片只能由发它的那个应用改，连进度都刷不动。
 *
 * 配置不归这里管：`~/.dsh-x-feishu/config.json` 由 dsh 的设置页写出，这边只读、
 * 并且盯着它变（见 `src/bridge-config.ts`）。桥接不向 dsh 要配置，因为它得在
 * dsh 不在的时候顶上——文件在 dsh 挂了以后还在，RPC 不在。
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
import { get as httpGet } from 'node:http'
import {
  FrameDecoder, PROTOCOL_VERSION, encodeFrame,
  type Ack, type BridgeSummary, type OutboundCommand,
} from '../src/protocol.ts'
import {
  MessageDedup, admit, cardActionValue,
  type LarkCardActionEvent, type LarkMessageEvent,
} from '../src/lark-events.ts'
import {
  bridgeConfigPath, readBridgeConfig, watchBridgeConfig,
  type BridgeConfig,
} from '../src/bridge-config.ts'
import { AppRouter } from '../src/app-routing.ts'
import { EventConsumer } from './consumer.ts'
import { larkCliEnvironment } from './cli.ts'
import { approvalCard, messageIdOf, patchCard, progressCard, replyMessage, sendMessage, resolveBotOpenId } from './lark.ts'
import { encodeEventRelayFrame } from './relay.ts'

/** 消息事件的 EventKey。 */
const MESSAGE_EVENT = 'im.message.receive_v1'
/** 卡片回调的 EventKey。 */
const CARD_EVENT = 'card.action.trigger'

/**
 * 等 dsh 的身份定下来再挑它的错。
 *
 * dsh 的连接常常比它的设置早一步就位，所以第一帧报的往往是个占位值，紧接着就
 * 会被改正。不等这一下的话，每次启动都要诬告一次"你报的应用我没订"。
 */
const ANNOUNCE_SETTLE_MS = 1_500

function log(message: string): void {
  process.stdout.write(`[feishu-bridge] ${new Date().toISOString()} ${message}\n`)
}

/** 日志里怎么称呼一个 profile 目录。 */
function label(configDir: string): string {
  return configDir === '' ? '默认应用' : configDir
}

/** 一个消费者的身份：订阅哪个 EventKey、以哪个应用的身份。 */
function consumerKey(eventKey: string, configDir: string): string {
  return `${eventKey} @ ${label(configDir)}`
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
  private eventServer: Server | undefined
  private readonly eventClients = new Set<Socket>()
  private readonly dedup = new MessageDedup()
  /** 每个会话、每张卡片是从哪个飞书应用来的。 */
  private readonly router = new AppRouter(
    // dsh 只收得到自己那个应用的消息，所以认不出来源时，它报的身份就是答案，
    // 不是猜。没报身份才退回主应用。
    () => this.dshApp() ?? this.primaryApp(),
    { onGuess: (chatKey, app) => { log(`不认得会话 ${chatKey} 是从哪个应用进来的，按 ${label(app)} 发`) } },
  )
  /** configDir → 这个应用的机器人 open_id。判"有没有 @ 我"要用。 */
  private readonly botOpenIds = new Map<string, string>()
  /** 现在跑着的消费者，键是 {@link consumerKey}。 */
  private readonly consumers = new Map<string, EventConsumer>()
  private launching = false
  /**
   * dsh 报的身份：它是哪个飞书应用。
   *
   * 报了才转发。没报之前一条都不转——桥接可能同时订着好几个应用，把别人机器人
   * 的消息也塞给 dsh，两个 agent 会抢着答同一句话。
   */
  private clientApp: string | undefined
  /** 等身份定下来再挑错的那个定时器。 */
  private announceSettle: NodeJS.Timeout | undefined
  /** 已经听上的端点。改端点要重启桥接，所以要记住当初听的是哪个。 */
  private listening = { endpoint: '', eventEndpoint: '' }
  private stopWatching: (() => void) | undefined

  constructor(private config: BridgeConfig) {}

  async start(): Promise<void> {
    this.server = createServer((socket) => { this.attach(socket) })
    this.server.on('error', (error: Error) => { log(`socket 服务端出错：${error.message}`) })
    this.server.listen(this.config.endpoint, () => {
      log(`在 ${this.config.endpoint} 上等 dsh 插件连进来`)
    })
    this.eventServer = createServer((socket) => { this.attachEventClient(socket) })
    this.eventServer.on('error', (error: Error) => { log(`事件 relay 出错：${error.message}`) })
    this.eventServer.listen(this.config.eventEndpoint, () => {
      log(`在 ${this.config.eventEndpoint} 上广播飞书事件`)
    })
    this.listening = { endpoint: this.config.endpoint, eventEndpoint: this.config.eventEndpoint }

    this.logPolicy()
    await this.syncConsumers()

    // 设置页保存之后不用重起桥接。端点例外，它已经听上了。
    this.stopWatching = watchBridgeConfig(bridgeConfigPath(), () => { void this.reload() })
  }

  /**
   * 收摊：放掉每个 EventKey 的订阅，停掉文件监听。
   *
   * 要等消费者真的退干净再走。lark-cli 靠关 stdin 才会把**服务端**那份订阅
   * 退掉，桥接先一步 exit 的话，那些子进程在 Windows 上会变成孤儿继续占着，
   * 下一次起桥接就抢不到——一个 EventKey 只允许一个消费者。
   * @returns 每个消费者都退完为止。
   */
  async stop(): Promise<void> {
    if (this.announceSettle !== undefined) clearTimeout(this.announceSettle)
    this.announceSettle = undefined
    this.stopWatching?.()
    this.stopWatching = undefined
    const leaving = [...this.consumers]
    this.consumers.clear()
    await Promise.all(leaving.map(async ([key, consumer]) => {
      await consumer.stop()
      log(`放掉订阅 ${key}`)
    }))
    this.server?.close()
    this.eventServer?.close()
    for (const socket of this.eventClients) socket.destroy()
    this.client?.destroy()
  }

  /** 接哪几个应用的消息。空数组沿用环境默认那份。 */
  private eventSources(): readonly string[] {
    const configured = this.config.eventConfigDirs
    return configured.length === 0 ? [''] : configured
  }

  /** 哪几个应用的卡片回调已经在开发者后台订阅过。空数组表示与消息源相同。 */
  private cardActionSources(): readonly string[] {
    const configured = this.config.cardActionConfigDirs
    return configured.length === 0 ? this.eventSources() : configured
  }

  /** 出站找不到来源时落到哪个应用。第一个消息源，而不是环境默认。 */
  private primaryApp(): string {
    return this.eventSources()[0] ?? ''
  }

  private logPolicy(): void {
    const policy = this.config.policy
    const dm = policy.dmMode === 'open'
      ? '私聊谁都能用'
      : policy.dmMode === 'disabled'
        ? '私聊一律不理'
        : policy.dmAllowlist.length === 0
          ? '私聊只认名单，而名单是空的——现在没有人能私聊它'
          : `私聊只认名单（${policy.dmAllowlist.length} 人）`
    const group = policy.groupAllowlist.length === 0
      ? '群聊一个都没放行'
      : `群聊放行 ${policy.groupAllowlist.length} 个`
    const mention = policy.requireMention ? '，群里必须 @ 到机器人' : ''
    log(`准入：${dm}；${group}${mention}`)
  }

  /**
   * 问出每个应用的机器人 open_id。
   *
   * 一个应用一个机器人，open_id 各不相同。拿 A 的 id 去判 B 的 @，判出来的
   * 永远是"没 @ 我"，那个群就整个哑了。
   */
  private async resolveIdentities(sources: readonly string[]): Promise<void> {
    await Promise.all(sources.map(async (configDir) => {
      const override = this.config.botOpenIds[configDir]
      if (override !== undefined && override !== '') {
        this.botOpenIds.set(configDir, override)
        return
      }
      // 问过一次就不再问：这是一次网络往返，而机器人身份不会变。
      const known = this.botOpenIds.get(configDir)
      if (known !== undefined && known !== '') return
      const resolved = await resolveBotOpenId(configDir)
      if (resolved === undefined || resolved === '') {
        this.botOpenIds.set(configDir, '')
        log(`取不到 ${label(configDir)} 的机器人 open_id，这个应用在群里的 @ 判定会全部落空`)
        return
      }
      this.botOpenIds.set(configDir, resolved)
      log(`机器人身份 ${label(configDir)} → ${resolved}`)
    }))
  }

  /**
   * 让跑着的消费者与配置对齐：多出来的停掉，缺的起来，已经在跑的不动。
   *
   * 不动已经在跑的那些是要紧的：重建一个消费者要先放掉 EventKey 再抢回来，
   * 那个缝里进来的消息谁也收不到。
   */
  private async syncConsumers(): Promise<void> {
    const events = this.eventSources()
    const cards = this.cardActionSources()
    await this.resolveIdentities([...new Set([...events, ...cards])])

    const wanted = new Map<string, { eventKey: string; configDir: string }>()
    for (const configDir of events) wanted.set(consumerKey(MESSAGE_EVENT, configDir), { eventKey: MESSAGE_EVENT, configDir })
    for (const configDir of cards) wanted.set(consumerKey(CARD_EVENT, configDir), { eventKey: CARD_EVENT, configDir })

    for (const [key, consumer] of this.consumers) {
      if (wanted.has(key)) continue
      this.consumers.delete(key)
      // 不等它退完：走的是这个应用整份订阅，没有别人在等这个位置，而等下去
      // 会把新应用的订阅一起拖三秒。
      void consumer.stop().then(() => { log(`不再订阅 ${key}`) })
    }
    for (const [key, spec] of wanted) {
      if (this.consumers.has(key)) continue
      const consumer: EventConsumer = new EventConsumer(spec.eventKey, {
        onDiagnostic: (line: string) => { log(`lark-cli[${label(spec.configDir)}]: ${line}`) },
        onExit: (code: number | null, wait: number) => {
          log(`消费者[${key}]退出（code=${String(code)}），${wait}ms 后重启`)
        },
        onEvent: (event: unknown) => {
          if (spec.eventKey === MESSAGE_EVENT) void this.onMessageEvent(spec.configDir, event as LarkMessageEvent)
          else this.onCardActionEvent(spec.configDir, event as LarkCardActionEvent)
        },
      }, undefined, larkCliEnvironment(spec.configDir))
      consumer.start()
      this.consumers.set(key, consumer)
      log(`开始订阅 ${key}`)
    }
  }

  /** 配置文件动了：能热更的热更，热不了的说清楚。 */
  private async reload(): Promise<void> {
    const read = await readBridgeConfig()
    if (read.problem !== undefined) {
      log(`配置读不了，保持原样：${read.problem}`)
      return
    }
    this.config = read.config
    log('配置更新了')
    this.logPolicy()
    if (read.config.endpoint !== this.listening.endpoint) {
      log(`endpoint 改成了 ${read.config.endpoint}，但桥接已经听在 ${this.listening.endpoint} 上，要重启才换`)
    }
    if (read.config.eventEndpoint !== this.listening.eventEndpoint) {
      log(`eventEndpoint 改成了 ${read.config.eventEndpoint}，同样要重启桥接才换`)
    }
    await this.syncConsumers()
    // dsh 手里那份现状是握手那一刻的，配置一变它就过期了。设置页照着过期的
    // 名单说"桥接没订你这个应用"，人会去改一个本来没错的地方。
    if (this.dshOnline) this.greet(this.dshApp() ?? this.primaryApp())
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
      // 只放掉连接，不忘掉身份：dsh 不在的时候，桥接正需要知道哪条消息本该是
      // 它的——那条路上要替它回一句、再把它拉起来。下一个客户端报的身份会覆盖。
      if (this.client === socket) this.client = undefined
      log('dsh 断开了')
    })
    // 这一帧发在 dsh 开口之前，所以只能先给主应用的机器人；等它报了身份，
    // 下面 onAnnounce 会再发一帧带上真正属于它的那个。
    this.greet(this.primaryApp())
    log('dsh 连上了')
  }

  /** 把桥接现在的样子告诉 dsh。复用时这些都不归它改，只给它看。 */
  private summary(): BridgeSummary {
    const policy = this.config.policy
    return {
      apps: this.eventSources(),
      dmMode: policy.dmMode,
      dmAllowed: policy.dmAllowlist.length,
      groupsAllowed: policy.groupAllowlist.length,
      requireMention: policy.requireMention,
    }
  }

  private greet(configDir: string): void {
    this.client?.write(encodeFrame({
      v: PROTOCOL_VERSION,
      kind: 'hello',
      botOpenId: this.botOpenIds.get(configDir) ?? '',
      bridge: this.summary(),
    }))
  }

  /**
   * dsh 说它是哪个应用。
   *
   * 报了才开始转发。报了一个没订阅的应用要说出来——那种情况下 dsh 会一条消息
   * 都收不到，而它自己看不出区别。
   */
  private onAnnounce(configDir: string): void {
    const declared = configDir.trim()
    if (declared === '') {
      this.clientApp = undefined
      log('dsh 还没说自己是哪个应用，先不给它转消息')
      return
    }
    this.clientApp = declared
    log(`dsh 的身份是 ${label(declared)}`)
    this.greet(declared)
    if (this.announceSettle !== undefined) clearTimeout(this.announceSettle)
    this.announceSettle = setTimeout(() => {
      const app = this.clientApp
      if (app === undefined || this.eventSources().includes(app)) return
      log(`桥接没订 ${label(app)}（订的是 ${this.eventSources().map(label).join('、')}），dsh 收不到任何消息`)
    }, ANNOUNCE_SETTLE_MS)
    this.announceSettle.unref()
  }

  /**
   * dsh 是哪个应用。
   *
   * 优先用它自己报的。它还没连过的时候退一步：只订了一个应用的话那就是它——
   * 单应用部署里桥接本来就是 dsh 的。订了好几个就认不出来，这时宁可不认，也
   * 不能猜——猜错的后果是替别人的机器人回一句"dsh 不在"。
   * @returns dsh 的 profile 目录；认不出来时 `undefined`。
   */
  private dshApp(): string | undefined {
    if (this.clientApp !== undefined) return this.clientApp
    const sources = this.eventSources()
    return sources.length === 1 ? sources[0] : undefined
  }

  private get dshOnline(): boolean {
    return this.client !== undefined && !this.client.destroyed
  }

  private attachEventClient(socket: Socket): void {
    this.eventClients.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => {
      this.eventClients.delete(socket)
      log('事件 relay 客户端断开')
    })
    log('事件 relay 客户端连上')
  }

  private relayEvent(configDir: string, event: unknown): void {
    const frame = encodeEventRelayFrame(event, configDir)
    for (const socket of this.eventClients) {
      if (!socket.destroyed) socket.write(frame)
    }
  }

  private send(frame: unknown): void {
    if (!this.dshOnline) return
    this.client?.write(encodeFrame(frame))
  }

  private async onMessageEvent(configDir: string, event: LarkMessageEvent): Promise<void> {
    this.relayEvent(configDir, event)
    const botOpenId = this.botOpenIds.get(configDir) ?? ''
    const verdict = admit(event, this.config.policy, botOpenId)
    if (!verdict.ok) {
      // 不够格的消息根本不该穿过 socket 进到 dsh 里去建会话。
      if (verdict.reason !== 'from-bot' && verdict.reason !== 'not-a-message') {
        log(`挡下一条消息[${label(configDir)}]：${verdict.reason}`)
      }
      return
    }
    const message = verdict.message
    // 去重键是 message_id 不是 event_id，schema 里专门写了这一句。
    if (!this.dedup.admit(message.messageId)) {
      log(`重投的消息，跳过：${message.messageId}`)
      return
    }
    this.router.rememberChat(message.chatKey, message.chatId, configDir)

    // 只管 dsh 那个应用的消息。别人机器人的消息归别人（他们连 relay），dsh
    // 插手的话，一句话会被两个 agent 同时答。
    if (this.dshApp() !== configDir) return
    if (this.dshOnline) {
      this.send({ v: PROTOCOL_VERSION, kind: 'message', ...message })
      return
    }
    // dsh 不在：自己回执，然后把它拉起来。不在桥接里跑 agent。
    await replyMessage(configDir, message.messageId, 'text', {
      text: 'dsh 现在不在，我去把它拉起来，起来后你再说一次。',
    })
    void this.launchDsh()
  }

  private onCardActionEvent(configDir: string, event: LarkCardActionEvent): void {
    this.relayEvent(configDir, event)
    const chatId = event.chat_id ?? ''
    const messageId = event.message_id ?? ''
    if (messageId === '') return
    if (this.dshApp() !== configDir) return
    // 点按钮的这个会话可能是桥接重启后第一次见到，记下它属于哪个应用。
    if (chatId !== '') this.router.rememberChat(chatId, chatId, configDir)
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
      case 'announce': {
        this.onAnnounce(command.configDir)
        return
      }
      case 'reply': {
        const app = this.router.appOfChat(command.chatKey)
        const chatId = this.router.chatId(command.chatKey)
        const payload = { text: command.text }
        const result = command.replyTo !== undefined
          ? await replyMessage(app, command.replyTo, 'text', payload)
          : await sendMessage(app, chatId, 'text', payload)
        if (!result.ok) log(`回消息失败：${result.error ?? ''}`)
        return
      }
      case 'card.open': {
        const app = this.router.appOfChat(command.chatKey)
        const chatId = this.router.chatId(command.chatKey)
        const card = progressCard(command.title, '开始', command.text, command.stoppable ? { chatKey: command.chatKey } : undefined)
        const result = command.replyTo !== undefined
          ? await replyMessage(app, command.replyTo, 'interactive', card)
          : await sendMessage(app, chatId, 'interactive', card)
        const messageId = messageIdOf(result)
        if (!result.ok || messageId === undefined) {
          this.ack(command.id, false, { error: result.error ?? '发卡片没拿到 message_id' })
          return
        }
        this.router.rememberCard(command.id, { messageId, title: command.title, configDir: app })
        this.ack(command.id, true, { cardId: command.id })
        return
      }
      case 'card.update': {
        const card = this.router.card(command.cardId)
        if (card === undefined) return
        const result = await patchCard(card.configDir, card.messageId, progressCard(card.title, command.stage, command.text))
        if (!result.ok) log(`更新卡片失败：${result.error ?? ''}`)
        return
      }
      case 'card.close': {
        const card = this.router.card(command.cardId)
        if (card === undefined) return
        const stage = command.outcome === 'completed' ? '完成' : command.outcome
        const result = await patchCard(card.configDir, card.messageId, progressCard(card.title, stage, command.text))
        if (!result.ok) log(`收尾卡片失败：${result.error ?? ''}`)
        this.router.forgetCard(command.cardId)
        return
      }
      case 'ask': {
        const app = this.router.appOfChat(command.chatKey)
        const chatId = this.router.chatId(command.chatKey)
        const result = await sendMessage(app, chatId, 'interactive', approvalCard(command.askId, command.title, command.detail))
        this.ack(command.id, result.ok, result.ok ? {} : { error: result.error ?? '发审批卡片失败' })
        return
      }
      default:
        return
    }
  }
}

const read = await readBridgeConfig()
if (read.problem !== undefined) {
  log(`${read.problem}，先按默认配置跑（默认拒绝，谁都用不了）。去 dsh 的「设置 → 连接器 → 飞书」填一份。`)
}
const bridge = new Bridge(read.config)
await bridge.start()

// Ctrl+C 或者被 kill 掉时把订阅放干净，否则下一次起桥接会抢不到 EventKey。
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`收到 ${signal}，收摊`)
    void bridge.stop().then(() => { process.exit(0) })
  })
}
