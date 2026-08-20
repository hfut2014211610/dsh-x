/**
 * 把 dsh 的会话事件渲染成飞书卡片里的文本。
 *
 * 输出**只增不改**。CardKit 的打字机效果要求新文本是旧文本的延长，所以这里
 * 的每条规则都只往后追加，不回头改已经写出去的内容：工具调用先写一行
 * "在调 X"，结果到了再往后缀一个对勾，而不是把那一行重写成"X 完成"。
 *
 * 纯逻辑，不碰飞书 SDK，也不碰 dsh 服务——`apply` 吃一个事件、吐一段新增文本，
 * 因此整套渲染规则可以拿构造出来的事件数组单测。
 *
 * @module @deepseek-ai/dsh-feishu/renderer
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 展示密度。 */
export type Density = 'compact' | 'standard' | 'detailed'

/** 渲染选项。 */
export interface RenderOptions {
  /** `compact` 只出正文；`standard` 加工具行；`detailed` 再加推理与参数摘要。 */
  readonly density: Density
  /** 工具参数摘要保留的最大字符数。 */
  readonly argPreview: number
}

/** 默认选项。 */
export const DEFAULT_RENDER_OPTIONS: RenderOptions = { density: 'standard', argPreview: 80 }

/**
 * 一次回合结束的结论。取值跟 `TurnEndReasonMap` 的 `kind` 对齐，`other` 兜住
 * 上游以后合并进来的新变体。
 */
export interface TurnOutcome {
  readonly kind: 'completed' | 'aborted' | 'blocked' | 'max-tokens' | 'interrupted' | 'error' | 'other'
  readonly message?: string
}

/** 从 `text-delta` 类型的流块里取出文本，其它形状返回 `undefined`。 */
function textDeltaOf(chunk: unknown): string | undefined {
  if (typeof chunk !== 'object' || chunk === null) return undefined
  const record = chunk as Record<string, unknown>
  if (record.type !== 'text-delta') return undefined
  return typeof record.text === 'string' ? record.text : undefined
}

/** 从 `reasoning-delta` 类型的流块里取出文本。 */
function reasoningDeltaOf(chunk: unknown): string | undefined {
  if (typeof chunk !== 'object' || chunk === null) return undefined
  const record = chunk as Record<string, unknown>
  if (record.type !== 'reasoning-delta') return undefined
  return typeof record.text === 'string' ? record.text : undefined
}

/** 把工具参数压成一行摘要。 */
function summarizeArguments(raw: string, limit: number): string {
  const flat = raw.replace(/\s+/gu, ' ').trim()
  if (flat === '' || flat === '{}') return ''
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

/**
 * 一个回合的渲染器。一条飞书消息配一个实例，回合结束即弃用。
 */
export class TurnRenderer {
  private buffer = ''
  private outcome: TurnOutcome | undefined
  /** 已经收到过流块的 `turn:step`，用来决定要不要拿整条消息补底。 */
  private readonly streamedSteps = new Set<string>()
  /** 已经写过工具行、还没写结果的 callId。 */
  private readonly openCalls = new Set<string>()

  /**
   * @param options - 渲染选项。
   */
  constructor(private readonly options: RenderOptions = DEFAULT_RENDER_OPTIONS) {}

  /** 到目前为止的完整文本。 */
  get text(): string {
    return this.buffer
  }

  /** 回合结束了没有；结束时带上结论。 */
  get finished(): TurnOutcome | undefined {
    return this.outcome
  }

  /**
   * 吃一个会话事件。
   * @param event - 会话事件。
   * @returns 本次新增的文本；这个事件不产生可见内容时是空串。
   */
  apply(event: SessionEvent): string {
    const added = this.render(event)
    if (added !== '') this.buffer += added
    return added
  }

  private render(event: SessionEvent): string {
    // `llm/retry` 由重试插件用模块合并声明，本包不 import 它，所以在这里
    // 它不在 SessionEventType 的静态联合里——按字符串比，不按字面量类型比。
    const type: string = event.type
    switch (type) {
      case 'assistant/chunk':
        return this.renderChunk(event as SessionEvent<'assistant/chunk'>)
      case 'assistant/message':
        return this.renderMessage(event as SessionEvent<'assistant/message'>)
      case 'tool/call':
        return this.renderCall(event as SessionEvent<'tool/call'>)
      case 'tool/result':
        return this.renderResult(event as SessionEvent<'tool/result'>)
      case 'llm/retry':
        return this.options.density === 'compact' ? '' : '\n\n⟳ 模型请求失败，重试中…\n'
      case 'turn/end':
        return this.renderTurnEnd(event as SessionEvent<'turn/end'>)
      default:
        return ''
    }
  }

  private renderChunk(event: SessionEvent<'assistant/chunk'>): string {
    const { turn, step, chunk } = event.data
    const text = textDeltaOf(chunk)
    if (text !== undefined) {
      this.streamedSteps.add(`${turn}:${step}`)
      return text
    }
    if (this.options.density !== 'detailed') return ''
    const reasoning = reasoningDeltaOf(chunk)
    return reasoning === undefined ? '' : reasoning
  }

  /**
   * 整条助手消息只在**这一步一个流块都没来过**时才用来补底。
   * 适配器不流式输出时（或者流被中断后重放），光靠流块会渲染出空白。
   */
  private renderMessage(event: SessionEvent<'assistant/message'>): string {
    const { turn, step, message } = event.data
    if (this.streamedSteps.has(`${turn}:${step}`)) return ''
    const joined = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
    return joined
  }

  private renderCall(event: SessionEvent<'tool/call'>): string {
    if (this.options.density === 'compact') return ''
    const { callId, name, arguments: args } = event.data
    this.openCalls.add(String(callId))
    const head = `\n\n🔧 ${name}`
    if (this.options.density !== 'detailed') return `${head}\n`
    const summary = summarizeArguments(args, this.options.argPreview)
    return summary === '' ? `${head}\n` : `${head} \`${summary}\`\n`
  }

  private renderResult(event: SessionEvent<'tool/result'>): string {
    if (this.options.density === 'compact') return ''
    const { message, error } = event.data
    const raw = (message as { callId?: unknown }).callId
    const callId = typeof raw === 'string' ? raw : ''
    // 没见过对应的调用行就不写结果标记，免得凭空冒出一个对勾。
    if (callId !== '' && !this.openCalls.delete(callId)) return ''
    return error === undefined ? '✓\n' : `✗ ${error.code}\n`
  }

  /**
   * 五种收场都要有着落。取消是 `aborted` 不是 `cancelled`——用错名字的后果是
   * 卡片永远停在"进行中"，因为没人把它收尾。
   */
  private renderTurnEnd(event: SessionEvent<'turn/end'>): string {
    const reason = event.data.reason
    switch (reason.kind) {
      case 'completed':
        this.outcome = { kind: 'completed' }
        return ''
      case 'aborted':
        this.outcome = { kind: 'aborted' }
        return '\n\n⏹ 已停止。\n'
      case 'blocked':
        this.outcome = { kind: 'blocked' }
        return '\n\n🚫 被拦下了，没有继续。\n'
      case 'max-tokens':
        this.outcome = { kind: 'max-tokens' }
        return '\n\n✂️ 输出到上限了，内容可能不完整。\n'
      case 'interrupted':
        // 进程崩过，这一回合是重启后由持久化补上的收尾。
        this.outcome = { kind: 'interrupted' }
        return '\n\n⚠️ 上次没跑完就中断了。\n'
      case 'error': {
        const { code, message } = reason.error
        this.outcome = { kind: 'error', message: `${code}: ${message}` }
        return `\n\n⚠️ 出错了：${code} — ${message}\n`
      }
      default:
        this.outcome = { kind: 'other' }
        return ''
    }
  }
}
