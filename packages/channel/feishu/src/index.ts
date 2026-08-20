/**
 * 飞书通道插件：把飞书的单聊与群聊接到 dsh 会话上。
 *
 * 这一半跑在 dsh 的 web profile 进程内，负责的是 dsh 那边的事——建会话、提交
 * 消息、渲染事件、答工具审批。飞书那边的事（长连接、凭证、发消息）全部归
 * 常驻的 `feishu-bridge` 进程，两者之间只有一条本地 socket。
 *
 * 这么切是因为 lark-cli **同一个 event key 只允许一个消费者**：让桥接从头到尾
 * 持有那唯一的消费者，dsh 反过来当它的客户端，就不需要任何交接、互斥和心跳。
 * socket 连着就等于 dsh 活着。
 *
 * 接入方式两条，{@link Config.mode} 说的就是它：
 *
 * - `direct`——dsh 自己申请一个飞书应用，扫码授权就能用。桥接也就是 dsh 的，
 *   所以它那份配置由这里写成 `~/.dsh-x-feishu/config.json`（见 `bridge-config.ts`）。
 * - `bridge`——事件由别的进程供给，填一个替代 `lark-cli event consume` 的命令。
 *   高级用法，一般用不上。
 *
 * 空串表示还没接入，卡片上只摆这两条路，别的一概不显示。
 *
 * ```yaml
 * # $DSH_HOME/settings.yaml
 * dsh-x-feishu:
 *   mode: direct          # '' 还没接入 | direct | bridge
 *   profileId: dsh        # direct：用哪个 lark-cli profile
 *   appId: ''             # bridge：那个飞书应用的 app id
 *   eventCommand: ''      # bridge：替代 `lark-cli event consume` 的命令
 *   workspace: ''         # 飞书开的会话落在哪个工作区，留空落在未分组
 *   presetId: standard    # 飞书开的会话用哪个 agent 预设
 *   dmMode: allowlist     # 谁能私聊
 *   groupAllowlist: []    # 放行哪些群，装 chat_id
 * ```
 *
 * @module @deepseek-ai/dsh-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { BridgeClient } from './client.ts'
import { FeishuAuthGateway } from './auth-gateway.ts'
import { join } from 'node:path'
import { DEFAULT_BRIDGE_CONFIG, bridgeConfigPath, publishBridgeConfig } from './bridge-config.ts'
import { BridgeStatus } from './bridge-status.ts'
import { DEFAULT_PROFILE_ID, dshHome, resolveConfigDir } from './auth.ts'
import { defaultEventRelayEndpoint } from './bridge/relay.ts'
import { SessionRouter } from './router.ts'
import { RunQueue } from './queue.ts'
import { SessionDriver, type TurnSink } from './driver.ts'
import { ApprovalBroker, isApprovalVote } from './approval.ts'
import { defaultEndpoint } from './protocol.ts'
import type { Density } from './renderer.ts'

/** Cordis 插件名。 */
export const name = 'dsh-x-feishu'

/**
 * 设置命名空间。
 *
 * cordis.patch.yml 里的 `config:` 是组合基座，`settings.yaml` 的 `dsh-x-feishu:`
 * 段按 key 覆盖在它上面——连接器页那张卡片改的就是后者。没有这一句注册，那张
 * 卡片的五个字段就绑在一个不存在的命名空间上，页面只能显示"没有可改的东西"。
 */
const NS = settingsNamespace('dsh-x-feishu')

/** 依赖。`agentPresets` 是可选的——没有预设组合的部署照样能跑。 */
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'storageDomain']

/** 插件配置。 */
export interface Config {
  /**
   * 接入方式。空串表示还没接入——那时卡片上只有两条路可选，别的都不显示。
   *
   * `direct` 是常规路：dsh 自己一个飞书应用，扫码授权。`bridge` 是高级路：
   * 事件由别的进程供给，dsh 只管消费。
   */
  mode: '' | 'direct' | 'bridge'
  /**
   * `direct`：用哪个 lark-cli profile，写名字不写路径，落在 `~/.lark-cli/<id>`。
   *
   * 单独一份、不跟环境默认共用：默认那份先到先得，谁跑过 `config init` 就是谁的，
   * 而授权、退出登录都会改到它。
   */
  profileId: string
  /** `bridge`：事件来自哪个飞书应用，写 app id。出站要按它找回本机的 profile。 */
  appId: string
  /**
   * `bridge`：替代 `lark-cli event consume <key> --as bot` 的命令。
   *
   * 桥接会 spawn 它并按行读 NDJSON，事件键作为最后一个参数追加。别的进程已经
   * 独占了那个 EventKey 时，用它把事件引过来——一个 EventKey 只允许一个消费者。
   */
  eventCommand: string
  /**
   * 飞书开的会话落在哪个工作区，写目录。
   *
   * 留空落在 `$DSH_HOME/feishu`——它不是注册过的工作区，所以这些会话会出现在
   * 「未分组」下，不会混进你手上的项目里。
   */
  workspace: string
  /** 桥接的本地端点；留空用平台默认。 */
  endpoint: string
  /** 飞书开的会话用哪个 agent 预设；留空用部署默认。 */
  presetId: string
  /** 卡片展示密度。 */
  density: Density
  /** 卡片正文最少隔多久推一次。 */
  flushMs: number
  /** 审批卡片等人点的上限。 */
  approvalTimeoutMs: number
  /** 单聊准入：`open` 谁都能用，`allowlist` 只认名单，`disabled` 一律不理。 */
  dmMode: 'open' | 'allowlist' | 'disabled'
  /** 单聊白名单，装 open_id。 */
  dmAllowlist: string[]
  /** 群白名单，装 chat_id；空表示任何群都不理。 */
  groupAllowlist: string[]
  /** 群里是否必须 @ 到机器人才接活。 */
  requireMention: boolean
  /** 超过这个岁数的消息直接丢，防止长连接重连后重放一堆旧消息。 */
  staleMs: number
  /** 桥接探这个地址判断 dsh 在不在；留空用本进程正在听的地址。 */
  probeOrigin: string
}

export const Config = z.object({
  endpoint: z.string().default(''),
  presetId: z.string().default(''),
  density: z.union([z.const('compact'), z.const('standard'), z.const('detailed')]).default('standard'),
  flushMs: z.natural().default(2500),
  approvalTimeoutMs: z.natural().default(300_000),
  mode: z.union([z.const(''), z.const('direct'), z.const('bridge')]).default(''),
  profileId: z.string().default(DEFAULT_PROFILE_ID),
  appId: z.string().default(''),
  eventCommand: z.string().default(''),
  workspace: z.string().default(''),
  dmMode: z.union([z.const('open'), z.const('allowlist'), z.const('disabled')]).default('allowlist'),
  dmAllowlist: z.array(z.string()).default([]),
  groupAllowlist: z.array(z.string()).default([]),
  requireMention: z.boolean().default(true),
  staleMs: z.natural().default(600_000),
  probeOrigin: z.string().default(''),
}) as unknown as z<Config>

/**
 * 本进程正在服务的地址，用来告诉桥接"探哪儿能知道 dsh 在不在"。
 *
 * 结构化地读而不是 import 那个包：这个插件不该为了一句探活地址就依赖 web 服务，
 * 而没有 web 服务的部署（纯 CLI）读出来是空的，正好退回配置里的默认值。
 * @param ctx - 插件上下文。
 * @returns 形如 `http://127.0.0.1:13080`；读不到时为 `undefined`。
 */
function servingOrigin(ctx: Context): string | undefined {
  try {
    const server = (ctx as unknown as { webServer?: { host?: string; port?: number } }).webServer
    const port = server?.port
    if (port === undefined || port === 0) return undefined
    // 听在 0.0.0.0 上时探回环：探活是本机的事，不该走对外地址。
    const host = server?.host === undefined || server.host === '0.0.0.0' ? '127.0.0.1' : server.host
    return `http://${host}:${port}`
  } catch {
    return undefined
  }
}

/** 停止按钮回传的值。 */
interface StopVote { kind: 'stop'; chatKey: string }

function isStopVote(value: unknown): value is StopVote {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.kind === 'stop' && typeof record.chatKey === 'string'
}

/**
 * 挂载飞书通道。
 * @param ctx - 插件上下文。
 * @param config - 已校验的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('dsh-x-feishu')
  const queue = new RunQueue()

  // 桥接握手带来的现状，设置页读它。复用时那些事实不归 dsh 改，但要看得见。
  const bridgeStatus = new BridgeStatus()

  // 扫码登录挂在插件自己身上，不等桥接：凭证还没配好的时候，让人先去把需要
  // 凭证的东西跑起来是说不通的。
  ctx.plugin(FeishuAuthGateway, bridgeStatus)

  // 挂载时先指向组合基座，设置服务接上以后换成解析后的值。下面每一处都是用到
  // 才读，所以两者的切换、以及此后任何一次保存，都不需要重建任何东西。
  let source = (): Config => config
  let client: BridgeClient | undefined
  const endpoint = (): string => {
    const declared = source().endpoint
    return declared === '' ? defaultEndpoint() : declared
  }
  /** dsh 用的那份 lark-cli profile 目录。扫码授权、订阅、出站都认它。 */
  const identity = (): string => resolveConfigDir(source().profileId)

  /**
   * 飞书开的会话落在哪个目录。
   *
   * 留空给一个**不是注册过的工作区**的目录，这些会话就落在「未分组」下——一条
   * 从聊天软件进来的消息，默认不该往你手上的项目里写东西。
   */
  const workspace = (): string => {
    const declared = source().workspace.trim()
    return declared === '' ? join(dshHome(), 'feishu') : declared
  }

  // 桥接没有界面也没有设置服务，它要的每一项都是人在这一页上决定的事，所以
  // 由这里写出去。还没接入时不写——那时什么都还没定，写下去只会让桥接按一份
  // 空配置起来。
  const publish = (): void => {
    const current = source()
    if (current.mode === '') return
    publishBridgeConfig({
      endpoint: endpoint(),
      eventEndpoint: defaultEventRelayEndpoint(),
      // 写成具体目录而不是留空：留空在桥接那边意味着"跟着环境默认走"，而这台
      // 机器上的环境默认往往是别的工具的应用。
      eventConfigDirs: [identity()],
      cardActionConfigDirs: [],
      // 事件换个来源。`direct` 下留空，桥接照常 spawn lark-cli。
      eventCommand: current.mode === 'bridge' ? current.eventCommand.trim() : '',
      policy: {
        dmMode: current.dmMode,
        dmAllowlist: current.dmAllowlist,
        groupAllowlist: current.groupAllowlist,
        requireMention: current.requireMention,
        staleMs: current.staleMs,
      },
      probeOrigin: current.probeOrigin === ''
        ? servingOrigin(ctx) ?? DEFAULT_BRIDGE_CONFIG.probeOrigin
        : current.probeOrigin,
    }).then((written) => {
      if (written) logger.info('桥接配置写好了：%s', bridgeConfigPath())
    }).catch((error: unknown) => {
      // 写不下去不该把通道带停：dsh 这一侧照样能收发，只是桥接还按上一份跑。
      logger.warn('写不了桥接配置，桥接还按上一份跑：%o', error)
    })
  }

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (current) => { source = current },
    // 端点是唯一一个"拨号那一刻定死"的值，所以只有它需要被通知。
    onChange: () => {
      if (client?.redialIfMoved() === true) logger.info('桥接端点改了，正在改连 %s', endpoint())
      publish()
    },
  })

  // 路由表要异步打开，所以整段装配放进 inject 纤维里。注意纤维里的错误会被
  // 框架收容，重要的失败必须自己记，不能指望启动中止。
  ctx.inject(['storageDomain'], async (scoped: Context) => {
    let router: SessionRouter
    try {
      router = await SessionRouter.open(scoped)
    } catch (error: unknown) {
      logger.error('打不开会话映射表，飞书通道没有挂起来：%o', error)
      return
    }

    const sink: TurnSink = {
      async open(chatKey, replyTo, title) {
        try {
          const ack = await client?.request({ kind: 'card.open', chatKey, replyTo, title, text: '', stoppable: true })
          return ack?.ok === true ? ack.cardId : undefined
        } catch (error: unknown) {
          logger.warn('开卡片失败，这一轮只在结束时回一条：%o', error)
          return undefined
        }
      },
      update(cardId, stage, text) {
        client?.send({ kind: 'card.update', cardId, stage, text })
      },
      close(cardId, text, outcome) {
        client?.send({ kind: 'card.close', cardId, text, outcome: outcome as never })
      },
    }

    const broker = new ApprovalBroker({
      async ask(chatKey, askId, title, detail) {
        const ack = await client?.request({ kind: 'ask', chatKey, askId, title, detail })
        if (ack?.ok !== true) throw new Error(ack?.error ?? '桥接没接住审批卡片')
      },
    }, () => source().approvalTimeoutMs)

    const driver = new SessionDriver({
      ctx: scoped,
      router,
      sink,
      cwd: workspace,
      // 没选预设时读出 undefined，让驱动走部署默认。
      presetId: () => source().presetId === '' ? undefined : source().presetId,
      render: () => ({ density: source().density, argPreview: 80 }),
      flushMs: () => source().flushMs,
    })

    client = new BridgeClient(endpoint, {
      onReady(hello) {
        bridgeStatus.greeted(hello.bridge)
        logger.info('已连上飞书桥接，机器人 %s', hello.botOpenId)
      },
      onDisconnect() {
        bridgeStatus.dropped()
        logger.warn('飞书桥接断了，正在重连')
      },
      onError(error) {
        logger.warn('飞书桥接出错：%o', error)
      },
      onMessage(frame) {
        // 排队要给回执：让人干等而不说前面还有几个，比排队本身更难受。
        void queue.enqueue(
          () => driver.run(frame.chatKey, frame.messageId, frame.text),
          (position) => {
            client?.send({
              kind: 'reply',
              chatKey: frame.chatKey,
              replyTo: frame.messageId,
              text: `收到，前面还有 ${position} 个任务在跑，轮到你时我会开始。`,
            })
          },
        ).catch((error: unknown) => {
          logger.warn('这一轮没跑成：%o', error)
          client?.send({
            kind: 'reply',
            chatKey: frame.chatKey,
            replyTo: frame.messageId,
            text: `没能跑起来：${error instanceof Error ? error.message : String(error)}`,
          })
        })
      },
      onCardAction(frame) {
        if (isApprovalVote(frame.value)) {
          if (!broker.resolve(frame.value)) {
            logger.info('收到一个已经过期的审批点击：%s', frame.value.askId)
          }
          return
        }
        if (isStopVote(frame.value)) {
          const stopped = driver.cancel(frame.value.chatKey)
          client?.send({
            kind: 'reply',
            chatKey: frame.value.chatKey,
            text: stopped ? '好，停了。' : '这会儿没有在跑的任务。',
          })
        }
      },
    })
    client.connect()

    // 会话事件：先按自己的会话表过滤，同一个进程里 Web UI 的会话也在发事件。
    scoped.on('session/event', (session: Session, event: SessionEvent) => {
      driver.handleSessionEvent(session, event)
    })

    // 工具审批：不是自己的会话交给下游，绝不替别人的 agent 拿主意。
    scoped.on('approval/request', (request, next) => {
      const chatKey = driver.chatKeyOfAgent(request.agent)
      if (chatKey === undefined || request.callId === undefined) return next()
      return broker.request(chatKey, request.toolName, request.reason ?? '', request.signal)
    })

    scoped.effect(() => () => {
      queue.dispose()
      broker.dispose()
      driver.dispose()
      client?.dispose()
      void router.close()
    }, 'dsh-x-feishu teardown')
  })
}
