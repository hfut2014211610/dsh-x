/**
 * 会话路由：飞书会话容器 ↔ dsh 会话的持久映射。
 *
 * 映射必须落盘。进程重启后用户在原来那个单聊里继续说话，接回的应该是重启前
 * 那个会话而不是新建一个——这是"在飞书里用 dsh"和"每次都从头说起"的区别。
 * 存储走 `ctx.storageDomain`，不自己开文件：域存储已经有 schema 校验、写序列化
 * 与持久化保证，再造一份只会多一处要维护的落盘逻辑。
 *
 * @module @personal/dsh-x-feishu/src/router
 */

import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

/** 会话容器键。由 `lark-events.ts` 的 `chatKeyOf` 算出来，这里只当字符串用。 */
export type ChatKey = string

const bindingSchema = z.object({
  /** 这个飞书会话绑定的 dsh 会话。 */
  sessionId: z.string().min(1),
  /** 建会话时用的 agent preset，resume 时要用同一个。 */
  presetId: z.string().optional(),
  /** 会话的工作区。 */
  cwd: z.string().min(1),
  /** 首次绑定时刻。 */
  createdAt: z.number(),
  /** 最后一次用到的时刻，用来做过期清理。 */
  lastUsedAt: z.number(),
})

/** 一个飞书会话容器绑定的 dsh 会话信息。 */
export type ChatBinding = z.infer<typeof bindingSchema>

/**
 * 域名要满足 `UNIT_NAME_RE`（`/^[a-z][a-z0-9_]*$/`），所以用下划线不用连字符——
 * 写成 `dsh-x-feishu` 会在模块加载时就抛。
 */
export const FEISHU_DOMAIN = defineDomain({
  name: 'dsh_x_feishu',
  version: 1,
  tables: {
    chats: domainTable<ChatKey, ChatBinding>(bindingSchema),
  },
})

/** 飞书会话容器到 dsh 会话的映射表。 */
export class SessionRouter {
  private constructor(private readonly domain: Domain<typeof FEISHU_DOMAIN>) {}

  /**
   * 打开映射表。
   * @param ctx - 已注入 `storageDomain` 的插件上下文。
   * @returns 打开的路由表；调用方负责 {@link close}。
   */
  static async open(ctx: Context): Promise<SessionRouter> {
    return new SessionRouter(await ctx.storageDomain.open(FEISHU_DOMAIN))
  }

  /**
   * 查一个飞书会话绑定到哪个 dsh 会话。
   * @param key - 会话容器键。
   * @returns 绑定信息，没绑过时是 `undefined`。
   */
  lookup(key: ChatKey): ChatBinding | undefined {
    return this.domain.table('chats').get(key)
  }

  /**
   * 建立或覆盖一条绑定。
   * @param key - 会话容器键。
   * @param binding - 完整的绑定记录（域存储不做部分合并）。
   */
  async bind(key: ChatKey, binding: ChatBinding): Promise<void> {
    await this.domain.table('chats').put(key, binding)
  }

  /**
   * 更新最后使用时刻。绑定不存在时静默返回——这条路径不该因为一次
   * 时间戳更新而把消息处理打断。
   * @param key - 会话容器键。
   * @param at - 当前时刻。
   */
  async touch(key: ChatKey, at: number): Promise<void> {
    if (this.lookup(key) === undefined) return
    await this.domain.table('chats').update(key, current => ({ ...current, lastUsedAt: at }))
  }

  /**
   * 解绑，下一条消息会重新建会话。
   * @param key - 会话容器键。
   * @returns 原本存在为 `true`。
   */
  async unbind(key: ChatKey): Promise<boolean> {
    return this.domain.table('chats').delete(key)
  }

  /** 当前所有绑定的快照。 */
  entries(): [ChatKey, ChatBinding][] {
    return [...this.domain.table('chats').entries()]
  }

  /** 关闭映射表。 */
  async close(): Promise<void> {
    await this.domain.close()
  }
}
