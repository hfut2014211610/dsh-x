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
 * ```yaml
 * # $DSH_HOME/settings.yaml
 * dsh-x-feishu:
 *   endpoint: ''          # 留空用平台默认（win32 命名管道 / POSIX unix socket）
 *   presetId: standard    # 飞书开的会话用哪个 agent 预设
 *   density: standard     # compact | standard | detailed
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
}

export const Config = z.object({
  endpoint: z.string().default(''),
  presetId: z.string().default(''),
  density: z.union([z.const('compact'), z.const('standard'), z.const('detailed')]).default('standard'),
  flushMs: z.natural().default(2500),
  approvalTimeoutMs: z.natural().default(300_000),
}) as unknown as z<Config>

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

  // 挂载时先指向组合基座，设置服务接上以后换成解析后的值。下面每一处都是用到
  // 才读，所以两者的切换、以及此后任何一次保存，都不需要重建任何东西。
  let source = (): Config => config
  let client: BridgeClient | undefined
  const endpoint = (): string => {
    const declared = source().endpoint
    return declared === '' ? defaultEndpoint() : declared
  }
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (current) => { source = current },
    // 端点是唯一一个"拨号那一刻定死"的值，所以只有它需要被通知。
    onChange: () => {
      if (client?.redialIfMoved() === true) logger.info('桥接端点改了，正在改连 %s', endpoint())
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
