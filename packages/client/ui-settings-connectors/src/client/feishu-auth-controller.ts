/**
 * 飞书扫码登录的浏览器这一侧：状态、二维码、以及扫完之前的轮询。
 *
 * 走的是宿主插件的 `feishuAuth/*` 裸 RPC 通道，不是生成出来的 remote 门面——
 * 那个渠道插件在 `personal/` 里，客户端包不该反过来依赖它。这里的类型是这条线
 * 上的合同的一份复述，不是从那边导入的。
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** 一次裸 RPC 的结果。 */
export type AuthRpcResult = { ok: true; value: unknown } | { ok: false; error: { message: string } }

/** 连接对象上那条裸 RPC 通道。 */
export interface AuthRpc {
  call(channel: string, endpoint: string, payload: { args: Record<string, unknown> }): Promise<AuthRpcResult>
}

/** 一个身份现在的样子。 */
export interface AuthIdentityView {
  status: string
  available: boolean
  message: string
}

/** 用户身份，扫码授权得到的那一个。 */
export interface AuthUserView extends AuthIdentityView {
  openId?: string
  userName?: string
  tokenStatus?: string
  scopes: readonly string[]
  expiresAt?: string
  refreshExpiresAt?: string
}

/** 一份可以管理的 lark-cli profile。 */
export interface AuthProfileView {
  configDir: string
  name: string
  appId?: string
  /** dsh 自己那份。不指定时作用的就是它。 */
  owned: boolean
}

/** 某一份 profile 的飞书登录态。 */
export interface AuthStatusView {
  /** 这份状态说的是哪个目录。 */
  configDir?: string
  installed: boolean
  /** 这份 profile 绑没绑应用；没绑要先申请/绑定，还轮不到扫码。 */
  configured?: boolean
  /** lark-cli 给的下一步提示，没绑的时候有。 */
  configHint?: string
  appId?: string
  brand?: string
  identity?: string
  bot?: AuthIdentityView
  user?: AuthUserView
  error?: string
}

/** 屏幕上那张二维码和它旁边的链接。 */
export interface AuthChallengeView {
  verificationUrl: string
  qrDataUrl?: string
}

/** 卡片里这一段渲染需要的全部东西。 */
export interface FeishuAuthState {
  /** 读登录态这件事走到哪了。 */
  phase: 'idle' | 'loading' | 'ready' | 'error'
  status?: AuthStatusView
  /** 这台机器上可以管理的 profile。 */
  profiles: readonly AuthProfileView[]
  /** 当前动作作用在哪份上；空串表示 dsh 自己那份。 */
  configDir: string
  /** dsh 自己那份的目录，用来认出"这不是我们的应用"。 */
  owned: string
  /** 宿主给的可选业务域。 */
  domains: readonly string[]
  /** 这次打算开通哪些。 */
  selected: readonly string[]
  /** 正在等人扫的那张码。 */
  challenge?: AuthChallengeView
  /** 有一次调用在途，按钮该锁住。 */
  busy: boolean
  /** 刚刚授权成功，给一句反馈。 */
  granted: boolean
  /** 最近一次失败的原因。 */
  error?: string
}

/** 轮询间隔：人扫码加确认大约几秒，两秒一问既不迟钝也不吵。 */
const POLL_INTERVAL_MS = 2000

/** 渠道插件默认要的那一个域。飞书通道读写的是消息，别的都不是它的事。 */
const DEFAULT_DOMAIN = 'im'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 驱动扫码登录那一段的状态与动作。 */
export class FeishuAuthController {
  /** uSES 安全的状态源，卡片通过绑定的选择器读它。 */
  readonly store: SnapshotStore<FeishuAuthState> = createSnapshotStore<FeishuAuthState>({
    phase: 'idle',
    profiles: [],
    configDir: '',
    owned: '',
    domains: [],
    selected: [DEFAULT_DOMAIN],
    busy: false,
    granted: false,
  })

  private timer: ReturnType<typeof setTimeout> | undefined
  private polling = false
  private generation = 0

  /**
   * 不透明地读 {@link polling}。
   *
   * 直接读字段会被控制流收窄：函数开头判过一次之后，编译器就认定 `await` 之后
   * 那次判断恒假——而 `await` 期间正是别的代码停掉轮询的窗口。
   * @returns 现在还在不在轮询。
   */
  private isPolling(): boolean {
    return this.polling
  }

  /** @param rpc - 连接上的裸 RPC 通道。 */
  constructor(private readonly rpc: AuthRpc) {}

  private async call(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await this.rpc.call('/api', `feishuAuth/${method}`, { args })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  /**
   * 读登录态和可选的业务域。
   * @returns 读完为止；被后一次读超过的那次不写回状态。
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      if (state.phase !== 'ready') state.phase = 'loading'
      delete state.error
    })
    try {
      const configDir = this.store.getSnapshot().configDir
      const [status, domains, profiles] = await Promise.all([
        this.call('status', { configDir }),
        this.call('domains'),
        this.call('profiles'),
      ])
      if (generation !== this.generation) return
      const list = record(domains)?.domains
      const roster = record(profiles)
      this.store.update((state) => {
        state.phase = 'ready'
        state.status = status as AuthStatusView
        if (Array.isArray(list)) state.domains = list.filter((item): item is string => typeof item === 'string')
        if (Array.isArray(roster?.profiles)) state.profiles = roster.profiles as AuthProfileView[]
        if (typeof roster?.owned === 'string') state.owned = roster.owned
        delete state.error
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.phase = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /**
   * 换一份 profile 来管。
   *
   * 换完立刻重读：每个动作作用在哪个应用上是这一页最要紧的事实，不能让屏幕上
   * 还留着上一份的状态。
   * @param configDir - 目标目录；空串表示 dsh 自己那份。
   * @returns 重读完为止。
   */
  async selectProfile(configDir: string): Promise<void> {
    this.stopPolling()
    this.store.update((state) => {
      state.configDir = configDir
      delete state.challenge
      state.granted = false
      delete state.error
    })
    await this.load()
  }

  /**
   * 勾上或取消一个业务域。
   *
   * 多次登录的 scope 是累加的，所以这里勾的是"这次要加什么"，不是"最终要有
   * 什么"——取消勾选不会撤销已经授予的权限。
   * @param domain - 业务域。
   * @param wanted - 勾上还是取消。
   */
  select(domain: string, wanted: boolean): void {
    this.store.update((state) => {
      const rest = state.selected.filter(item => item !== domain)
      state.selected = wanted ? [...rest, domain] : rest
    })
  }

  /**
   * 发起扫码授权，然后一直问到人扫完。
   * @returns 拿到二维码就返回；扫完与否由轮询写回状态。
   */
  async begin(): Promise<void> {
    const { selected, busy } = this.store.getSnapshot()
    if (busy) return
    this.stopPolling()
    this.store.update((state) => {
      state.busy = true
      state.granted = false
      delete state.challenge
      delete state.error
    })
    try {
      const progress = record(await this.call('begin', {
        configDir: this.store.getSnapshot().configDir,
        domains: [...selected],
      }))
      this.applyProgress(progress)
    } catch (error) {
      this.store.update((state) => { state.error = messageOf(error) })
    } finally {
      this.store.update((state) => { state.busy = false })
    }
    if (this.store.getSnapshot().challenge !== undefined) this.schedulePoll()
  }

  /** 放弃这次授权，把二维码从屏幕上撤掉。 */
  async cancel(): Promise<void> {
    this.stopPolling()
    this.store.update((state) => { delete state.challenge })
    try {
      await this.call('cancel')
    } catch {
      // 放弃失败没有下一步可走：宿主那边最多留一个自己会过期的轮询。
    }
  }

  /**
   * 退出本机登录态。
   * @returns 退完并重新读一次状态。
   */
  async logout(): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.stopPolling()
    this.store.update((state) => {
      state.busy = true
      state.granted = false
      delete state.challenge
      delete state.error
    })
    let failure: string | undefined
    try {
      const outcome = record(await this.call('logout', { configDir: this.store.getSnapshot().configDir }))
      if (outcome?.loggedOut !== true) {
        failure = typeof outcome?.message === 'string' ? outcome.message : '退出登录没有成功'
      }
    } catch (error) {
      failure = messageOf(error)
    }
    this.store.update((state) => { state.busy = false })
    // 先重读再写原因，不能反过来：重读会清掉上一次的错误，而它清不掉的正是
    // 这一次的——退出失败却被下一句话擦干净，人只会以为退成功了。
    await this.load()
    if (failure !== undefined) this.store.update((state) => { state.error = failure })
  }

  /** 卡片收起或页面卸载时停掉轮询。 */
  dispose(): void {
    this.stopPolling()
    this.generation += 1
  }

  /** 把一次进度写进状态。循环该不该继续由 {@link pollOnce} 决定，不在这里。 */
  private applyProgress(progress: Record<string, unknown> | undefined): void {
    const phase = progress?.phase
    if (phase === 'waiting') {
      const challenge = record(progress?.challenge)
      const url = typeof challenge?.verificationUrl === 'string' ? challenge.verificationUrl : undefined
      if (url === undefined) {
        this.store.update((state) => { state.error = '宿主没有回授权链接' })
        return
      }
      const qr = typeof challenge?.qrDataUrl === 'string' ? challenge.qrDataUrl : undefined
      this.store.update((state) => {
        state.challenge = { verificationUrl: url, ...qr === undefined ? {} : { qrDataUrl: qr } }
      })
      return
    }
    if (phase === 'granted') {
      this.store.update((state) => {
        state.granted = true
        delete state.challenge
      })
      void this.load()
      return
    }
    if (phase === 'failed') {
      const message = typeof progress?.message === 'string' ? progress.message : '授权没有完成'
      this.store.update((state) => {
        state.error = message
        delete state.challenge
      })
    }
  }

  private schedulePoll(): void {
    this.polling = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.pollOnce() }, POLL_INTERVAL_MS)
  }

  /**
   * 问一次进度，并决定还要不要接着问。
   *
   * `idle` 也是一个终点，不是"再等等"：宿主那边已经没有在等的授权了——插件重载
   * 过，或者结果已经被读走——那张二维码不会再有结果，接着问就是永远问下去。
   */
  private async pollOnce(): Promise<void> {
    if (!this.isPolling()) return
    let progress: Record<string, unknown> | undefined
    try {
      progress = record(await this.call('progress'))
    } catch (error) {
      this.stopPolling()
      this.store.update((state) => { state.error = messageOf(error) })
      return
    }
    if (!this.isPolling()) return
    this.applyProgress(progress)
    if (progress?.phase === 'waiting') {
      this.schedulePoll()
      return
    }
    this.stopPolling()
    if (progress?.phase === 'idle') this.store.update((state) => { delete state.challenge })
  }

  private stopPolling(): void {
    this.polling = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
