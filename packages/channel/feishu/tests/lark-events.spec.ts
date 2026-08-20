import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY, MessageDedup, admit, cardActionValue, chatKeyOf, mentionsBot, stripMentions,
  type AccessPolicy, type LarkMessageEvent,
} from '../src/lark-events.ts'

const BOT = 'ou_bot'
const NOW = 1_700_000_000_000

function event(overrides: Partial<LarkMessageEvent> = {}): LarkMessageEvent {
  return {
    type: 'im.message.receive_v1',
    chat_id: 'oc_1',
    chat_type: 'p2p',
    content: '帮我看下这个报错',
    create_time: String(NOW),
    message_id: 'om_1',
    sender_id: 'ou_alice',
    sender_type: 'user',
    ...overrides,
  }
}

function policy(overrides: Partial<AccessPolicy> = {}): AccessPolicy {
  return { ...DEFAULT_POLICY, dmMode: 'open', ...overrides }
}

describe('chatKeyOf', () => {
  it('单聊与群主线用 chatId', () => {
    expect(chatKeyOf('oc_1')).toBe('oc_1')
    expect(chatKeyOf('oc_1', '')).toBe('oc_1')
  })

  it('群里的话题各自成键，两个话题不会共用会话', () => {
    expect(chatKeyOf('oc_1', 'omt_a')).toBe('oc_1:omt_a')
    expect(chatKeyOf('oc_1', 'omt_a')).not.toBe(chatKeyOf('oc_1', 'omt_b'))
  })
})

describe('stripMentions', () => {
  it('删掉机器人自己的 @，其他人的还原成名字', () => {
    const text = stripMentions(
      '@_user_1 帮 @_user_2 看下',
      [{ id: BOT, key: '@_user_1', name: '小助手' }, { id: 'ou_bob', key: '@_user_2', name: 'Bob' }],
      BOT,
    )
    expect(text).toBe('帮 @Bob 看下')
  })

  it('没有提及时原样返回', () => {
    expect(stripMentions('  你好  ', undefined, BOT)).toBe('你好')
  })
})

describe('mentionsBot', () => {
  it('按 open_id 认，不按名字', () => {
    expect(mentionsBot(event({ mentions: [{ id: BOT, key: '@_user_1', name: '小助手' }] }), BOT)).toBe(true)
    expect(mentionsBot(event({ mentions: [{ id: 'ou_bob', key: '@_user_1', name: '小助手' }] }), BOT)).toBe(false)
    expect(mentionsBot(event(), BOT)).toBe(false)
  })
})

describe('cardActionValue', () => {
  it('把 action_value 的 JSON 字符串还原成按钮对象', () => {
    expect(cardActionValue({ action_value: '{"kind":"approval","askId":"a1","decision":"allow"}' }))
      .toEqual({ kind: 'approval', askId: 'a1', decision: 'allow' })
  })

  it('普通字符串保持原样，空值返回 undefined', () => {
    expect(cardActionValue({ action_value: 'stop' })).toBe('stop')
    expect(cardActionValue({})).toBeUndefined()
  })
})

describe('admit', () => {
  it('放行一条正常单聊消息并规整字段', () => {
    const result = admit(event(), policy(), BOT, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toMatchObject({
      chatKey: 'oc_1', chatId: 'oc_1', chatType: 'p2p', messageId: 'om_1',
      senderId: 'ou_alice', text: '帮我看下这个报错',
    })
  })

  it('机器人发的一律不接，防自问自答', () => {
    expect(admit(event({ sender_type: 'bot' }), policy(), BOT, NOW)).toEqual({ ok: false, reason: 'from-bot' })
    expect(admit(event({ sender_id: BOT }), policy(), BOT, NOW)).toEqual({ ok: false, reason: 'from-bot' })
  })

  it('缺关键字段算畸形，不往下走', () => {
    expect(admit({ ...event(), chat_id: '' }, policy(), BOT, NOW).ok).toBe(false)
    expect(admit(event({ message_id: '' }), policy(), BOT, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('太旧的消息丢掉，避免重连后重放一堆历史', () => {
    const old = event({ create_time: String(NOW - 20 * 60 * 1000) })
    expect(admit(old, policy(), BOT, NOW)).toEqual({ ok: false, reason: 'stale' })
  })

  it('默认策略是拒绝：名单空的时候单聊进不来', () => {
    expect(admit(event(), DEFAULT_POLICY, BOT, NOW)).toEqual({ ok: false, reason: 'sender-not-allowed' })
  })

  it('单聊按 open_id 走名单', () => {
    const allow = policy({ dmMode: 'allowlist', dmAllowlist: ['ou_alice'] })
    expect(admit(event(), allow, BOT, NOW).ok).toBe(true)
    expect(admit(event({ sender_id: 'ou_eve' }), allow, BOT, NOW))
      .toEqual({ ok: false, reason: 'sender-not-allowed' })
  })

  it('单聊可以整个关掉', () => {
    expect(admit(event(), policy({ dmMode: 'disabled' }), BOT, NOW))
      .toEqual({ ok: false, reason: 'dm-disabled' })
  })

  it('群不在名单里不接', () => {
    const group = event({ chat_type: 'group', mentions: [{ id: BOT, key: '@_user_1' }] })
    expect(admit(group, policy(), BOT, NOW)).toEqual({ ok: false, reason: 'group-not-allowed' })
  })

  it('群在名单里但没 @ 机器人时不吭声', () => {
    const group = event({ chat_type: 'group' })
    const allow = policy({ groupAllowlist: ['oc_1'] })
    expect(admit(group, allow, BOT, NOW)).toEqual({ ok: false, reason: 'no-mention' })
  })

  it('群里 @ 了就接活，并把 @ 从正文里剥掉', () => {
    const group = event({
      chat_type: 'group',
      content: '@_user_1 跑一下测试',
      mentions: [{ id: BOT, key: '@_user_1', name: '小助手' }],
    })
    const result = admit(group, policy({ groupAllowlist: ['oc_1'] }), BOT, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message.text).toBe('跑一下测试')
    expect(result.message.chatType).toBe('group')
  })

  it('requireMention 关掉后群里不 @ 也接', () => {
    const group = event({ chat_type: 'group' })
    const allow = policy({ groupAllowlist: ['oc_1'], requireMention: false })
    expect(admit(group, allow, BOT, NOW).ok).toBe(true)
  })

  it('只 @ 了机器人、没有别的字，不该建会话', () => {
    const group = event({
      chat_type: 'group',
      content: '@_user_1',
      mentions: [{ id: BOT, key: '@_user_1', name: '小助手' }],
    })
    expect(admit(group, policy({ groupAllowlist: ['oc_1'] }), BOT, NOW))
      .toEqual({ ok: false, reason: 'empty-text' })
  })

  it('群里的话题带上 threadId 进路由键', () => {
    const group = event({
      chat_type: 'group', thread_id: 'omt_x',
      content: '@_user_1 继续', mentions: [{ id: BOT, key: '@_user_1' }],
    })
    const result = admit(group, policy({ groupAllowlist: ['oc_1'] }), BOT, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message.chatKey).toBe('oc_1:omt_x')
  })
})

describe('MessageDedup', () => {
  it('按 message_id 去重，重投的同一条只跑一次', () => {
    const dedup = new MessageDedup()
    expect(dedup.admit('om_1', NOW)).toBe(true)
    expect(dedup.admit('om_1', NOW)).toBe(false)
    expect(dedup.admit('om_2', NOW)).toBe(true)
  })

  it('过了保留窗口就忘掉', () => {
    const dedup = new MessageDedup(1000)
    expect(dedup.admit('om_1', NOW)).toBe(true)
    expect(dedup.admit('om_1', NOW + 2000)).toBe(true)
  })

  it('条数封顶，不会无限涨', () => {
    const dedup = new MessageDedup(60_000, 3)
    for (const id of ['a', 'b', 'c', 'd']) dedup.admit(id, NOW)
    // 最旧的被挤掉，所以又算新的。
    expect(dedup.admit('a', NOW)).toBe(true)
    expect(dedup.admit('d', NOW)).toBe(false)
  })
})
