/**
 * 出站以谁的身份发。
 *
 * 桥接可以同时接好几个飞书应用，入站按应用分开订阅。这一组盯的是"回话的身份
 * 与收到它的身份一致"——不一致的表现不是报错，而是 A 的机器人被 @、B 的机器人
 * 回话，以及卡片安静地更新不动（飞书只让发它的那个应用改它）。
 */

import { describe, expect, it } from 'vitest'
import { AppRouter } from '../src/app-routing.ts'

const AGENT_BUS = 'C:\\Users\\me\\.lark-cli\\agent-bus'
const DSH_X = 'C:\\Users\\me\\.lark-cli\\dsh-x'

describe('会话身份', () => {
  it('回哪个会话就用收到它的那个应用', () => {
    const router = new AppRouter(() => DSH_X)

    router.rememberChat('oc_group', 'oc_group', AGENT_BUS)

    expect(router.appOfChat('oc_group')).toBe(AGENT_BUS)
  })

  it('两个应用各记各的，互不串', () => {
    const router = new AppRouter(() => '')

    router.rememberChat('oc_a', 'oc_a', DSH_X)
    router.rememberChat('oc_b', 'oc_b', AGENT_BUS)

    expect(router.appOfChat('oc_a')).toBe(DSH_X)
    expect(router.appOfChat('oc_b')).toBe(AGENT_BUS)
  })

  // 群里的话题各自成一个会话，但它们来自同一个应用。
  it('同一个群的两个话题都跟着那个群的应用', () => {
    const router = new AppRouter(() => '')

    router.rememberChat('oc_g:th_1', 'oc_g', AGENT_BUS)
    router.rememberChat('oc_g:th_2', 'oc_g', AGENT_BUS)

    expect(router.chatId('oc_g:th_1')).toBe('oc_g')
    expect(router.appOfChat('oc_g:th_2')).toBe(AGENT_BUS)
  })

  it('没记过的会话退回 chatKey 本身，单聊里两者本来就相等', () => {
    const router = new AppRouter(() => '')

    expect(router.chatId('ou_someone')).toBe('ou_someone')
  })

  // 桥接重启过，插件却拿着上一轮的 chatKey 回来了。只能猜，但不能不吭声：
  // 猜错不报错，只是安静地用错身份发出去。
  it('认不出来源就落到兜底应用，并且说一声', () => {
    const guesses: string[] = []
    const router = new AppRouter(() => DSH_X, { onGuess: (chatKey) => { guesses.push(chatKey) } })

    expect(router.appOfChat('oc_forgotten')).toBe(DSH_X)
    expect(guesses).toEqual(['oc_forgotten'])
  })

  // 配置能热更，兜底应用会跟着变，所以它是读的时候现算的。
  it('兜底应用现读现算', () => {
    let primary = DSH_X
    const router = new AppRouter(() => primary)

    expect(router.appOfChat('oc_x')).toBe(DSH_X)
    primary = AGENT_BUS
    expect(router.appOfChat('oc_y')).toBe(AGENT_BUS)
  })
})

describe('卡片身份', () => {
  it('更新卡片用的是当初发它的那个应用', () => {
    const router = new AppRouter(() => DSH_X)

    router.rememberCard('card-1', { messageId: 'om_1', title: '正在处理', configDir: AGENT_BUS })

    expect(router.card('card-1')).toEqual({ messageId: 'om_1', title: '正在处理', configDir: AGENT_BUS })
  })

  // 会话的身份此后就算变了，这张卡片也只能由当初发它的那个应用改。
  it('卡片记的是发出那一刻的身份，不跟着会话走', () => {
    const router = new AppRouter(() => '')
    router.rememberChat('oc_g', 'oc_g', AGENT_BUS)
    router.rememberCard('card-1', { messageId: 'om_1', title: 'T', configDir: AGENT_BUS })

    router.rememberChat('oc_g', 'oc_g', DSH_X)

    expect(router.card('card-1')?.configDir).toBe(AGENT_BUS)
  })

  it('收尾之后就不记了，免得再发一次注定被拒的更新', () => {
    const router = new AppRouter(() => '')
    router.rememberCard('card-1', { messageId: 'om_1', title: 'T', configDir: DSH_X })

    router.forgetCard('card-1')

    expect(router.card('card-1')).toBeUndefined()
  })
})
