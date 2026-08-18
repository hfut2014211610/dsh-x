import { describe, expect, it } from 'vitest'
import { botOpenIdOf, messageIdOf } from '../bridge/lark.ts'

describe('messageIdOf', () => {
  it('直接读取 lark-cli 成功信封解包后的 data.message_id', () => {
    expect(messageIdOf({ ok: true, data: { message_id: 'om_1' } })).toBe('om_1')
  })

  it('不递归猜测其他层级', () => {
    expect(messageIdOf({ ok: true, data: { nested: { message_id: 'om_wrong' } } })).toBeUndefined()
  })
})

describe('botOpenIdOf', () => {
  it('直接读取 bot/v3/info 原始响应的 bot.open_id', () => {
    expect(botOpenIdOf({ code: 0, msg: 'ok', bot: { open_id: 'ou_bot' } })).toBe('ou_bot')
  })

  it('不递归猜测其他 open_id', () => {
    expect(botOpenIdOf({ data: { open_id: 'ou_wrong' } })).toBeUndefined()
  })
})
