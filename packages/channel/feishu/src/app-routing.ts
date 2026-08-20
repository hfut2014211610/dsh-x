/**
 * 记住每个会话、每张卡片是从**哪个飞书应用**来的。
 *
 * 桥接可以同时接好几个飞书应用（各自一份唯一的事件订阅）。事件进来的时候知道
 * 是谁收的，出站的时候必须还以那个身份发，否则会出现"A 的机器人被 @，B 的机器人
 * 回话"；而卡片更新更严——飞书只让**发这条消息的那个应用**改它，身份错了连进度
 * 都刷不动。
 *
 * 这里只管"是谁"，不 spawn 进程也不碰 socket，所以判断可以拿构造的会话单测。
 *
 * @module @deepseek-ai/dsh-feishu/app-routing
 */

/** 一张已经发出去的卡片。 */
export interface CardRecord {
  /** 飞书那条消息的 id。 */
  readonly messageId: string
  /** 卡片标题，收尾时还要用。 */
  readonly title: string
  /** 发出这张卡片的应用。 */
  readonly configDir: string
}

/** 认不出来源时怎么办。 */
export interface AppRoutingHooks {
  /** 出站找不到来源，只能猜一个应用发。猜错的表现是"消息发出去了，卡片却更新不动"。 */
  onGuess?: (chatKey: string, configDir: string) => void
}

/** 会话与卡片的来源表。 */
export class AppRouter {
  private readonly chatIds = new Map<string, string>()
  private readonly chatApps = new Map<string, string>()
  private readonly cards = new Map<string, CardRecord>()

  /**
   * @param fallback - 认不出来源时落到哪个应用。读的时候现算，因为配置可以热更。
   * @param hooks - 认不出来源时的回调。
   */
  constructor(private readonly fallback: () => string, private readonly hooks: AppRoutingHooks = {}) {}

  /**
   * 记下一个会话。
   * @param chatKey - 路由键（群里的话题各自成一个会话）。
   * @param chatId - 飞书会话 id，回消息要用。
   * @param configDir - 收到它的那个应用。
   */
  rememberChat(chatKey: string, chatId: string, configDir: string): void {
    this.chatIds.set(chatKey, chatId)
    this.chatApps.set(chatKey, configDir)
  }

  /**
   * 这个会话的飞书 id。
   * @param chatKey - 路由键。
   * @returns 会话 id；没记过的话退回 chatKey 本身，单聊里两者本来就相等。
   */
  chatId(chatKey: string): string {
    return this.chatIds.get(chatKey) ?? chatKey
  }

  /**
   * 这个会话该以哪个应用的身份回。
   * @param chatKey - 路由键。
   * @returns 应用的 profile 目录。
   */
  appOfChat(chatKey: string): string {
    const known = this.chatApps.get(chatKey)
    if (known !== undefined) return known
    // 桥接重启过，或者插件拿着上一轮的 chatKey 回来了。只能猜，但要让人看见：
    // 猜错不会报错，只会安静地用错身份发出去。
    const guess = this.fallback()
    this.hooks.onGuess?.(chatKey, guess)
    return guess
  }

  /**
   * 记下一张发出去的卡片。
   * @param cardId - 插件那边给的 id。
   * @param record - 消息 id、标题，以及发它的应用。
   */
  rememberCard(cardId: string, record: CardRecord): void {
    this.cards.set(cardId, record)
  }

  /**
   * 这张卡片的记录。
   * @param cardId - 插件那边给的 id。
   * @returns 记录；没有就是 `undefined`，此时不该硬发一次注定被拒的更新。
   */
  card(cardId: string): CardRecord | undefined {
    return this.cards.get(cardId)
  }

  /**
   * 卡片收尾了，不再记它。
   * @param cardId - 插件那边给的 id。
   */
  forgetCard(cardId: string): void {
    this.cards.delete(cardId)
  }
}
