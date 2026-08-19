/**
 * 配置改了不用重建：连接器页那张卡片保存之后，跑着的插件下一次用到就该拿到
 * 新值。这一组盯的是"用到才读"这件事本身——每个可调项都从 thunk 里取，而不是
 * 在装配时抄进字段。
 */

import { describe, expect, it, vi } from 'vitest'
import { ApprovalBroker } from '../src/approval.ts'
import { BridgeClient } from '../src/client.ts'

const handlers = {
  onMessage: () => {},
  onCardAction: () => {},
  onReady: () => {},
  onDisconnect: () => {},
  onError: () => {},
}

describe('审批超时', () => {
  // 两次提问之间改了配置，第二次就该按新的等——如果构造时抄进字段，第二次还是老值。
  it('每次提问重新读上限', async () => {
    vi.useFakeTimers()
    try {
      let timeout = 1000
      const asked: string[] = []
      const broker = new ApprovalBroker({
        ask: (_chat, askId) => { asked.push(askId); return Promise.resolve() },
      }, () => timeout)

      const first = broker.request('chat', '工具', '', undefined)
      await vi.advanceTimersByTimeAsync(999)
      expect(await Promise.race([first, Promise.resolve('还在等')])).toBe('还在等')
      await vi.advanceTimersByTimeAsync(1)
      expect(await first).toBe('rejected')

      timeout = 5000
      const second = broker.request('chat', '工具', '', undefined)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await Promise.race([second, Promise.resolve('还在等')])).toBe('还在等')
      await vi.advanceTimersByTimeAsync(4000)
      expect(await second).toBe('rejected')

      broker.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('桥接端点', () => {
  // 端点是唯一一个拨号那一刻定死的值，所以它是唯一需要被通知的。
  it('端点没变就不重连', () => {
    const client = new BridgeClient(() => '\\\\.\\pipe\\dsh-feishu-test', () => '', handlers)
    client.connect()
    expect(client.redialIfMoved()).toBe(false)
    client.dispose()
  })

  it('端点变了要重连', () => {
    let endpoint = '\\\\.\\pipe\\dsh-feishu-a'
    const client = new BridgeClient(() => endpoint, () => '', handlers)
    client.connect()

    endpoint = '\\\\.\\pipe\\dsh-feishu-b'
    expect(client.redialIfMoved()).toBe(true)
    client.dispose()
  })

  // 还没拨过号的时候谈不上"变了"：第一次 connect() 本来就读当时的值，这里再
  // 拨一次只会多开一条连接。
  it('从没连过就不算变', () => {
    const client = new BridgeClient(() => '\\\\.\\pipe\\dsh-feishu-never', () => '', handlers)
    expect(client.redialIfMoved()).toBe(false)
    client.dispose()
  })

  it('关掉之后不再重连', () => {
    let endpoint = '\\\\.\\pipe\\dsh-feishu-a'
    const client = new BridgeClient(() => endpoint, () => '', handlers)
    client.connect()
    client.dispose()

    endpoint = '\\\\.\\pipe\\dsh-feishu-b'
    expect(client.redialIfMoved()).toBe(false)
  })
})
