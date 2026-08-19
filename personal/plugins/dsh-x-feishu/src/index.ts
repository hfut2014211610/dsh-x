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
 * 桥接自己没有界面也没有设置服务，所以**它那份配置也在这里**：下面的字段一保存
 * 就写成 `~/.dsh-x-feishu/config.json`，桥接只管读（见 `bridge-config.ts`）。人只在
 * 一个地方改，改完不用重起桥接。
 *
 * ```yaml
 * # $DSH_HOME/settings.yaml
 * dsh-x-feishu:
 *   endpoint: ''          # 留空用平台默认（win32 命名管道 / POSIX unix socket）
 *   presetId: standard    # 飞书开的会话用哪个 agent 预设
 *   density: standard     # compact | standard | detailed
 *   eventConfigDirs: []   # 接哪几个飞书应用；空表示沿用 lark-cli 的环境默认
 *   dmMode: allowlist     # open | allowlist | disabled
 *   groupAllowlist: []    # 放行哪些群，装 chat_id
 * ```
 *
 * @module @personal/dsh-x-feishu
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
import { DEFAULT_BRIDGE_CONFIG, bridgeConfigPath, publishBridgeConfig } from './bridge-config.ts'
import { dshConfigDir } from './auth.ts'
import { defaultEventRelayEndpoint } from '../bridge/relay.ts'
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

/**
 * 插件配置。
 *
 * 前一半是 dsh 这边的事，后一半是**桥接进程的事**——它们摆在同一个命名空间里，
 * 因为桥接没有自己的界面，而人不该为了同一件事在两个地方改。保存时后一半会被
 * 写成 `~/.dsh-x-feishu/config.json`。
 */
export interface Config {
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
  /**
   * 桥接接哪几个飞书应用，写 lark-cli 的 profile 目录。
   *
   * 空表示沿用 lark-cli 的环境默认那份，也就是单应用。填多个是"多 agent 复用"
   * 那条路：同一个群里的几个机器人应用各自被订阅，事件汇进同一条 relay。
   */
  eventConfigDirs: string[]
  /** 卡片回调已在开发者后台订阅的应用；空表示与 {@link eventConfigDirs} 相同。 */
  cardActionConfigDirs: string[]
  /** 其他本机 Agent 只读订阅原始飞书事件的端点；留空用平台默认。 */
  eventEndpoint: string
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
  eventConfigDirs: z.array(z.string()).default([]),
  cardActionConfigDirs: z.array(z.string()).default([]),
  eventEndpoint: z.string().default(''),
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

  // 扫码登录挂在插件自己身上，不等桥接：凭证还没配好的时候，让人先去把需要
  // 凭证的东西跑起来是说不通的。
  ctx.plugin(FeishuAuthGateway)

  // 挂载时先指向组合基座，设置服务接上以后换成解析后的值。下面每一处都是用到
  // 才读，所以两者的切换、以及此后任何一次保存，都不需要重建任何东西。
  let source = (): Config => config
  let client: BridgeClient | undefined
  const endpoint = (): string => {
    const declared = source().endpoint
    return declared === '' ? defaultEndpoint() : declared
  }
  // 桥接那份配置由这里写出去。它没有界面也没有设置服务，而它要的每一项都是人
  // 在这一页上决定的事；两边各存一份的结果就是改一处不生效。
  const publish = (): void => {
    const current = source()
    publishBridgeConfig({
      endpoint: endpoint(),
      eventEndpoint: current.eventEndpoint === '' ? defaultEventRelayEndpoint() : current.eventEndpoint,
      // 一个都没列 = 用 dsh 自己那份，跟扫码登录那一页同一条规矩。写成具体目录
      // 而不是留空，是因为留空在桥接那边意味着"跟着环境默认走"，而这台机器上的
      // 环境默认往往是别的工具的应用——那正是这一路上已经踩过一次的坑。
      eventConfigDirs: current.eventConfigDirs.length === 0 ? [dshConfigDir()] : current.eventConfigDirs,
      cardActionConfigDirs: current.cardActionConfigDirs,
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
      cwd: process.cwd(),
      // 没选预设时读出 undefined，让驱动走部署默认。
      presetId: () => source().presetId === '' ? undefined : source().presetId,
      render: () => ({ density: source().density, argPreview: 80 }),
      flushMs: () => source().flushMs,
    })

    client = new BridgeClient(endpoint, {
      onReady(botOpenId) {
        logger.info('已连上飞书桥接，机器人 %s', botOpenId)
      },
      onDisconnect() {
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
