/**
 * `lark-cli event consume` 吐出来的 NDJSON 的形状、解析与准入判定。
 *
 * 字段名与 `lark-cli event schema im.message.receive_v1 --json` 一致（lark-cli
 * v1.0.87）。**去重键是 `message_id` 不是 `event_id`**——schema 里专门写了这一句，
 * 因为同一条消息可能以不同的 event_id 重投。
 *
 * 准入判定放在这里，是为了让不够格的消息**根本不穿过 socket**：白名单外的人
 * 发的消息不该进到 dsh 里去建会话。整个文件是纯逻辑，不 spawn 进程也不碰
 * socket，所以策略可以拿构造的事件单测。
 *
 * @module @personal/dsh-x-feishu/src/lark-events
 */

/** 一条 `im.message.receive_v1` 事件。只列本插件用到的字段。 */
export interface LarkMessageEvent {
  readonly type?: string
  readonly chat_id?: string
  readonly chat_type?: string
  readonly content?: string
  readonly create_time?: string
  readonly message_id?: string
  readonly message_type?: string
  readonly sender_id?: string
  readonly sender_type?: string
  readonly thread_id?: string
  readonly mentions?: readonly { readonly id?: string; readonly key?: string; readonly name?: string }[]
}

/** 一条 `card.action.trigger` 事件。 */
export interface LarkCardActionEvent {
  readonly type?: string
  readonly message_id?: string
  readonly chat_id?: string
  readonly operator_id?: string
  /** lark-cli 扁平化后的 JSON 字符串，不是嵌套的 action.value。 */
  readonly action_value?: string
  readonly action_tag?: string
}

/**
 * 还原卡片组件 value；对象值由 lark-cli 作为 JSON 字符串输出。
 * @param event - `card.action.trigger` 事件。
 * @returns 组件原值；非 JSON 字符串保持原样。
 */
export function cardActionValue(event: LarkCardActionEvent): unknown {
  const value = event.action_value
  if (value === undefined || value === '') return undefined
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** 准入策略。 */
export interface AccessPolicy {
  /** 单聊：`open` 谁都能用，`allowlist` 只认名单，`disabled` 一律不理。 */
  readonly dmMode: 'open' | 'allowlist' | 'disabled'
  /** 单聊白名单，装 open_id。 */
  readonly dmAllowlist: readonly string[]
  /** 群白名单，装 chat_id；空数组表示任何群都不理。 */
  readonly groupAllowlist: readonly string[]
  /** 群里是否必须 @ 到机器人才接活。 */
  readonly requireMention: boolean
  /** 超过这个岁数的消息直接丢，防止长连接重连后重放一堆旧消息。 */
  readonly staleMs: number
}

/** 默认策略：默认拒绝。 */
export const DEFAULT_POLICY: AccessPolicy = {
  dmMode: 'allowlist',
  dmAllowlist: [],
  groupAllowlist: [],
  requireMention: true,
  staleMs: 10 * 60 * 1000,
}

/** 准入判定的结论。 */
export type Admission =
  | { readonly ok: true; readonly message: AdmittedMessage }
  | { readonly ok: false; readonly reason: RejectReason }

/** 拒绝理由。这些值会进日志，所以取稳定的短名。 */
export type RejectReason =
  | 'malformed'
  | 'not-a-message'
  | 'from-bot'
  | 'stale'
  | 'dm-disabled'
  | 'sender-not-allowed'
  | 'group-not-allowed'
  | 'no-mention'
  | 'empty-text'

/** 过了准入的消息，字段已经规整成插件那边要的形状。 */
export interface AdmittedMessage {
  readonly chatKey: string
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly threadId?: string
  readonly messageId: string
  readonly senderId: string
  /** 剥掉 @机器人 之后的正文。 */
  readonly text: string
}

/**
 * 由会话容器算出稳定的路由键。
 *
 * 群里的话题各自成一个会话——同一个群里两个话题聊的是两件事，共用上下文
 * 会互相污染。单聊和群主线都退回 chatId。
 * @param chatId - 会话容器 id。
 * @param threadId - 话题 id，没有就不传。
 * @returns 路由键。
 */
export function chatKeyOf(chatId: string, threadId?: string): string {
  return threadId === undefined || threadId === '' ? chatId : `${chatId}:${threadId}`
}

/**
 * 把正文里的 @提及占位符去掉。
 *
 * 飞书把 @ 渲染成 `@_user_1` 这样的占位 key，`mentions` 数组给出 key → 名字/id
 * 的对应。机器人自己的那个直接删掉，其他人的还原成名字，免得模型读到一串
 * 占位符。
 * @param content - 原始正文。
 * @param mentions - 事件里的提及数组。
 * @param botOpenId - 机器人自己的 open_id。
 * @returns 清理后的正文。
 */
export function stripMentions(
  content: string,
  mentions: LarkMessageEvent['mentions'],
  botOpenId: string,
): string {
  let text = content
  for (const mention of mentions ?? []) {
    const key = mention.key
    if (key === undefined || key === '') continue
    const replacement = mention.id === botOpenId ? '' : `@${mention.name ?? ''}`
    text = text.split(key).join(replacement)
  }
  return text.trim()
}

/** 这条事件有没有 @ 到机器人。 */
export function mentionsBot(event: LarkMessageEvent, botOpenId: string): boolean {
  return (event.mentions ?? []).some(mention => mention.id === botOpenId)
}

/**
 * 判定一条消息事件能不能放进来。
 *
 * @param event - 解析出来的事件。
 * @param policy - 准入策略。
 * @param botOpenId - 机器人自己的 open_id。
 * @param now - 当前时刻，供测试注入。
 * @returns 放行时带上规整后的消息，否则带上拒绝理由。
 */
export function admit(
  event: LarkMessageEvent,
  policy: AccessPolicy,
  botOpenId: string,
  now: number = Date.now(),
): Admission {
  if (event.type !== undefined && event.type !== 'im.message.receive_v1') {
    return { ok: false, reason: 'not-a-message' }
  }
  const { chat_id: chatId, message_id: messageId, sender_id: senderId } = event
  if (typeof chatId !== 'string' || chatId === ''
    || typeof messageId !== 'string' || messageId === ''
    || typeof senderId !== 'string' || senderId === '') {
    return { ok: false, reason: 'malformed' }
  }
  // 机器人发的一律不接，这是防自问自答最省事的一道。
  if (event.sender_type === 'bot' || senderId === botOpenId) {
    return { ok: false, reason: 'from-bot' }
  }
  const createdAt = Number(event.create_time ?? '')
  if (Number.isFinite(createdAt) && createdAt > 0 && now - createdAt > policy.staleMs) {
    return { ok: false, reason: 'stale' }
  }

  const chatType = event.chat_type === 'group' ? 'group' : 'p2p'
  if (chatType === 'p2p') {
    if (policy.dmMode === 'disabled') return { ok: false, reason: 'dm-disabled' }
    if (policy.dmMode === 'allowlist' && !policy.dmAllowlist.includes(senderId)) {
      return { ok: false, reason: 'sender-not-allowed' }
    }
  } else {
    if (!policy.groupAllowlist.includes(chatId)) return { ok: false, reason: 'group-not-allowed' }
    if (policy.requireMention && !mentionsBot(event, botOpenId)) {
      return { ok: false, reason: 'no-mention' }
    }
  }

  const text = stripMentions(event.content ?? '', event.mentions, botOpenId)
  if (text === '') return { ok: false, reason: 'empty-text' }

  const threadId = event.thread_id === undefined || event.thread_id === '' ? undefined : event.thread_id
  return {
    ok: true,
    message: {
      chatKey: chatKeyOf(chatId, threadId),
      chatId,
      chatType,
      // 没有话题时不写这个字段，而不是写一个 undefined。
      ...(threadId === undefined ? {} : { threadId }),
      messageId,
      senderId,
      text,
    },
  }
}

/**
 * 按 `message_id` 去重的滑动窗口。
 *
 * lark-cli 的 schema 明确指出用 `message_id` 而不是 `event_id` 做幂等键：
 * 同一条消息可能带着不同的 event_id 重投。
 */
export class MessageDedup {
  private readonly seen = new Map<string, number>()

  /**
   * @param ttlMs - 一个 id 记多久。
   * @param maxEntries - 最多记多少条，超了按最旧的丢。
   */
  constructor(private readonly ttlMs = 10 * 60 * 1000, private readonly maxEntries = 2000) {}

  /**
   * 记下一个 id 并回答它是不是新的。
   * @param messageId - 飞书消息 id。
   * @param now - 当前时刻。
   * @returns 第一次见到为 `true`。
   */
  admit(messageId: string, now: number = Date.now()): boolean {
    this.sweep(now)
    if (this.seen.has(messageId)) return false
    this.seen.set(messageId, now)
    return true
  }

  private sweep(now: number): void {
    for (const [id, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(id)
    }
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next()
      if (oldest.done === true) break
      this.seen.delete(oldest.value)
    }
  }
}
