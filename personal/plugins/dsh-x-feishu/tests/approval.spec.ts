import { describe, expect, it, vi } from 'vitest'
import { ApprovalBroker, isApprovalVote, type AskSink } from '../src/approval.ts'

/** 记下发出去的卡片，并允许测试拿到 askId 去"点按钮"。 */
function recordingSink(): AskSink & { asks: { chatKey: string; askId: string; title: string }[] } {
  const asks: { chatKey: string; askId: string; title: string }[] = []
  return {
    asks,
    ask(chatKey, askId, title) {
      asks.push({ chatKey, askId, title })
      return Promise.resolve()
    },
  }
}

describe('isApprovalVote', () => {
  it('只认形状对的值', () => {
    expect(isApprovalVote({ kind: 'approval', askId: 'a', decision: 'allow' })).toBe(true)
    expect(isApprovalVote({ kind: 'approval', askId: 'a', decision: 'maybe' })).toBe(false)
    expect(isApprovalVote({ kind: 'stop', chatKey: 'oc_1' })).toBe(false)
    expect(isApprovalVote(null)).toBe(false)
    expect(isApprovalVote('approval')).toBe(false)
  })
})

describe('ApprovalBroker', () => {
  it('点允许就放行一次', async () => {
    const sink = recordingSink()
    const broker = new ApprovalBroker(sink)
    const pending = broker.request('oc_1', 'bash', '要跑一条命令')
    await Promise.resolve()
    expect(sink.asks).toHaveLength(1)
    expect(sink.asks[0]!.title).toBe('bash')

    broker.resolve({ kind: 'approval', askId: sink.asks[0]!.askId, decision: 'allow' })
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('点拒绝就拒绝', async () => {
    const sink = recordingSink()
    const broker = new ApprovalBroker(sink)
    const pending = broker.request('oc_1', 'bash', '')
    await Promise.resolve()
    broker.resolve({ kind: 'approval', askId: sink.asks[0]!.askId, decision: 'reject' })
    await expect(pending).resolves.toBe('rejected')
  })

  it('没人点就超时，按拒绝收场——审批 seam 的规矩是失败关闭', async () => {
    vi.useFakeTimers()
    try {
      const broker = new ApprovalBroker(recordingSink(), () => 1000)
      const pending = broker.request('oc_1', 'bash', '')
      await vi.advanceTimersByTimeAsync(1001)
      await expect(pending).resolves.toBe('rejected')
    } finally {
      vi.useRealTimers()
    }
  })

  it('卡片发不出去时立刻拒绝，不让工具挂在那儿等', async () => {
    const broker = new ApprovalBroker({ ask: () => Promise.reject(new Error('桥接断了')) })
    await expect(broker.request('oc_1', 'bash', '')).resolves.toBe('rejected')
  })

  it('发起方撤回问题时按取消收场', async () => {
    const controller = new AbortController()
    const broker = new ApprovalBroker(recordingSink())
    const pending = broker.request('oc_1', 'bash', '', controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
  })

  it('已经中止的 signal 直接取消，不发卡片', async () => {
    const sink = recordingSink()
    const controller = new AbortController()
    controller.abort()
    const broker = new ApprovalBroker(sink)
    await expect(broker.request('oc_1', 'bash', '', controller.signal)).resolves.toBe('cancelled')
    expect(sink.asks).toHaveLength(0)
  })

  it('过期的点击对不上任何等待，返回 false', async () => {
    const sink = recordingSink()
    const broker = new ApprovalBroker(sink)
    const pending = broker.request('oc_1', 'bash', '')
    await Promise.resolve()
    const askId = sink.asks[0]!.askId
    broker.resolve({ kind: 'approval', askId, decision: 'allow' })
    await pending
    expect(broker.resolve({ kind: 'approval', askId, decision: 'reject' })).toBe(false)
  })

  it('同一次审批被点两次，只有第一次算数', async () => {
    const sink = recordingSink()
    const broker = new ApprovalBroker(sink)
    const pending = broker.request('oc_1', 'bash', '')
    await Promise.resolve()
    const askId = sink.asks[0]!.askId
    broker.resolve({ kind: 'approval', askId, decision: 'allow' })
    broker.resolve({ kind: 'approval', askId, decision: 'reject' })
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('多个审批并存，各回各的', async () => {
    const sink = recordingSink()
    const broker = new ApprovalBroker(sink)
    const first = broker.request('oc_1', 'bash', '')
    const second = broker.request('oc_2', 'str_replace_editor', '')
    await Promise.resolve()
    expect(broker.pendingCount()).toBe(2)

    broker.resolve({ kind: 'approval', askId: sink.asks[1]!.askId, decision: 'allow' })
    broker.resolve({ kind: 'approval', askId: sink.asks[0]!.askId, decision: 'reject' })
    await expect(first).resolves.toBe('rejected')
    await expect(second).resolves.toBe('allowed-once')
  })

  it('卸载时把等着的全部取消', async () => {
    const sink = recordingSink()
    const broker = new ApprovalBroker(sink)
    const pending = broker.request('oc_1', 'bash', '')
    await Promise.resolve()
    broker.dispose()
    await expect(pending).resolves.toBe('cancelled')
    expect(broker.pendingCount()).toBe(0)
  })
})
