/**
 * 连上桥接的头几帧。
 *
 * 复用别人的桥接时，dsh 要说的只有一句：我是哪个飞书应用。说漏了的后果不是
 * 报错——是桥接把别人机器人的消息也转过来，两个 agent 抢着答同一句话。所以
 * 这一组盯的就是"这句话有没有说、说的是不是当时那个值"。
 *
 * 用真的 socket 而不是假客户端：这条线上出过的问题全在编解码和时序上，
 * 换成假的就正好把要测的那一段换掉了。
 */

import { createServer, type Server, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeClient } from '../src/client.ts'
import { PROTOCOL_VERSION, encodeFrame, type BridgeSummary, type HelloFrame } from '../src/protocol.ts'

/** 一个假桥接：记下收到的每一帧，并能主动发。 */
interface FakeBridge {
  readonly endpoint: string
  readonly frames: Record<string, unknown>[]
  /** 往当前连接上发一帧。 */
  push: (frame: unknown) => void
  close: () => Promise<void>
}

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) await rm(temp, { recursive: true, force: true })
  temp = undefined
})

let counter = 0

async function fakeBridge(): Promise<FakeBridge> {
  counter += 1
  let endpoint: string
  if (process.platform === 'win32') {
    endpoint = `\\\\.\\pipe\\dsh-x-feishu-test-${process.pid}-${counter}`
  } else {
    temp = await mkdtemp(join(tmpdir(), 'dsh-x-feishu-test-'))
    endpoint = join(temp, `bridge-${counter}.sock`)
  }
  const frames: Record<string, unknown>[] = []
  let client: Socket | undefined
  let buffer = ''
  const server: Server = createServer((socket) => {
    client = socket
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line !== '') frames.push(JSON.parse(line) as Record<string, unknown>)
        index = buffer.indexOf('\n')
      }
    })
  })
  await new Promise<void>((resolve) => { server.listen(endpoint, () => { resolve() }) })
  return {
    endpoint,
    frames,
    push: (frame: unknown) => { client?.write(encodeFrame(frame)) },
    close: () => new Promise<void>((resolve) => {
      client?.destroy()
      server.close(() => { resolve() })
    }),
  }
}

/** 等到断言成立，或者等够为止。socket 上没有可以 await 的时刻。 */
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
}

const handlers = {
  onMessage: () => {},
  onCardAction: () => {},
  onReady: () => {},
  onDisconnect: () => {},
  onError: () => {},
}

describe('报身份', () => {
  it('连上的第一帧就说自己是哪个应用', async () => {
    const bridge = await fakeBridge()
    const client = new BridgeClient(() => bridge.endpoint, () => '/lark/dsh-x', handlers)

    client.connect()
    await until(() => bridge.frames.length > 0)

    expect(bridge.frames[0]).toEqual({
      v: PROTOCOL_VERSION,
      kind: 'announce',
      configDir: '/lark/dsh-x',
    })
    client.dispose()
    await bridge.close()
  })

  // 还没定身份的时候报空串，而不是不报：桥接据此知道"它连上了但还没说自己是谁"，
  // 于是一条都不转——总比替它猜一个、结果顶着别人的应用说话强。
  it('还没定就报空串', async () => {
    const bridge = await fakeBridge()
    const client = new BridgeClient(() => bridge.endpoint, () => '', handlers)

    client.connect()
    await until(() => bridge.frames.length > 0)

    expect(bridge.frames[0]).toMatchObject({ kind: 'announce', configDir: '' })
    client.dispose()
    await bridge.close()
  })

  it('身份改了就重报一次，不用重连', async () => {
    const bridge = await fakeBridge()
    let identity = '/lark/dsh-x'
    const client = new BridgeClient(() => bridge.endpoint, () => identity, handlers)
    client.connect()
    await until(() => bridge.frames.length > 0)

    identity = '/lark/agent-bus'
    expect(client.reannounceIfChanged(identity)).toBe(true)
    await until(() => bridge.frames.length > 1)

    expect(bridge.frames[1]).toMatchObject({ kind: 'announce', configDir: '/lark/agent-bus' })
    client.dispose()
    await bridge.close()
  })

  it('没改就不重报', async () => {
    const bridge = await fakeBridge()
    const client = new BridgeClient(() => bridge.endpoint, () => '/lark/dsh-x', handlers)
    client.connect()
    await until(() => bridge.frames.length > 0)

    expect(client.reannounceIfChanged('/lark/dsh-x')).toBe(false)
    client.dispose()
    await bridge.close()
  })

  it('还没连上谈不上"改了"', async () => {
    const bridge = await fakeBridge()
    const client = new BridgeClient(() => bridge.endpoint, () => '/lark/dsh-x', handlers)

    expect(client.reannounceIfChanged('/lark/other')).toBe(false)
    client.dispose()
    await bridge.close()
  })
})

describe('握手带回来的现状', () => {
  const summary: BridgeSummary = {
    apps: ['/lark/dsh-x'],
    dmMode: 'allowlist',
    dmAllowed: 1,
    groupsAllowed: 0,
    requireMention: true,
  }

  it('桥接现在订着什么、放行谁，整帧交给上层', async () => {
    const bridge = await fakeBridge()
    const seen: HelloFrame[] = []
    const client = new BridgeClient(() => bridge.endpoint, () => '/lark/dsh-x', {
      ...handlers,
      onReady: (hello) => { seen.push(hello) },
    })
    client.connect()
    await until(() => bridge.frames.length > 0)

    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_bot', bridge: summary })
    await until(() => seen.length > 0)

    expect(seen[0]).toMatchObject({ botOpenId: 'ou_bot', bridge: summary })
    client.dispose()
    await bridge.close()
  })

  // 桥接在 dsh 报身份之后会再发一帧，那一帧的机器人才是 dsh 那个应用的。
  it('第二帧照收，不当成重复', async () => {
    const bridge = await fakeBridge()
    const seen: HelloFrame[] = []
    const client = new BridgeClient(() => bridge.endpoint, () => '/lark/dsh-x', {
      ...handlers,
      onReady: (hello) => { seen.push(hello) },
    })
    client.connect()
    await until(() => bridge.frames.length > 0)

    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_primary' })
    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_mine', bridge: summary })
    await until(() => seen.length > 1)

    expect(seen.map(hello => hello.botOpenId)).toEqual(['ou_primary', 'ou_mine'])
    client.dispose()
    await bridge.close()
  })

  it('老桥接不带现状也照样连上', async () => {
    const bridge = await fakeBridge()
    const onReady = vi.fn()
    const client = new BridgeClient(() => bridge.endpoint, () => '', { ...handlers, onReady })
    client.connect()
    await until(() => bridge.frames.length > 0)

    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_bot' })
    await until(() => onReady.mock.calls.length > 0)

    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ botOpenId: 'ou_bot' }))
    expect((onReady.mock.calls[0]?.[0] as HelloFrame).bridge).toBeUndefined()
    client.dispose()
    await bridge.close()
  })
})
