/**
 * 连上桥接之后这条线上传的是什么。
 *
 * 复用别人的桥接时，dsh 就是一个消费端：不报身份、不声明订阅、不配置对面。
 * 它要拿到的只有两样——桥接现在什么样（好显示出来），以及每条消息是从哪个飞书
 * 应用进来的（好让日志说得清是谁在说话）。
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
import {
  PROTOCOL_VERSION, encodeFrame,
  type BridgeSummary, type CardActionFrame, type HelloFrame, type MessageFrame,
} from '../src/protocol.ts'

/** 一个假桥接：记下收到的每一帧，并能主动发。 */
interface FakeBridge {
  readonly endpoint: string
  readonly frames: Record<string, unknown>[]
  /** 客户端连上没有。dsh 连上之后不出声，所以只能从服务端这边看。 */
  attached: () => boolean
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
    attached: () => client !== undefined,
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

const summary: BridgeSummary = {
  apps: ['/lark/default', '/lark/agent-bus'],
  dmMode: 'allowlist',
  dmAllowed: 1,
  groupsAllowed: 0,
  requireMention: true,
}

describe('连上之后', () => {
  // dsh 是消费端，不是配置端：连上就等着，不往对面报任何东西。
  it('什么都不往桥接报', async () => {
    const bridge = await fakeBridge()
    const client = new BridgeClient(() => bridge.endpoint, handlers)

    client.connect()
    await until(() => bridge.frames.length > 0, 300)

    expect(bridge.frames).toEqual([])
    client.dispose()
    await bridge.close()
  })

  it('桥接现在订着什么、放行谁，整帧交给上层', async () => {
    const bridge = await fakeBridge()
    const seen: HelloFrame[] = []
    const client = new BridgeClient(() => bridge.endpoint, {
      ...handlers,
      onReady: (hello) => { seen.push(hello) },
    })
    client.connect()
    await until(() => bridge.attached())

    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_bot', bridge: summary })
    await until(() => seen.length > 0)

    expect(seen[0]).toMatchObject({ botOpenId: 'ou_bot', bridge: summary })
    client.dispose()
    await bridge.close()
  })

  // 桥接的配置变了就会再发一帧，那时 dsh 手里那份现状已经过期了。
  it('第二帧照收，不当成重复', async () => {
    const bridge = await fakeBridge()
    const seen: HelloFrame[] = []
    const client = new BridgeClient(() => bridge.endpoint, {
      ...handlers,
      onReady: (hello) => { seen.push(hello) },
    })
    client.connect()
    await until(() => bridge.attached())

    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_a' })
    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_b', bridge: summary })
    await until(() => seen.length > 1)

    expect(seen.map(hello => hello.botOpenId)).toEqual(['ou_a', 'ou_b'])
    client.dispose()
    await bridge.close()
  })

  it('老桥接不带现状也照样连上', async () => {
    const bridge = await fakeBridge()
    const onReady = vi.fn()
    const client = new BridgeClient(() => bridge.endpoint, { ...handlers, onReady })
    client.connect()
    await until(() => bridge.attached())

    bridge.push({ v: PROTOCOL_VERSION, kind: 'hello', botOpenId: 'ou_bot' })
    await until(() => onReady.mock.calls.length > 0)

    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ botOpenId: 'ou_bot' }))
    expect((onReady.mock.calls[0]?.[0] as HelloFrame).bridge).toBeUndefined()
    client.dispose()
    await bridge.close()
  })
})

describe('每条消息带着来源', () => {
  // 一个桥接可能同时订着好几个飞书应用。插件不拿它做判断——回话的身份由桥接
  // 按会话查回来——但日志里得看得出这句话是从哪个机器人进来的。
  it('消息说得出是从哪个应用来的', async () => {
    const bridge = await fakeBridge()
    const seen: MessageFrame[] = []
    const client = new BridgeClient(() => bridge.endpoint, {
      ...handlers,
      onMessage: (frame) => { seen.push(frame) },
    })
    client.connect()
    await until(() => bridge.attached())

    bridge.push({
      v: PROTOCOL_VERSION,
      kind: 'message',
      source: '/lark/agent-bus',
      chatKey: 'oc_g',
      chatId: 'oc_g',
      chatType: 'group',
      messageId: 'om_1',
      senderId: 'ou_me',
      text: '在吗',
    })
    await until(() => seen.length > 0)

    expect(seen[0]).toMatchObject({ source: '/lark/agent-bus', text: '在吗' })
    client.dispose()
    await bridge.close()
  })

  it('卡片点击也说得出', async () => {
    const bridge = await fakeBridge()
    const seen: CardActionFrame[] = []
    const client = new BridgeClient(() => bridge.endpoint, {
      ...handlers,
      onCardAction: (frame) => { seen.push(frame) },
    })
    client.connect()
    await until(() => bridge.attached())

    bridge.push({
      v: PROTOCOL_VERSION,
      kind: 'card-action',
      source: '/lark/default',
      chatKey: 'oc_g',
      messageId: 'om_1',
      operatorId: 'ou_me',
      value: { kind: 'stop', chatKey: 'oc_g' },
    })
    await until(() => seen.length > 0)

    expect(seen[0]).toMatchObject({ source: '/lark/default', operatorId: 'ou_me' })
    client.dispose()
    await bridge.close()
  })
})
