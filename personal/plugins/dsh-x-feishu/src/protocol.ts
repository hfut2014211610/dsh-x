/**
 * 桥接进程与 dsh 插件之间的本地协议。
 *
 * 传输是一条本地 socket（POSIX 走 unix socket，win32 走命名管道，node 的 `net`
 * 两边同一套 API），载荷是按行分隔的 JSON。协议刻意做得小：插件发的是**意图**
 * （回一句话、开一张进度卡、问一次审批），怎么落到飞书上由桥接决定，插件那半边
 * 因此完全不需要知道 lark-cli 的存在。
 *
 * 连接本身就是活性信号：连着就是 dsh 活着，断了就是 dsh 没了。桥接不靠心跳
 * 文件也不探 pid——一个跑了很久的回合会把 dsh 的事件循环占住，但 socket 照样
 * 连着，这正是"不该接管"的情形，用连接状态判断天然就对。
 *
 * 这个文件被两个进程共用，所以**只放类型和纯函数**，不 import 任何 dsh 包，
 * 也不 import 任何第三方包。
 *
 * @module @personal/dsh-x-feishu/src/protocol
 */

/** 协议版本。两端不一致时握手直接拒绝，不做兼容猜测。 */
export const PROTOCOL_VERSION = 1

/** 默认的本地端点路径。 */
export function defaultEndpoint(): string {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\dsh-x-feishu'
    : `${process.env.XDG_RUNTIME_DIR ?? '/tmp'}/dsh-x-feishu.sock`
}

/**
 * 桥接现在的样子。
 *
 * 复用别人的桥接时，这些**都不归 dsh 改**——它只是把现状显示出来，让人知道
 * 自己连上的是什么。所以这里给的是够显示的粒度，不是够编辑的粒度。
 */
export interface BridgeSummary {
  /** 桥接现在订着哪几个应用（lark-cli profile 目录）。 */
  readonly apps: readonly string[]
  /** 单聊准入模式。 */
  readonly dmMode: 'open' | 'allowlist' | 'disabled'
  /** 单聊白名单有几个人。 */
  readonly dmAllowed: number
  /** 放行了几个群。 */
  readonly groupsAllowed: number
  /** 群里是否必须 @ 到机器人。 */
  readonly requireMention: boolean
}

/**
 * 桥接 → 插件：握手，插件据此校验版本、拿到机器人身份和桥接现状。
 *
 * 会发不止一次：插件报了自己是哪个应用（{@link AnnounceCommand}）之后，桥接
 * 再发一帧，这一帧的 `botOpenId` 才是**插件那个应用**的机器人。第一帧发在
 * 插件开口之前，那时桥接只能先给主应用的。
 */
export interface HelloFrame {
  readonly v: number
  readonly kind: 'hello'
  /** 机器人自己的 open_id，插件判 @ 时要用。 */
  readonly botOpenId: string
  /** 桥接现状；老桥接没有这个字段。 */
  readonly bridge?: BridgeSummary
}

/** 桥接 → 插件：一条进来的消息。白名单与 @ 判定已经在桥接侧过掉了。 */
export interface MessageFrame {
  readonly v: number
  readonly kind: 'message'
  /** 会话容器键，由桥接算好（单聊是 chatId，群里话题带 threadId）。 */
  readonly chatKey: string
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly threadId?: string
  /** 飞书消息 id，回复要引用它；也是去重键。 */
  readonly messageId: string
  readonly senderId: string
  readonly senderName?: string
  /** 已经剥掉 @机器人 前缀的正文。 */
  readonly text: string
}

/** 桥接 → 插件：卡片按钮被点了。 */
export interface CardActionFrame {
  readonly v: number
  readonly kind: 'card-action'
  readonly chatKey: string
  readonly messageId: string
  readonly operatorId: string
  /** 按钮携带的值，由插件当初发卡片时放进去。 */
  readonly value: unknown
}

/** 桥接 → 插件的所有帧。 */
export type InboundFrame = HelloFrame | MessageFrame | CardActionFrame

/**
 * 插件 → 桥接：我是哪个飞书应用。连上之后的第一帧。
 *
 * 这是复用别人桥接时 dsh 唯一需要说的话。桥接可能同时订着好几个应用，报了身份
 * 之后它才知道：**哪些消息该转给 dsh**（不报的话 dsh 会连别人机器人的消息一起
 * 收，两个 agent 抢着答同一句话），以及 **dsh 的回话该以谁的身份发出去**。
 *
 * 反过来，dsh **不**告诉桥接该订哪些应用——那是桥接主人的事。dsh 报的是一个
 * 收件箱，不是一张订阅表。
 */
export interface AnnounceCommand {
  readonly v: number
  readonly kind: 'announce'
  /** dsh 的飞书身份：lark-cli 的 profile 目录。空串表示还没定，桥接不转发。 */
  readonly configDir: string
}

/** 插件 → 桥接：发一条纯文本回复（排队回执、拒绝理由、错误）。 */
export interface ReplyCommand {
  readonly v: number
  readonly kind: 'reply'
  readonly chatKey: string
  /** 引用哪条消息；不给就直接发到会话里。 */
  readonly replyTo?: string
  readonly text: string
}

/** 插件 → 桥接：开一张进度卡片。需要回执，因为要拿卡片 id。 */
export interface CardOpenCommand {
  readonly v: number
  readonly kind: 'card.open'
  /** 回执关联 id。 */
  readonly id: string
  readonly chatKey: string
  readonly replyTo?: string
  /** 卡片标题。 */
  readonly title: string
  /** 初始正文。 */
  readonly text: string
  /** 要不要带一个"停止"按钮。 */
  readonly stoppable: boolean
}

/**
 * 插件 → 桥接：更新进度卡片。
 *
 * **按阶段更新，不逐字**：lark-cli 每次调用约 300ms，逐 token 的节拍它吃不下。
 * 插件侧自己攒，攒到一个阶段边界（开始、换工具、出结果）才发一帧。
 */
export interface CardUpdateCommand {
  readonly v: number
  readonly kind: 'card.update'
  readonly cardId: string
  /** 当前阶段，渲染成卡片上的状态行。 */
  readonly stage: string
  /** 完整正文（不是增量）——桥接不持有文本状态。 */
  readonly text: string
}

/** 插件 → 桥接：收尾一张进度卡片。 */
export interface CardCloseCommand {
  readonly v: number
  readonly kind: 'card.close'
  readonly cardId: string
  readonly text: string
  readonly outcome: 'completed' | 'aborted' | 'error' | 'blocked' | 'other'
}

/**
 * 插件 → 桥接：发一张审批卡片。需要回执，回执只说卡片发出去没有。
 *
 * 人点了以后走 {@link CardActionFrame} 回来，靠 `askId` 对上——审批要等的是
 * 人，可能等几分钟，不能占着一次请求-回执。
 */
export interface AskCommand {
  readonly v: number
  readonly kind: 'ask'
  readonly id: string
  readonly chatKey: string
  /** 按钮里要原样带回来的 id。 */
  readonly askId: string
  /** 要批的动作，通常是工具名。 */
  readonly title: string
  /** 补充信息，通常是发起方给的理由。 */
  readonly detail: string
}

/** 插件 → 桥接的所有命令。 */
export type OutboundCommand =
  | AnnounceCommand | ReplyCommand | CardOpenCommand | CardUpdateCommand | CardCloseCommand | AskCommand

/**
 * 在联合类型上逐支去字段。
 *
 * 直接写 `Omit<OutboundCommand, 'v'>` 会先把联合塌成一个交集形状，
 * 结果每支自己的字段全部丢失（`chatKey` 之类会被判成"不存在的属性"）。
 */
export type Distribute<T, K extends string> = T extends unknown ? Omit<T, K> : never

/** 不需要回执的命令（`v` 由发送方补）。 */
export type SendableCommand = Distribute<Exclude<OutboundCommand, CardOpenCommand | AskCommand>, 'v'>

/** 需要回执的命令（`v` 与 `id` 由发送方补）。 */
export type RequestableCommand = Distribute<CardOpenCommand | AskCommand, 'v' | 'id'>

/** 桥接 → 插件：对一条带 id 的命令的回执。 */
export interface Ack {
  readonly v: number
  readonly kind: 'ack'
  /** 对应命令的 id。 */
  readonly replyTo: string
  readonly ok: boolean
  /** 成功时按命令种类携带结果（`card.open` 给 cardId）。 */
  readonly cardId?: string
  /** 失败原因。 */
  readonly error?: string
}

/** 桥接发给插件的一切。 */
export type BridgeFrame = InboundFrame | Ack

/**
 * 把一帧编码成一行。
 * @param frame - 要发送的帧。
 * @returns 带换行的一行 JSON。
 */
export function encodeFrame(frame: unknown): string {
  return `${JSON.stringify(frame)}\n`
}

/**
 * 按行切分的解码器。
 *
 * socket 上的分片和粘包都要自己处理：一次 `data` 事件可能给半行，也可能给三行。
 * 坏行整行丢弃并计数，不让一行畸形 JSON 把整条连接带崩。
 */
export class FrameDecoder {
  private buffer = ''
  /** 到目前为止丢弃的坏行数。 */
  dropped = 0

  /**
   * 吃一段字节，吐出其中完整的帧。
   * @param chunk - 收到的字节。
   * @returns 本次凑齐的帧，按到达顺序。
   */
  push(chunk: string): unknown[] {
    this.buffer += chunk
    const frames: unknown[] = []
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line !== '') {
        try {
          frames.push(JSON.parse(line))
        } catch {
          this.dropped += 1
        }
      }
      index = this.buffer.indexOf('\n')
    }
    return frames
  }
}
