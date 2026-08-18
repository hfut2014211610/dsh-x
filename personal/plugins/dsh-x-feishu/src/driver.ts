/**
 * 会话驱动：把一条飞书消息变成一次 dsh 回合，把回合过程变成卡片更新。
 *
 * agent 的建与续沿用 `packages/bundle/headless/src/index.ts` 的骨架，但多一步
 * `ctx.agentPresets.mount()`——headless bundle 不组合预设，web profile 组合了，
 * 少这一步 agent 会以空工具目录起来。
 *
 * 卡片**按阶段更新，不逐字**：lark-cli 每次调用约 300ms，逐 token 的节拍它吃不下。
 * 换工具、出结果、收尾这些阶段边界立刻推一帧，中间的纯文本增长按节流推。
 *
 * @module @personal/dsh-x-feishu/src/driver
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// 空类型 import 只为把 agentPresets 合并进 Context；预设组合是可选的，
// 没有预设的部署照样能跑，所以运行时仍然要判在不在。
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRouter } from './router.ts'
import { DEFAULT_RENDER_OPTIONS, TurnRenderer, type RenderOptions } from './renderer.ts'

/** 卡片正文最少隔多久推一次，防止把 lark-cli 打满。 */
export const DEFAULT_FLUSH_MS = 2_500

/** 驱动要往外发的动作，由 index 接到桥接客户端上。 */
export interface TurnSink {
  /** 开一张进度卡片，返回卡片 id。 */
  open(chatKey: string, replyTo: string, title: string): Promise<string | undefined>
  /** 更新卡片。 */
  update(cardId: string, stage: string, text: string): void
  /** 收尾卡片。 */
  close(cardId: string, text: string, outcome: string): void
}

/** 一个正在跑的回合。 */
interface ActiveTurn {
  readonly chatKey: string
  readonly renderer: TurnRenderer
  cardId: string | undefined
  /** 上次推给卡片的时刻。 */
  lastFlush: number
  /** 上次推出去的正文，用来判断有没有新内容。 */
  lastText: string
  /** 当前阶段标签。 */
  stage: string
  timer: NodeJS.Timeout | undefined
}

/** 驱动的依赖。 */
export interface DriverOptions {
  readonly ctx: Context
  readonly router: SessionRouter
  readonly sink: TurnSink
  /** 共用的工作区。 */
  readonly cwd: string
  /** 建会话时用的预设；不给就用部署默认。 */
  readonly presetId?: string
  readonly render?: RenderOptions
  readonly flushMs?: number
  readonly now?: () => number
}

/** 一个 chat 一个 agent，一次一个回合。 */
export class SessionDriver {
  private readonly agents = new Map<string, Agent>()
  /** 按 dsh 会话 id 索引正在跑的回合，`session/event` 靠它路由。 */
  private readonly turns = new Map<string, ActiveTurn>()
  private readonly now: () => number
  private readonly flushMs: number

  /** @param options - 依赖与调参。 */
  constructor(private readonly options: DriverOptions) {
    this.now = options.now ?? (() => Date.now())
    this.flushMs = options.flushMs ?? DEFAULT_FLUSH_MS
  }

  /**
   * 拿到这个 chat 的 agent：绑过就续，没绑过就建。
   * @param chatKey - 会话容器键。
   * @returns 活着的 agent。
   */
  async ensureAgent(chatKey: string): Promise<Agent> {
    const existing = this.agents.get(chatKey)
    if (existing !== undefined) return existing

    const { ctx, router, cwd, presetId } = this.options
    const selection = ctx.agentDefaultModel.currentSelection()
    const setup = async (agentCtx: Context): Promise<void> => {
      // 唯一支持的挂预设位置：此时 agent 还没发布，组合失败会把整次创建回滚。
      if (ctx.agentPresets !== undefined) await ctx.agentPresets.mount(agentCtx, presetId)
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    }
    const agentOptions = { provider: selection.provider, model: selection.model }

    const bound = router.lookup(chatKey)
    let agent: Agent
    if (bound === undefined) {
      const sessionId = SessionId(`session-${randomUUID()}`)
      agent = (await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions, setup })).agent
      await router.bind(chatKey, {
        sessionId: String(sessionId),
        // 没选预设时不写这个字段，而不是写 undefined：域存储的 schema 区分
        // "字段缺席"和"字段是 undefined"。
        ...(presetId === undefined ? {} : { presetId }),
        cwd,
        createdAt: this.now(),
        lastUsedAt: this.now(),
      })
    } else {
      agent = (await ctx.agents.resume({
        resumeSessionId: SessionId(bound.sessionId),
        agentOptions,
        setup,
      })).agent
      await router.touch(chatKey, this.now())
    }
    this.agents.set(chatKey, agent)
    return agent
  }

  /**
   * 跑一次回合：开卡片、提交消息、等到 idle、收尾卡片。
   * @param chatKey - 会话容器键。
   * @param replyTo - 触发这次回合的飞书消息 id。
   * @param text - 用户说的话。
   */
  async run(chatKey: string, replyTo: string, text: string): Promise<void> {
    const agent = await this.ensureAgent(chatKey)
    const sessionId = String(agent.session.id)
    const turn: ActiveTurn = {
      chatKey,
      renderer: new TurnRenderer(this.options.render ?? DEFAULT_RENDER_OPTIONS),
      cardId: undefined,
      lastFlush: 0,
      lastText: '',
      stage: '思考中',
      timer: undefined,
    }
    this.turns.set(sessionId, turn)
    try {
      turn.cardId = await this.options.sink.open(chatKey, replyTo, '正在处理')
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    } finally {
      if (turn.timer !== undefined) clearTimeout(turn.timer)
      this.turns.delete(sessionId)
      const outcome = turn.renderer.finished?.kind ?? 'other'
      const body = turn.renderer.text.trim() === '' ? '（这一轮没有产生文字回复）' : turn.renderer.text
      if (turn.cardId !== undefined) this.options.sink.close(turn.cardId, body, outcome)
    }
  }

  /**
   * 停掉这个 chat 正在跑的回合。
   * @param chatKey - 会话容器键。
   * @returns 真的有回合被停为 `true`。
   */
  cancel(chatKey: string): boolean {
    const agent = this.agents.get(chatKey)
    if (agent === undefined) return false
    agent.cancel({ kind: 'user' })
    return true
  }

  /**
   * 反查一个 agent 属于哪个飞书会话。
   *
   * 审批答复者靠它判断"这是不是我的会话"——同一个进程里 Web UI 的 agent 也在
   * 走同一条审批瀑布，认错了会把浏览器那边的审批框抢掉。
   * @param agent - 发起审批的 agent。
   * @returns 属于本插件时给出会话容器键，否则 `undefined`。
   */
  chatKeyOfAgent(agent: Agent): string | undefined {
    for (const [chatKey, owned] of this.agents) {
      if (owned === agent) return chatKey
    }
    return undefined
  }

  /** 这个 chat 现在是不是有回合在跑。 */
  isRunning(chatKey: string): boolean {
    const agent = this.agents.get(chatKey)
    if (agent === undefined) return false
    return this.turns.has(String(agent.session.id))
  }

  /**
   * 会话事件入口。不是本插件开的会话直接返回——同一个进程里 Web UI 的会话
   * 也在发事件。
   * @param session - 事件所属会话。
   * @param event - 会话事件。
   */
  handleSessionEvent(session: Session, event: SessionEvent): void {
    const turn = this.turns.get(String(session.header.id))
    if (turn === undefined) return
    const added = turn.renderer.apply(event)
    const boundary = event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end'
    if (event.type === 'tool/call') {
      turn.stage = `调用 ${(event as SessionEvent<'tool/call'>).data.name}`
    } else if (event.type === 'tool/result') {
      turn.stage = '整理结果'
    }
    if (added === '' && !boundary) return
    // 阶段边界立刻推，纯文本增长按节流推。
    if (boundary) this.flush(turn)
    else this.scheduleFlush(turn)
  }

  /** 释放：停掉所有定时器。agent 本身归 dsh 的 fiber 管，不在这里 dispose。 */
  dispose(): void {
    for (const [, turn] of this.turns) {
      if (turn.timer !== undefined) clearTimeout(turn.timer)
    }
    this.turns.clear()
    this.agents.clear()
  }

  private scheduleFlush(turn: ActiveTurn): void {
    if (turn.timer !== undefined) return
    const wait = Math.max(0, this.flushMs - (this.now() - turn.lastFlush))
    turn.timer = setTimeout(() => { turn.timer = undefined; this.flush(turn) }, wait)
    turn.timer.unref()
  }

  private flush(turn: ActiveTurn): void {
    if (turn.timer !== undefined) {
      clearTimeout(turn.timer)
      turn.timer = undefined
    }
    const text = turn.renderer.text
    if (turn.cardId === undefined || text === turn.lastText) return
    turn.lastText = text
    turn.lastFlush = this.now()
    this.options.sink.update(turn.cardId, turn.stage, text)
  }
}
