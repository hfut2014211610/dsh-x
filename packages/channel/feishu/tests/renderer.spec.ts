import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TurnRenderer } from '../src/renderer.ts'

let seq = 0

/** 造一个会话事件；只填渲染器读的字段。 */
function ev(type: string, data: unknown): SessionEvent {
  seq += 1
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

const assistantMessage = (text: string, turn = 1, step = 1): SessionEvent =>
  ev('assistant/message', {
    turn,
    step,
    message: { content: [{ type: 'text', text }] },
    stream: [],
  })

const toolCall = (callId: string, name: string, args = '{}'): SessionEvent =>
  ev('tool/call', { turn: 1, step: 1, callId, name, arguments: args })

const toolResult = (callId: string, error?: { name: string; code: string }): SessionEvent =>
  ev('tool/result', { turn: 1, step: 1, message: { callId }, error })

const turnEnd = (reason: unknown): SessionEvent => ev('turn/end', { turn: 1, reason })

describe('TurnRenderer', () => {
  it('多步消息拼成正文', () => {
    const renderer = new TurnRenderer()
    renderer.apply(assistantMessage('你好', 1, 1))
    renderer.apply(assistantMessage('，世界', 1, 2))
    expect(renderer.text).toBe('你好，世界')
  })

  it('输出只增不改——卡片打字机要求新文本是旧文本的延长', () => {
    const renderer = new TurnRenderer()
    const snapshots: string[] = []
    for (const event of [assistantMessage('一', 1, 1), toolCall('c1', 'bash'), toolResult('c1'), assistantMessage('二', 1, 2)]) {
      renderer.apply(event)
      snapshots.push(renderer.text)
    }
    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i]!.startsWith(snapshots[i - 1]!)).toBe(true)
    }
  })

  it('apply 返回的是本次新增那段', () => {
    const renderer = new TurnRenderer()
    expect(renderer.apply(assistantMessage('abc'))).toBe('abc')
    expect(renderer.apply(ev('request/header', {}))).toBe('')
  })

  it('standard 密度显示工具名，不显示参数', () => {
    const renderer = new TurnRenderer()
    renderer.apply(toolCall('c1', 'str_replace_editor', '{"path":"a.ts"}'))
    expect(renderer.text).toContain('str_replace_editor')
    expect(renderer.text).not.toContain('a.ts')
  })

  it('detailed 密度带上参数摘要', () => {
    const renderer = new TurnRenderer({ density: 'detailed', argPreview: 80 })
    renderer.apply(toolCall('c1', 'bash', '{"cmd":"pnpm test"}'))
    expect(renderer.text).toContain('pnpm test')
  })

  it('compact 密度只出正文，工具行全不要', () => {
    const renderer = new TurnRenderer({ density: 'compact', argPreview: 80 })
    renderer.apply(assistantMessage('结果是 42'))
    renderer.apply(toolCall('c1', 'bash'))
    renderer.apply(toolResult('c1'))
    expect(renderer.text).toBe('结果是 42')
  })

  it('推理块不进正文，只出文本块', () => {
    const renderer = new TurnRenderer({ density: 'detailed', argPreview: 80 })
    renderer.apply(ev('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'reasoning', text: '先看看' }, { type: 'text', text: '结论' }] },
      stream: [],
    }))
    expect(renderer.text).toBe('结论')
  })

  it('工具成功缀对勾，失败缀错误码', () => {
    const ok = new TurnRenderer()
    ok.apply(toolCall('c1', 'bash'))
    ok.apply(toolResult('c1'))
    expect(ok.text).toContain('✓')

    const bad = new TurnRenderer()
    bad.apply(toolCall('c2', 'bash'))
    bad.apply(toolResult('c2', { name: 'Error', code: 'EPERM' }))
    expect(bad.text).toContain('EPERM')
  })

  it('没见过调用行的结果不写标记，免得凭空冒出对勾', () => {
    const renderer = new TurnRenderer()
    expect(renderer.apply(toolResult('never-seen'))).toBe('')
  })

  it('整条消息直接渲染', () => {
    const renderer = new TurnRenderer()
    renderer.apply(ev('assistant/message', {
      turn: 1, step: 1, message: { content: [{ type: 'text', text: '非流式的回答' }] }, stream: [],
    }))
    expect(renderer.text).toBe('非流式的回答')
  })

  it('正常结束不往正文里加东西', () => {
    const renderer = new TurnRenderer()
    renderer.apply(assistantMessage('好了'))
    renderer.apply(turnEnd({ kind: 'completed' }))
    expect(renderer.text).toBe('好了')
    expect(renderer.finished).toEqual({ kind: 'completed' })
  })

  it('取消的原因是 aborted 不是 cancelled', () => {
    const renderer = new TurnRenderer()
    renderer.apply(turnEnd({ kind: 'aborted', reason: { kind: 'user' } }))
    expect(renderer.finished?.kind).toBe('aborted')
    expect(renderer.text).toContain('已停止')
  })

  it('出错时把错误码和消息带给用户', () => {
    const renderer = new TurnRenderer()
    renderer.apply(turnEnd({ kind: 'error', error: { code: 'RATE_LIMIT', message: '太快了' } }))
    expect(renderer.finished).toEqual({ kind: 'error', message: 'RATE_LIMIT: 太快了' })
    expect(renderer.text).toContain('RATE_LIMIT')
    expect(renderer.text).toContain('太快了')
  })

  it('blocked / max-tokens / interrupted 都有着落，不会当成没结束', () => {
    for (const kind of ['blocked', 'max-tokens', 'interrupted'] as const) {
      const renderer = new TurnRenderer()
      renderer.apply(turnEnd({ kind }))
      expect(renderer.finished?.kind).toBe(kind)
    }
  })

  it('重试在 standard 下看得见', () => {
    const renderer = new TurnRenderer()
    renderer.apply(ev('llm/retry', {}))
    expect(renderer.text).toContain('重试')
  })
})
