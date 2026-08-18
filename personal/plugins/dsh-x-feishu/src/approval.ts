/**
 * 工具审批：把 dsh 的 `approval/request` 接到飞书卡片按钮上。
 *
 * 写法照抄 `packages/acp/acp/src/index.ts` 的答复者：不是自己的会话一律
 * `next()` 交给下游，绝不替别人的 agent 拿主意。同一个进程里 Web UI 的会话
 * 也在用这条瀑布，抢答会让浏览器那边的审批框永远弹不出来。
 *
 * 没人点、超时、桥接断了，一律按**拒绝**收场。审批 seam 的规矩是失败关闭，
 * 而"没人回答"就是一种失败。
 *
 * @module @personal/dsh-x-feishu/src/approval
 */

import { randomUUID } from 'node:crypto'

/** `ctx.approval` 认的结论。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled'

/** 一次等着人点的审批。 */
interface Pending {
  readonly chatKey: string
  readonly settle: (outcome: ApprovalOutcome) => void
  readonly timer: NodeJS.Timeout
}

/** 卡片按钮回传的值。 */
export interface ApprovalVote {
  readonly kind: 'approval'
  readonly askId: string
  readonly decision: 'allow' | 'reject'
}

/** 判断一个按钮值是不是审批投票。 */
export function isApprovalVote(value: unknown): value is ApprovalVote {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.kind === 'approval'
    && typeof record.askId === 'string'
    && (record.decision === 'allow' || record.decision === 'reject')
}

/** 发审批卡片的通道。 */
export interface AskSink {
  /**
   * 发一张审批卡片。
   * @param chatKey - 发到哪个会话。
   * @param askId - 按钮里要带回来的 id。
   * @param title - 要批的动作。
   * @param detail - 补充信息。
   */
  ask(chatKey: string, askId: string, title: string, detail: string): Promise<void>
}

/** 默认等人点的上限。 */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000

/** 审批中介。 */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>()

  /**
   * @param sink - 发卡片的通道。
   * @param timeoutMs - 等人点的上限，超时按拒绝。
   */
  constructor(
    private readonly sink: AskSink,
    private readonly timeoutMs: number = DEFAULT_ASK_TIMEOUT_MS,
  ) {}

  /**
   * 发起一次审批并等结果。
   * @param chatKey - 发到哪个会话。
   * @param title - 要批的动作，通常是工具名。
   * @param detail - 补充信息，通常是参数摘要。
   * @returns 人点出来的结论；超时或发不出去都按拒绝。
   */
  async request(
    chatKey: string,
    title: string,
    detail: string,
    signal?: AbortSignal,
  ): Promise<ApprovalOutcome> {
    const askId = randomUUID()
    return new Promise<ApprovalOutcome>((resolve) => {
      let done = false
      const settle = (outcome: ApprovalOutcome): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.pending.delete(askId)
        resolve(outcome)
      }
      // 发起方撤回问题时立刻按取消收场，晚到的点击会被 pending 里没有这条挡掉。
      const onAbort = (): void => { settle('cancelled') }
      const timer = setTimeout(() => { settle('rejected') }, this.timeoutMs)
      timer.unref()
      if (signal?.aborted === true) { settle('cancelled'); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(askId, { chatKey, settle, timer })
      this.sink.ask(chatKey, askId, title, detail).catch(() => {
        // 卡片发不出去，人就没机会点。失败关闭。
        settle('rejected')
      })
    })
  }

  /**
   * 按钮回来了。
   * @param vote - 按钮携带的值。
   * @returns 确实对上了一次等待中的审批为 `true`。
   */
  resolve(vote: ApprovalVote): boolean {
    const entry = this.pending.get(vote.askId)
    if (entry === undefined) return false
    entry.settle(vote.decision === 'allow' ? 'allowed-once' : 'rejected')
    return true
  }

  /** 这个会话还有几个审批等着。 */
  pendingCount(): number {
    return this.pending.size
  }

  /** 全部按取消收场，用于插件卸载或桥接断开。 */
  dispose(): void {
    for (const [, entry] of [...this.pending]) entry.settle('cancelled')
    this.pending.clear()
  }
}
