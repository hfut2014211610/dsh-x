/**
 * 桥接向其他本机 Agent 广播原始飞书事件的只读 socket 协议。
 *
 * 事件 consumer 仍只有桥接里的一个；其他进程只能连接这个 relay，不能再启动
 * `lark-cli event consume`。relay 支持多个只读客户端，不接收客户端命令。
 *
 * @module @personal/dsh-x-feishu/bridge/relay
 */

/** relay 协议版本。 */
export const EVENT_RELAY_VERSION = 1

/** 默认的事件 relay 端点。 */
export function defaultEventRelayEndpoint(): string {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\dsh-x-feishu-events'
    : `${process.env.XDG_RUNTIME_DIR ?? '/tmp'}/dsh-x-feishu-events.sock`
}

/**
 * @param event - lark-cli event consume 解析出的原始事件。
 * @param source - 收到它的那个 lark-cli profile 目录；空串是环境默认那份。
 *   订阅方要回话的话，必须以同一个应用的身份回：一个应用一个机器人，卡片也
 *   只能由发它的那个应用改。
 * @returns 一行 JSON 帧。
 */
export function encodeEventRelayFrame(event: unknown, source: string): string {
  return `${JSON.stringify({ v: EVENT_RELAY_VERSION, kind: 'lark-event', source, event })}\n`
}
