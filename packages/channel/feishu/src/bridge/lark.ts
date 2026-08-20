/**
 * 桥接与 lark-cli 之间的全部接触面。
 *
 * **只有这个文件 spawn lark-cli。** 出站的每一次调用约 300ms（实测
 * `lark-cli --version` 五次：339 / 361 / 291 / 343 / 282 ms），所以调用要省着用：
 * 卡片按阶段更新，不逐字。
 *
 * 发消息和更新卡片都走 `lark-cli api` 这个逃生口，因为 lark-cli v1.0.87 没有
 * `im.messages.patch`（`lark-cli schema im.messages.patch` 明确回 Unknown method），
 * 也没有 `cardkit` 域。走逃生口意味着**没有参数校验**，请求形状写错只能在运行
 * 时发现，所以下面的路径与载荷集中放在一处，接真凭证之前要先用一次性脚本
 * 逐个打通。
 *
 * 每个函数的第一个参数都是 `configDir`，**以哪个飞书应用的身份发**。这不是可选的
 * 讲究：入站按应用分开订阅（一个 EventKey 一个 consumer），出站要是跟着环境默认
 * 走，就会出现"消息从 A 应用进来、回复由 B 应用的机器人发出去"；而 `patchCard`
 * 只能改**本应用发出的**消息，身份错了连卡片都更新不了。收到那条事件的应用是谁，
 * 回它的就得是谁。
 *
 * @module @deepseek-ai/dsh-feishu/bridge/lark
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { larkCliEnvironment, larkCliInvocation } from './cli.ts'

const run = promisify(execFile)

/** 出站调用的超时。lark-cli 自己还要解析 token、发网络请求。 */
const CALL_TIMEOUT_MS = 20_000

/**
 * 飞书 IM v1 的 REST 路径。集中在这里，因为它们没有 typed command 兜底，
 * 写错只有运行时才知道。
 */
export const ENDPOINTS = {
  /** 发消息；receive_id_type 用 query 传。 */
  sendMessage: '/open-apis/im/v1/messages',
  /** 回复某条消息。 */
  replyMessage: (messageId: string) => `/open-apis/im/v1/messages/${messageId}/reply`,
  /** 更新本应用发出的卡片消息。 */
  patchMessage: (messageId: string) => `/open-apis/im/v1/messages/${messageId}`,
  /** 机器人自己的信息，用来拿 open_id。 */
  botInfo: '/open-apis/bot/v3/info',
} as const

/** 一次 lark-cli 调用的结果。 */
export interface LarkResult {
  readonly ok: boolean
  readonly data?: unknown
  readonly error?: string
}

type LarkOutputFormat = 'json' | 'ndjson'

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function errorOf(value: unknown): string {
  const record = recordOf(value)
  const error = recordOf(record?.error)
  return typeof error?.message === 'string' ? error.message : JSON.stringify(value)
}

/**
 * 调一次 `lark-cli api`。
 * @param configDir - 以哪个飞书应用的身份发；空串沿用环境默认。
 * @param method - HTTP 方法。
 * @param path - 开放平台路径。
 * @param body - 请求体，没有就不传。
 * @param query - 查询参数。
 * @param format - 输出格式；`ndjson` 才保留完整原始响应。
 * @returns 解析后的结果；失败时带上原因而不是抛。
 */
export async function larkApi(
  configDir: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
  query?: Record<string, string>,
  format: LarkOutputFormat = 'json',
): Promise<LarkResult> {
  const args = ['api', method, path, '--as', 'bot', '--format', format]
  if (body !== undefined) args.push('--data', JSON.stringify(body))
  if (query !== undefined) args.push('--params', JSON.stringify(query))
  try {
    const invocation = larkCliInvocation(args)
    const { stdout } = await run(invocation.file, [...invocation.args], {
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      // 桥接常被无控制台地驻留（开机自启、桌面壳拉起），出站调用不藏窗口的话
      // 每次发消息、更新卡片都会闪一个 cmd 窗。
      windowsHide: true,
      env: { ...process.env, ...larkCliEnvironment(configDir) },
    })
    const parsed: unknown = stdout.trim() === '' ? {} : JSON.parse(stdout)
    const record = recordOf(parsed)
    if (format === 'ndjson') {
      return record?.code === 0
        ? { ok: true, data: parsed }
        : { ok: false, error: errorOf(parsed) }
    }
    return record?.ok === true
      ? { ok: true, data: record.data }
      : { ok: false, error: errorOf(parsed) }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 一张进度卡片的 JSON（飞书卡片 2.0）。
 * @param title - 卡片标题。
 * @param stage - 卡片底部那行状态说明。
 * @param text - 正文 Markdown；空串时显示「正在开始」。
 * @param stop - 带上就多一个停止按钮，值里是要停的 chat。
 * @returns 可直接发给飞书的卡片对象。
 */
export function progressCard(title: string, stage: string, text: string, stop?: { chatKey: string }): unknown {
  const elements: unknown[] = [
    { tag: 'markdown', content: text === '' ? '_正在开始…_' : text },
    { tag: 'hr' },
    { tag: 'note', elements: [{ tag: 'plain_text', content: stage }] },
  ]
  if (stop !== undefined) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '停止' },
        type: 'danger',
        value: { kind: 'stop', chatKey: stop.chatKey },
      }],
    })
  }
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: title } },
    elements,
  }
}

/**
 * 审批卡片：允许一次 / 拒绝。
 * @param askId - 这次审批的 id，回传时用它对上。
 * @param title - 要批的动作，通常是工具名。
 * @param detail - 补充信息；空串时用一句兜底说明。
 * @returns 可直接发给飞书的卡片对象。
 */
export function approvalCard(askId: string, title: string, detail: string): unknown {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: `需要确认：${title}` }, template: 'orange' },
    elements: [
      { tag: 'markdown', content: detail === '' ? '模型请求执行这个操作。' : detail },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '允许一次' },
            type: 'primary',
            value: { kind: 'approval', askId, decision: 'allow' },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '拒绝' },
            type: 'danger',
            value: { kind: 'approval', askId, decision: 'reject' },
          },
        ],
      },
    ],
  }
}

/**
 * 发一条消息到会话。
 * @param configDir - 以哪个飞书应用的身份发。
 * @param chatId - 会话 id。
 * @param msgType - `text` 或 `interactive`。
 * @param content - 载荷；飞书要求是 JSON 字符串。
 * @returns 结果，成功时 data 里带 message_id。
 */
export function sendMessage(
  configDir: string,
  chatId: string,
  msgType: 'text' | 'interactive',
  content: unknown,
): Promise<LarkResult> {
  return larkApi(configDir, 'POST', ENDPOINTS.sendMessage, {
    receive_id: chatId,
    msg_type: msgType,
    content: JSON.stringify(content),
  }, { receive_id_type: 'chat_id' })
}

/**
 * 回复某条消息（群里会留在原话题里）。
 * @param configDir - 以哪个飞书应用的身份回。
 * @param messageId - 被回复的消息。
 * @param msgType - `text` 或 `interactive`。
 * @param content - 载荷。
 * @returns 结果，成功时 data 里带 message_id。
 */
export function replyMessage(
  configDir: string,
  messageId: string,
  msgType: 'text' | 'interactive',
  content: unknown,
): Promise<LarkResult> {
  return larkApi(configDir, 'POST', ENDPOINTS.replyMessage(messageId), {
    msg_type: msgType,
    content: JSON.stringify(content),
  })
}

/**
 * 更新一张已经发出去的卡片。
 *
 * 飞书只让**发这条消息的那个应用**改它，所以这里的身份必须与当初 `card.open`
 * 用的那个一致，错了会被拒。
 * @param configDir - 当初发出这张卡片的那个飞书应用。
 * @param messageId - 卡片所在消息。
 * @param card - 新的卡片 JSON。
 * @returns 结果。
 */
export function patchCard(configDir: string, messageId: string, card: unknown): Promise<LarkResult> {
  return larkApi(configDir, 'PATCH', ENDPOINTS.patchMessage(messageId), { content: JSON.stringify(card) })
}

/**
 * 从 lark-cli 成功信封的 data 里取 message_id。
 * @param result - 调用结果。
 * @returns 消息 id，取不到时 `undefined`。
 */
export function messageIdOf(result: LarkResult): string | undefined {
  const messageId = recordOf(result.data)?.message_id
  return typeof messageId === 'string' ? messageId : undefined
}

/**
 * 从 `/open-apis/bot/v3/info` 的原始响应里取机器人 open_id。
 * @param value - ndjson 格式保留的原始响应。
 * @returns 机器人 open_id，取不到时 `undefined`。
 */
export function botOpenIdOf(value: unknown): string | undefined {
  const openId = recordOf(recordOf(value)?.bot)?.open_id
  return typeof openId === 'string' ? openId : undefined
}

/**
 * 取某个应用的机器人自己的 open_id。判"有没有 @ 我"要用它，按名字匹配不可靠。
 *
 * 每个应用是一个不同的机器人，open_id 也各不相同——接了两个应用就要问两次，
 * 拿一个去判另一个的 @，判出来的永远是"没 @ 我"。
 * @param configDir - 问哪个应用；空串沿用环境默认。
 * @returns open_id，取不到时 `undefined`。
 */
export async function resolveBotOpenId(configDir: string): Promise<string | undefined> {
  // v1.0.87 的 json 输出只保留 OpenAPI data 字段，而 bot/v3/info 把结果放在顶层 bot；
  // ndjson 才会保留完整原始响应。
  const result = await larkApi(configDir, 'GET', ENDPOINTS.botInfo, undefined, undefined, 'ndjson')
  if (!result.ok) return undefined
  return botOpenIdOf(result.data)
}
