import { describe, expect, it } from 'vitest'
import { FrameDecoder, PROTOCOL_VERSION, defaultEndpoint, encodeFrame } from '../src/protocol.ts'
import { EVENT_RELAY_VERSION, defaultEventRelayEndpoint, encodeEventRelayFrame } from '../bridge/relay.ts'

describe('encodeFrame', () => {
  it('一帧一行', () => {
    expect(encodeFrame({ v: PROTOCOL_VERSION, kind: 'reply' })).toBe('{"v":1,"kind":"reply"}\n')
  })
})

describe('FrameDecoder', () => {
  it('一次给多行就吐多帧', () => {
    const decoder = new FrameDecoder()
    expect(decoder.push('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('半行先攒着，凑齐了再吐——socket 会把一帧切成两次给', () => {
    const decoder = new FrameDecoder()
    expect(decoder.push('{"a":')).toEqual([])
    expect(decoder.push('1}\n')).toEqual([{ a: 1 }])
  })

  it('粘包：三帧挤在一次 data 里', () => {
    const decoder = new FrameDecoder()
    expect(decoder.push('{"a":1}\n{"a":2}\n{"a":3}\n')).toHaveLength(3)
  })

  it('坏行整行丢掉并计数，不把连接带崩', () => {
    const decoder = new FrameDecoder()
    expect(decoder.push('{"a":1}\nnot json\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
    expect(decoder.dropped).toBe(1)
  })

  it('空行不算帧也不算坏行', () => {
    const decoder = new FrameDecoder()
    expect(decoder.push('\n\n{"a":1}\n')).toEqual([{ a: 1 }])
    expect(decoder.dropped).toBe(0)
  })
})

describe('defaultEndpoint', () => {
  it('给出一个非空的本地端点', () => {
    const endpoint = defaultEndpoint()
    expect(endpoint.length).toBeGreaterThan(0)
    if (process.platform === 'win32') expect(endpoint.startsWith('\\\\.\\pipe\\')).toBe(true)
  })
})

describe('event relay', () => {
  it('给其他 Agent 一个独立的本地端点', () => {
    const endpoint = defaultEventRelayEndpoint()
    expect(endpoint.length).toBeGreaterThan(0)
    expect(endpoint).not.toBe(defaultEndpoint())
  })

  it('只广播一行带版本的原始事件', () => {
    expect(encodeEventRelayFrame({ type: 'im.message.receive_v1', message_id: 'om_1' }))
      .toBe(`{"v":${EVENT_RELAY_VERSION},"kind":"lark-event","event":{"type":"im.message.receive_v1","message_id":"om_1"}}\n`)
  })
})
