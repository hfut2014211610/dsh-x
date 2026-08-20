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
 * @module @deepseek-ai/dsh-feishu/bridge/main
 */

import { createServer, type Server, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { get as httpGet } from 'node:http'
import {
  FrameDecoder, PROTOCOL_VERSION, encodeFrame,
  type Ack, type BridgeSummary, type OutboundCommand,
} from '../protocol.ts'
import {
  MessageDedup, admit, cardActionValue,
  type LarkCardActionEvent, type LarkMessageEvent,
} from '../lark-events.ts'
import {
  bridgeConfigPath, ownedConsumersPath, readBridgeConfig, watchBridgeConfig,
  type BridgeConfig,
} from '../bridge-config.ts'
import { AppRouter } from '../app-routing.ts'
import { EventConsumer } from './consumer.ts'
import {
  clearOwnedConsumers, processAlive, readCommandLine, readOwnedConsumers,
  reapOwnedConsumers, writeOwnedConsumers,
} from './owned-consumers.ts'
import { larkCliEnvironment } from './cli.ts'
import { approvalCard, messageIdOf, patchCard, progressCard, replyMessage, sendMessage, resolveBotOpenId } from './lark.ts'
import { encodeEventRelayFrame } from './relay.ts'

/** 消息事件的 EventKey。 */
const MESSAGE_EVENT = 'im.message.receive_v1'
/** 卡片回调的 EventKey。 */
const CARD_EVENT = 'card.action.trigger'

function log(message: string): void {
  process.stdout.write(`[feishu-bridge] ${new Date().toISOString()} ${message}\n`)
}

/** 日志里怎么称呼一个 profile 目录。 */
function label(configDir: string): string {
  return configDir === '' ? '默认应用' : configDir
}

/**
 * 一个消费者的身份：订阅哪个 EventKey、以哪个应用的身份、事件从哪来。
 *
 * 事件来源也算身份的一部分，否则改了 `eventCommand` 对**已经在跑**的消费者
 * 毫无影响——名字没变，对齐那一步就认为它还是那一个，于是继续跑老的来源，
 * 而页面上写着新的。
 */
function consumerKey(eventKey: string, configDir: string, command: string): string {
  return command === ''
    ? `${eventKey} @ ${label(configDir)}`
    : `${eventKey} @ ${label(configDir)} ← ${command}`
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
    () => this.primaryApp(),
    { onGuess: (chatKey, app) => { log(`不认得会话 ${chatKey} 是从哪个应用进来的，按 ${label(app)} 发`) } },
  )
  /** configDir → 这个应用的机器人 open_id。判"有没有 @ 我"要用。 */
  private readonly botOpenIds = new Map<string, string>()
  /** 现在跑着的消费者，键是 {@link consumerKey}。 */
  private readonly consumers = new Map<string, EventConsumer>()
  /** 每个消费者当前子进程的 pid 与它认领的 EventKey，留给下次启动回收。 */
  private readonly ownedPids = new Map<string, { pid: number; eventKey: string }>()
  private launching = false
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
    // 先收上一次没来得及停掉的消费者，再起自己的：一个 EventKey 只允许一个
    // 消费者，孤儿还占着的话，下面这批全部抢不到。
    for (const line of await reapOwnedConsumers({
      readRecords: () => readOwnedConsumers(ownedConsumersPath()),
      clearRecords: () => clearOwnedConsumers(ownedConsumersPath()),
      alive: processAlive,
      commandLine: readCommandLine,
      kill: (pid) => { try { process.kill(pid) } catch { /* 刚好在这一刻退了 */ } },
    })) log(line)
    await this.syncConsumers()

    // 设置页保存之后不用重起桥接。端点例外，它已经听上了。
    this.stopWatching = watchBridgeConfig(bridgeConfigPath(), () => { void this.reload() })
  }

  /** 把当前拥有的消费者写成字条，覆盖上一份。 */
  private async recordOwned(): Promise<void> {
    try {
      await writeOwnedConsumers(ownedConsumersPath(), [...this.ownedPids.values()])
    } catch (error) {
      // 写不成字条不该让桥接停下来：代价只是下次启动回收不到，而那本来就是
      // 兜底路径。
      log(`记不下消费者 pid：${error instanceof Error ? error.message : String(error)}`)
    }
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
    this.stopWatching?.()
    this.stopWatching = undefined
    const leaving = [...this.consumers]
    this.consumers.clear()
    await Promise.all(leaving.map(async ([key, consumer]) => {
      await consumer.stop()
      log(`放掉订阅 ${key}`)
    }))
    // 每个消费者都干净地退了，字条就没有意义了——留着只会让下次启动去检查一
    // 批早已不存在的 pid。
    this.ownedPids.clear()
    await clearOwnedConsumers(ownedConsumersPath())
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

    const command = this.config.eventCommand.trim()
    const wanted = new Map<string, { eventKey: string; configDir: string }>()
    for (const configDir of events) {
      wanted.set(consumerKey(MESSAGE_EVENT, configDir, command), { eventKey: MESSAGE_EVENT, configDir })
    }
    for (const configDir of cards) {
      wanted.set(consumerKey(CARD_EVENT, configDir, command), { eventKey: CARD_EVENT, configDir })
    }

    for (const [key, consumer] of this.consumers) {
      if (wanted.has(key)) continue
      this.consumers.delete(key)
      this.ownedPids.delete(key)
      // 不等它退完：走的是这个应用整份订阅，没有别人在等这个位置，而等下去
      // 会把新应用的订阅一起拖三秒。
      void consumer.stop().then(() => { void this.recordOwned(); log(`不再订阅 ${key}`) })
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
        // 每次重启都会再来一次，pid 变了字条就得跟着变。
        onSpawn: (pid: number) => {
          this.ownedPids.set(key, { pid, eventKey: spec.eventKey })
          void this.recordOwned()
        },
      }, command === '' ? undefined : command, larkCliEnvironment(spec.configDir))
      consumer.start()
      this.consumers.set(key, consumer)
      log(command === '' ? `开始订阅 ${key}` : `开始订阅 ${key}（事件来自 ${command}）`)
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
    if (this.dshOnline) this.greet(this.primaryApp())
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

    // 过了准入的消息一律转给 dsh：它是这条 socket 上唯一的消费者，桥接订了
    // 什么就给它什么。要缩范围就去改订阅名单——那是跑桥接的人的事。
    if (this.dshOnline) {
      this.send({ v: PROTOCOL_VERSION, kind: 'message', source: configDir, ...message })
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
    // 点按钮的这个会话可能是桥接重启后第一次见到，记下它属于哪个应用。
    if (chatId !== '') this.router.rememberChat(chatId, chatId, configDir)
    this.send({
      v: PROTOCOL_VERSION,
      kind: 'card-action',
      source: configDir,
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
