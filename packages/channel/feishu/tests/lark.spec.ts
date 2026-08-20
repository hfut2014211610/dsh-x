import { describe, expect, it, vi } from 'vitest'
import { botOpenIdOf, larkApi, messageIdOf } from '../src/bridge/lark.ts'

const execCalls = vi.hoisted((): Array<{ file: string; args: string[]; options: Record<string, unknown> }> => [])
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  // larkApi runs `promisify(execFile)`; without the custom symbol promisify
  // resolves an array of callback args instead of the { stdout } shape.
  const fake = Object.assign(
    (
      file: string,
      args: string[],
      options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push({ file, args, options })
      callback(null, '{"ok":true,"data":{"message_id":"om_1"}}', '')
    },
    {
      [Symbol.for('nodejs.util.promisify.custom')]: (
        file: string,
        args: string[],
        options: Record<string, unknown>,
      ) => {
        execCalls.push({ file, args, options })
        return Promise.resolve({ stdout: '{"ok":true,"data":{"message_id":"om_1"}}', stderr: '' })
      },
    },
  ) as unknown as typeof actual.execFile
  return { ...actual, execFile: fake }
})

describe('larkApi', () => {
  it('藏起子进程窗口：桥接常被无控制台地驻留，出站调用不藏的话每次更新卡片都闪一个 cmd 窗', async () => {
    const result = await larkApi('', 'POST', '/open-apis/im/v1/messages', { text: 'x' })
    expect(result.ok).toBe(true)
    const call = execCalls.at(-1)
    expect(call?.args).toContain('api')
    expect(call?.options.windowsHide).toBe(true)
  })
})

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
