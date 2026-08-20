/**
 * 扫码登录适配器：盯的是"把 lark-cli 的输出翻译成页面能用的东西"这一层。
 *
 * 每条命令都被拦下来，所以这里跑不到真的飞书；真实输出的形状已经拿本机的
 * lark-cli v1.0.87 对过一次，下面的样例照抄那份。
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Callback = (error: (Error & { code?: string }) | null, stdout: string, stderr: string) => void
type ExecFileMock = (
  file: string,
  args: readonly string[],
  options: { cwd?: string },
  callback: Callback,
) => void

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecFileMock>() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const { LarkAuth, dshConfigDir, discoverProfiles } = await import('../src/auth.ts')

/** `auth status --json` 的真实形状，照抄本机输出。 */
const STATUS = {
  appId: 'cli_aa08418f66b9dbe7',
  brand: 'feishu',
  identity: 'user',
  identities: {
    bot: { status: 'ready', available: true, message: 'Bot identity: ready' },
    user: {
      status: 'needs_refresh',
      available: true,
      message: 'User identity: needs refresh',
      openId: 'ou_c17f4a0d',
      userName: '用户768172',
      tokenStatus: 'needs_refresh',
      scope: 'im:message im:chat:read  im:resource',
      expiresAt: '2026-08-18T21:42:20+08:00',
      refreshExpiresAt: '2026-08-25T19:42:20+08:00',
    },
  },
}

/** 一个最小的合法 PNG，用来验证 data URI 那条路。 */
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

/** 按命令派发假输出；`args` 是传给 lark-cli 的 argv。 */
function respond(handler: (args: readonly string[], options: { cwd?: string }) => {
  stdout?: string
  stderr?: string
  error?: Error & { code?: string }
}): void {
  execFileMock.mockImplementation((_file, args, options, callback) => {
    const outcome = handler(args, options)
    queueMicrotask(() => { callback(outcome.error ?? null, outcome.stdout ?? '', outcome.stderr ?? '') })
  })
}

afterEach(() => { execFileMock.mockReset() })

describe('登录态', () => {
  it('没装 lark-cli 就如实说没装，而不是说没登录', async () => {
    respond(() => ({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }))
    expect(await new LarkAuth().status('')).toMatchObject({ installed: false, configured: false })
  })

  // 每条命令都必须显式指定 profile。这台机器上的环境默认往往属于别的工具，
  // 跟着它走等于让这一页随手改别人的授权。
  it('不指定就落到 dsh 自己那份，不落到环境默认', async () => {
    let seen: string | undefined
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      seen = (options as { env?: Record<string, string> }).env?.LARKSUITE_CLI_CONFIG_DIR
      queueMicrotask(() => { callback(null, JSON.stringify(STATUS), '') })
    })

    const status = await new LarkAuth().status('')

    expect(seen).toBe(dshConfigDir())
    expect(seen?.endsWith('dsh')).toBe(true)
    expect(status.configDir).toBe(dshConfigDir())
  })

  it('指定了就作用在指定的那份上', async () => {
    let seen: string | undefined
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      seen = (options as { env?: Record<string, string> }).env?.LARKSUITE_CLI_CONFIG_DIR
      queueMicrotask(() => { callback(null, JSON.stringify(STATUS), '') })
    })

    await new LarkAuth().status('/home/me/.lark-cli/agent-bus')

    expect(seen).toBe('/home/me/.lark-cli/agent-bus')
  })

  // 「这份 profile 还没绑应用」跟「没登录」的下一步完全不同：前者要先申请或
  // 绑定一个应用，后者才轮到扫码。dsh 自己那份一开始必然是前者。
  // 真实的 lark-cli 把失败信封写在 stderr 上，stdout 是空的——只读 stdout 的话
  // 这一条会退化成"一整坨 JSON 塞进错误消息里"。
  it('没绑应用不等于没登录（信封在 stderr 上）', async () => {
    respond(() => ({
      stdout: '',
      stderr: JSON.stringify({
        ok: false,
        error: { type: 'config', subtype: 'not_configured', message: 'not configured', hint: 'run `lark-cli config init --new`' },
      }),
      error: Object.assign(new Error('exit 3'), { code: 3 as unknown as string }),
    }))

    expect(await new LarkAuth().status('')).toMatchObject({
      installed: true,
      configured: false,
      configHint: 'run `lark-cli config init --new`',
    })
  })

  it('把两个身份和 scope 拆出来', async () => {
    respond(() => ({ stdout: JSON.stringify(STATUS) }))
    const status = await new LarkAuth().status('')

    expect(status).toMatchObject({
      installed: true,
      appId: 'cli_aa08418f66b9dbe7',
      identity: 'user',
      bot: { status: 'ready', available: true },
    })
    // 连续空格也要吃掉，否则会多出一个空 scope。
    expect(status.user?.scopes).toEqual(['im:message', 'im:chat:read', 'im:resource'])
    expect(status.user?.userName).toBe('用户768172')
    expect(status.user?.refreshExpiresAt).toBe('2026-08-25T19:42:20+08:00')
  })

  // 装着但读不出来，跟没装是两件事：前者该看错误，后者该去装。
  it('读失败时仍然算装了，只是带上原因', async () => {
    respond(() => ({
      stdout: JSON.stringify({ error: { message: 'config not initialized' } }),
      error: Object.assign(new Error('exit 1'), { code: 1 as unknown as string }),
    }))
    expect(await new LarkAuth().status('')).toMatchObject({
      installed: true,
      configured: true,
      error: 'config not initialized',
    })
  })
})

describe('发起扫码', () => {
  it('必须先选权限域', async () => {
    respond(() => ({ stdout: '{}' }))
    expect(await new LarkAuth().begin('', [])).toEqual({
      phase: 'failed',
      message: '至少要选一个要开通的权限域',
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  // 域名直接进 argv。它来自浏览器，所以形状不对的一律不放行——即便这里是
  // execFile 而不是 shell，一个 `--scope` 之类的值也能改掉这条命令的意思。
  it('形状不对的域一个都不放行', async () => {
    respond(() => ({ stdout: '{}' }))
    const outcome = await new LarkAuth().begin('', ['--scope', 'im;rm -rf /', ''])
    expect(outcome).toMatchObject({ phase: 'failed' })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('拿到链接和二维码，并且不把设备码交出去', async () => {
    respond((args, options) => {
      if (args.includes('qrcode')) {
        writeFileSync(join(options.cwd ?? '.', 'qr.png'), PNG)
        return { stdout: '{}' }
      }
      if (args.includes('--no-wait')) {
        return {
          stdout: JSON.stringify({
            verification_url: 'https://open.feishu.cn/device?code=ABCD',
            device_code: 'secret-device-code',
          }),
        }
      }
      return { stdout: '{}' }
    })

    const outcome = await new LarkAuth().begin('', ['im'])
    expect(outcome.phase).toBe('waiting')
    if (outcome.phase !== 'waiting') return
    expect(outcome.challenge.verificationUrl).toBe('https://open.feishu.cn/device?code=ABCD')
    expect(outcome.challenge.qrDataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    // 设备码是一张待兑换的授权票，浏览器拿它没用处，泄漏出去却能被人兑走。
    expect(JSON.stringify(outcome)).not.toContain('secret-device-code')

    // win32 会在 argv 前面塞一个 run.js 路径，所以只断言尾巴。
    const login = execFileMock.mock.calls.find(call => call[1].includes('--no-wait'))
    expect(login?.[1].slice(-6)).toEqual(['auth', 'login', '--no-wait', '--json', '--domain', 'im'])
  })

  it('二维码没生成出来也照样给链接', async () => {
    respond(args => args.includes('qrcode')
      // 目录里不写 qr.png：读回来会失败。
      ? { stdout: '{}' }
      : {
        stdout: JSON.stringify({
          verification_url: 'https://open.feishu.cn/device?code=EFGH',
          device_code: 'code',
        }),
      })

    const outcome = await new LarkAuth().begin('', ['im', 'docs'])
    expect(outcome).toMatchObject({
      phase: 'waiting',
      challenge: { verificationUrl: 'https://open.feishu.cn/device?code=EFGH' },
    })
    if (outcome.phase !== 'waiting') return
    expect(outcome.challenge.qrDataUrl).toBeUndefined()
  })

  it('lark-cli 没回链接就算失败，而不是给一张空二维码', async () => {
    respond(() => ({ stdout: JSON.stringify({ device_code: 'only-the-code' }) }))
    expect(await new LarkAuth().begin('', ['im'])).toMatchObject({ phase: 'failed' })
  })
})

describe('授权进度', () => {
  /** 让轮询那条命令挂着不结束，模拟"用户还没扫"。 */
  function beginWithHangingPoll(): { auth: InstanceType<typeof LarkAuth>; settle: (ok: boolean) => void } {
    let pollCallback: Callback | undefined
    execFileMock.mockImplementation((_file, args, _options, callback) => {
      if (args.includes('--device-code')) { pollCallback = callback; return }
      queueMicrotask(() => {
        callback(null, args.includes('--no-wait')
          ? JSON.stringify({ verification_url: 'https://x/d', device_code: 'c' })
          : '{}', '')
      })
    })
    return {
      auth: new LarkAuth(),
      settle: (ok) => {
        pollCallback?.(ok ? null : Object.assign(new Error('expired'), { code: 1 as unknown as string }), '{}', '')
      },
    }
  }

  it('扫完之前一直是 waiting，扫完变 granted', async () => {
    const { auth, settle } = beginWithHangingPoll()
    await auth.begin('', ['im'])
    expect(auth.progress().phase).toBe('waiting')

    settle(true)
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    expect(auth.progress().phase).toBe('granted')
  })

  // 结果只该被读到一次：留着会让下一次发起看起来"早就成了"。
  it('读到结果之后回到 idle', async () => {
    const { auth, settle } = beginWithHangingPoll()
    await auth.begin('', ['im'])
    settle(true)
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })

    expect(auth.progress().phase).toBe('granted')
    expect(auth.progress().phase).toBe('idle')
  })

  it('没发起过就是 idle', () => {
    expect(new LarkAuth().progress()).toEqual({ phase: 'idle' })
  })

  it('放弃之后不再报进度', async () => {
    const { auth } = beginWithHangingPoll()
    await auth.begin('', ['im'])
    auth.cancel()
    expect(auth.progress()).toEqual({ phase: 'idle' })
  })
})

describe('列出可管理的 profile', () => {
  // 没绑应用的目录不能写 `appId: undefined`：RPC 边界按"键在不在"校验，一个值
  // 为 undefined 的键会让整条结果被拒，页面上就只剩一句校验失败。
  it('没绑应用的目录不带 appId 这个键', async () => {
    const profiles = await discoverProfiles()
    for (const profile of profiles) {
      expect(Object.hasOwn(profile, 'appId') ? typeof profile.appId : 'string').toBe('string')
    }
  })

  it('总是列出 dsh 自己那份，哪怕它还不存在', async () => {
    const profiles = await discoverProfiles()
    const owned = profiles.filter(profile => profile.owned)
    expect(owned).toHaveLength(1)
    expect(owned[0]?.configDir).toBe(dshConfigDir())
  })
})

describe('退出登录', () => {
  it('退成功', async () => {
    respond(() => ({ stdout: JSON.stringify({ loggedOut: true }) }))
    expect(await new LarkAuth().logout('')).toEqual({ loggedOut: true })
  })

  it('退失败要带原因', async () => {
    respond(() => ({
      stdout: JSON.stringify({ error: { message: 'nothing to log out' } }),
      error: Object.assign(new Error('exit 1'), { code: 1 as unknown as string }),
    }))
    expect(await new LarkAuth().logout('')).toEqual({
      loggedOut: false,
      message: 'nothing to log out',
    })
  })
})
