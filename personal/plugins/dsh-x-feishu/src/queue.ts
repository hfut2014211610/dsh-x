/**
 * 全局串行队列。
 *
 * 所有飞书会话共用同一个工作区，所以**同一时刻只能有一个回合在跑**。两个人
 * 同时让它改同一个仓库，不串行就是互相覆盖。`@larksuite/channel` 的
 * `chatQueue` 只保证同一个 chat 内部串行，跨 chat 的这层要自己来。
 *
 * 排队要给回执：让人干等而不说还有几个在前面，比排队本身更难受。
 *
 * @module @personal/dsh-x-feishu/src/queue
 */

/** 入队时告知排队情况的回调。 */
export type QueueNotice = (position: number) => void | Promise<void>

interface Waiter {
  readonly run: () => Promise<void>
  readonly notice: QueueNotice | undefined
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

/** 单并发的先进先出队列。 */
export class RunQueue {
  private readonly waiting: Waiter[] = []
  private running = false
  private disposed = false

  /** 正在跑的算不算在内：返回还没开始跑的任务数。 */
  get depth(): number {
    return this.waiting.length
  }

  /** 现在有没有任务在跑。 */
  get busy(): boolean {
    return this.running
  }

  /**
   * 入队一个任务。
   *
   * 前面有人在跑时先调 `notice`，把身位告诉调用方，让它去回一句"前面还有 N 个"。
   * 身位从 1 起算，0 表示直接开跑没排队。
   * @param run - 任务本体。
   * @param notice - 排队回执，只在真的要等时调用。
   * @returns 任务跑完后 resolve；任务抛错则 reject。
   */
  enqueue(run: () => Promise<void>, notice?: QueueNotice): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('队列已经关闭'))
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { run, notice, resolve, reject }
      this.waiting.push(waiter)
      if (this.running || this.waiting.length > 1) {
        // 身位 = 前面还有几个（含正在跑的那个）。
        const position = this.waiting.length - 1 + (this.running ? 1 : 0)
        void notice?.(position)
      }
      void this.pump()
    })
  }

  /**
   * 关闭队列：正在跑的那个跑完，还没开始的一律 reject。
   * 关闭之后再入队直接 reject。
   */
  dispose(): void {
    this.disposed = true
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()
      waiter?.reject(new Error('队列已经关闭'))
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const waiter = this.waiting.shift()
    if (waiter === undefined) return
    this.running = true
    try {
      await waiter.run()
      waiter.resolve()
    } catch (error: unknown) {
      waiter.reject(error)
    } finally {
      this.running = false
      // 用微任务续跑，避免在 catch 之后递归加深调用栈。
      if (this.waiting.length > 0) void Promise.resolve().then(() => this.pump())
    }
  }
}
