/**
 * 扫码登录的浏览器这一侧：状态、勾选，以及扫完之前那个轮询循环。
 *
 * 循环是这里唯一有危险的地方——它会自己安排下一次，所以每一个终点都得有人钉住，
 * 否则一个没想到的返回值就是永远问下去。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeishuAuthController, type AuthRpc, type AuthRpcResult } from '../src/client/feishu-auth-controller.ts'

const STATUS = {
  installed: true,
  appId: 'cli_test',
  identity: 'user',
  bot: { status: 'ready', available: true, message: '' },
  user: { status: 'ready', available: true, message: '', userName: '测试用户', scopes: ['im:message'] },
}

const PROFILES = {
  profiles: [
    { configDir: '/home/me/.lark-cli/dsh-x', name: 'dsh-x', appId: 'cli_dsh', owned: true },
    { configDir: '/home/me/.lark-cli', name: 'default', appId: 'cli_other', owned: false },
  ],
  owned: '/home/me/.lark-cli/dsh-x',
}

/** 一个按端点回答的假 RPC；profiles 有默认答案，因为每次 load 都会问它。 */
function fakeRpc(answers: Record<string, () => unknown>) {
  const calls: string[] = []
  const args: Record<string, unknown>[] = []
  const withDefaults: Record<string, () => unknown> = { profiles: () => PROFILES, ...answers }
  const rpc: AuthRpc = {
    call: (_channel, endpoint, payload) => {
      calls.push(endpoint)
      args.push(payload.args)
      const answer = withDefaults[endpoint.replace('feishuAuth/', '')]
      if (answer === undefined) return Promise.resolve<AuthRpcResult>({ ok: false, error: { message: `no stub for ${endpoint}` } })
      return Promise.resolve<AuthRpcResult>({ ok: true, value: answer() })
    },
  }
  return { rpc, calls, args }
}

/** 把微任务队列排空，让 await 链走完。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('读登录态', () => {
  it('把状态和可选的权限域一起读回来', async () => {
    const { rpc } = fakeRpc({ status: () => STATUS, domains: () => ({ domains: ['im', 'docs'] }) })
    const controller = new FeishuAuthController(rpc)

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({
      phase: 'ready',
      status: { appId: 'cli_test' },
      domains: ['im', 'docs'],
      selected: ['im'],
    })
  })

  it('读失败带上原因', async () => {
    const rpc: AuthRpc = { call: () => Promise.resolve<AuthRpcResult>({ ok: false, error: { message: '连不上' } }) }
    const controller = new FeishuAuthController(rpc)

    await controller.load()

    expect(controller.store.getSnapshot()).toMatchObject({ phase: 'error', error: '连不上' })
  })
})

describe('权限勾选', () => {
  it('勾上和取消', () => {
    const { rpc } = fakeRpc({})
    const controller = new FeishuAuthController(rpc)

    controller.select('docs', true)
    expect(controller.store.getSnapshot().selected).toEqual(['im', 'docs'])

    controller.select('im', false)
    expect(controller.store.getSnapshot().selected).toEqual(['docs'])
  })
})

describe('扫码', () => {
  const challenge = { verificationUrl: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=x', qrDataUrl: 'data:image/png;base64,AAA' }

  function bench(progress: () => unknown) {
    const { rpc, calls, args } = fakeRpc({
      status: () => STATUS,
      domains: () => ({ domains: ['im'] }),
      begin: () => ({ phase: 'waiting', challenge }),
      progress,
      cancel: () => ({}),
    })
    return { controller: new FeishuAuthController(rpc), calls, args }
  }

  it('拿到二维码就上屏', async () => {
    const { controller } = bench(() => ({ phase: 'waiting', challenge }))
    await controller.begin()

    expect(controller.store.getSnapshot()).toMatchObject({ challenge, busy: false })
  })

  it('扫完之后清掉二维码、报成功、并重读状态', async () => {
    const { controller, calls } = bench(() => ({ phase: 'granted' }))
    await controller.begin()

    await vi.advanceTimersByTimeAsync(2100)
    await settle()

    expect(controller.store.getSnapshot()).toMatchObject({ granted: true })
    expect(controller.store.getSnapshot().challenge).toBeUndefined()
    expect(calls).toContain('feishuAuth/status')
  })

  it('授权失败要说原因', async () => {
    const { controller } = bench(() => ({ phase: 'failed', message: '设备码过期了' }))
    await controller.begin()

    await vi.advanceTimersByTimeAsync(2100)
    await settle()

    expect(controller.store.getSnapshot()).toMatchObject({ error: '设备码过期了' })
    expect(controller.store.getSnapshot().challenge).toBeUndefined()
  })

  // `idle` 也是终点，不是"再等等"：宿主那边已经没有在等的授权了（插件重载过，
  // 或者结果已经被读走），接着问就是永远问下去。
  it('宿主说 idle 就收摊，不再问下去', async () => {
    const { controller, calls } = bench(() => ({ phase: 'idle' }))
    await controller.begin()

    await vi.advanceTimersByTimeAsync(2100)
    await settle()
    const asked = calls.filter(call => call === 'feishuAuth/progress').length

    await vi.advanceTimersByTimeAsync(20_000)
    await settle()

    expect(asked).toBe(1)
    expect(calls.filter(call => call === 'feishuAuth/progress')).toHaveLength(1)
    expect(controller.store.getSnapshot().challenge).toBeUndefined()
  })

  it('人没扫就一直问', async () => {
    const { controller, calls } = bench(() => ({ phase: 'waiting', challenge }))
    await controller.begin()

    await vi.advanceTimersByTimeAsync(6100)
    await settle()

    expect(calls.filter(call => call === 'feishuAuth/progress').length).toBeGreaterThanOrEqual(3)
  })

  it('取消之后不再问', async () => {
    const { controller, calls } = bench(() => ({ phase: 'waiting', challenge }))
    await controller.begin()
    await vi.advanceTimersByTimeAsync(2100)
    await settle()

    await controller.cancel()
    const asked = calls.filter(call => call === 'feishuAuth/progress').length
    await vi.advanceTimersByTimeAsync(20_000)
    await settle()

    expect(calls.filter(call => call === 'feishuAuth/progress')).toHaveLength(asked)
    expect(controller.store.getSnapshot().challenge).toBeUndefined()
  })

  it('卡片收起来也不再问', async () => {
    const { controller, calls } = bench(() => ({ phase: 'waiting', challenge }))
    await controller.begin()
    await vi.advanceTimersByTimeAsync(2100)
    await settle()

    controller.dispose()
    const asked = calls.filter(call => call === 'feishuAuth/progress').length
    await vi.advanceTimersByTimeAsync(20_000)
    await settle()

    expect(calls.filter(call => call === 'feishuAuth/progress')).toHaveLength(asked)
  })

  it('宿主没回链接就算失败，而不是留一张空二维码', async () => {
    const { rpc } = fakeRpc({
      begin: () => ({ phase: 'waiting', challenge: {} }),
    })
    const controller = new FeishuAuthController(rpc)

    await controller.begin()

    expect(controller.store.getSnapshot().challenge).toBeUndefined()
    expect(controller.store.getSnapshot().error).toBe('宿主没有回授权链接')
  })
})

describe('作用在哪份 profile 上', () => {
  // 这一页的每个动作都会改到某个飞书应用的授权。默认那份往往属于别的工具，
  // 所以"作用在哪儿"必须是显式的、随请求走的，不能靠环境。
  it('每个动作都带上目标目录', async () => {
    const { rpc, args } = fakeRpc({
      status: () => STATUS,
      domains: () => ({ domains: ['im'] }),
      begin: () => ({ phase: 'waiting', challenge: { verificationUrl: 'https://x/d' } }),
      logout: () => ({ loggedOut: true }),
    })
    const controller = new FeishuAuthController(rpc)

    await controller.selectProfile('/home/me/.lark-cli')
    await controller.begin()
    await controller.logout()

    expect(args.filter(a => 'configDir' in a).every(a => a.configDir === '/home/me/.lark-cli')).toBe(true)
    expect(args.some(a => a.domains !== undefined && a.configDir === '/home/me/.lark-cli')).toBe(true)
  })

  it('没选就是空串，由宿主落到 dsh 自己那份', async () => {
    const { rpc, args } = fakeRpc({ status: () => STATUS, domains: () => ({ domains: ['im'] }) })
    const controller = new FeishuAuthController(rpc)

    await controller.load()

    expect(args.some(a => a.configDir === '')).toBe(true)
    expect(controller.store.getSnapshot().owned).toBe('/home/me/.lark-cli/dsh-x')
    expect(controller.store.getSnapshot().profiles).toHaveLength(2)
  })

  it('换一份就重读，不留上一份的状态', async () => {
    const { rpc, calls } = fakeRpc({ status: () => STATUS, domains: () => ({ domains: ['im'] }) })
    const controller = new FeishuAuthController(rpc)

    await controller.selectProfile('/home/me/.lark-cli')

    expect(controller.store.getSnapshot().configDir).toBe('/home/me/.lark-cli')
    expect(calls).toContain('feishuAuth/status')
  })
})

describe('退出登录', () => {
  it('退完重读一次状态', async () => {
    const { rpc, calls } = fakeRpc({
      logout: () => ({ loggedOut: true }),
      status: () => ({ installed: true }),
      domains: () => ({ domains: ['im'] }),
    })
    const controller = new FeishuAuthController(rpc)

    await controller.logout()
    await settle()

    expect(calls).toContain('feishuAuth/logout')
    expect(calls).toContain('feishuAuth/status')
    expect(controller.store.getSnapshot().error).toBeUndefined()
  })

  it('没退成要说', async () => {
    const { rpc } = fakeRpc({
      logout: () => ({ loggedOut: false, message: '本来就没登录' }),
      status: () => ({ installed: true }),
      domains: () => ({ domains: [] }),
    })
    const controller = new FeishuAuthController(rpc)

    await controller.logout()
    await settle()

    expect(controller.store.getSnapshot().error).toBe('本来就没登录')
  })
})
