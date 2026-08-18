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
 * @module @personal/dsh-x-feishu/bridge/lark
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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

/**
 * 调一次 `lark-cli api`。
 * @param method - HTTP 方法。
 * @param path - 开放平台路径。
 * @param body - 请求体，没有就不传。
 * @param query - 查询参数。
 * @returns 解析后的结果；失败时带上原因而不是抛。
 */
export async function larkApi(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<LarkResult> {
  const args = ['api', method, path, '--as', 'bot']
  if (body !== undefined) args.push('--data', JSON.stringify(body))
  if (query !== undefined) args.push('--params', JSON.stringify(query))
  try {
    const { stdout } = await run('lark-cli', args, { timeout: CALL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
    const parsed: unknown = stdout.trim() === '' ? {} : JSON.parse(stdout)
    return { ok: true, data: parsed }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 一张卡片的 JSON（飞书卡片 2.0）。 */
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

/** 审批卡片：允许一次 / 拒绝。 */
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
 * @param chatId - 会话 id。
 * @param msgType - `text` 或 `interactive`。
 * @param content - 载荷；飞书要求是 JSON 字符串。
 * @returns 结果，成功时 data 里带 message_id。
 */
export function sendMessage(chatId: string, msgType: 'text' | 'interactive', content: unknown): Promise<LarkResult> {
  return larkApi('POST', ENDPOINTS.sendMessage, {
    receive_id: chatId,
    msg_type: msgType,
    content: JSON.stringify(content),
  }, { receive_id_type: 'chat_id' })
}

/**
 * 回复某条消息（群里会留在原话题里）。
 * @param messageId - 被回复的消息。
 * @param msgType - `text` 或 `interactive`。
 * @param content - 载荷。
 */
export function replyMessage(
  messageId: string,
  msgType: 'text' | 'interactive',
  content: unknown,
): Promise<LarkResult> {
  return larkApi('POST', ENDPOINTS.replyMessage(messageId), {
    msg_type: msgType,
    content: JSON.stringify(content),
  })
}

/**
 * 更新一张已经发出去的卡片。
 * @param messageId - 卡片所在消息。
 * @param card - 新的卡片 JSON。
 */
export function patchCard(messageId: string, card: unknown): Promise<LarkResult> {
  return larkApi('PATCH', ENDPOINTS.patchMessage(messageId), { content: JSON.stringify(card) })
}

/**
 * 从返回里取 message_id。飞书的包裹层是 `{code,msg,data:{message_id}}`，
 * lark-cli 可能再包一层，两种都试。
 * @param result - 调用结果。
 * @returns 消息 id，取不到时 `undefined`。
 */
export function messageIdOf(result: LarkResult): string | undefined {
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): string | undefined => {
    if (depth > 5 || typeof value !== 'object' || value === null || seen.has(value)) return undefined
    seen.add(value)
    const record = value as Record<string, unknown>
    if (typeof record.message_id === 'string') return record.message_id
    for (const nested of Object.values(record)) {
      const found = walk(nested, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return walk(result.data, 0)
}

/**
 * 取机器人自己的 open_id。判"有没有 @ 我"要用它，按名字匹配不可靠。
 * @returns open_id，取不到时 `undefined`。
 */
export async function resolveBotOpenId(): Promise<string | undefined> {
  const result = await larkApi('GET', ENDPOINTS.botInfo)
  if (!result.ok) return undefined
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): string | undefined => {
    if (depth > 5 || typeof value !== 'object' || value === null || seen.has(value)) return undefined
    seen.add(value)
    const record = value as Record<string, unknown>
    if (typeof record.open_id === 'string') return record.open_id
    for (const nested of Object.values(record)) {
      const found = walk(nested, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  return walk(result.data, 0)
}
