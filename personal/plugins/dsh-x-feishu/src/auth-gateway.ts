/**
 * 扫码登录的 RPC 面：连接器页那张卡片够得到的全部动作。
 *
 * 与 `auth.ts` 分开，是因为那一层只跟 lark-cli 打交道、可以脱开 cordis 单测；
 * 这一层只负责把它摆到 `feishuAuth/*` 上。
 *
 * 参数**一个一个具名地收**，不收一个 `request` 对象。这个包没有 typert 生成
 * 的描述符（personal 插件跑的是源码），网关只能从函数签名本身认参数名，一个
 * `request: { domains }` 到了线上就变成"多了个 domains 字段"。
 *
 * @module @personal/dsh-x-feishu/src/auth-gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  AUTH_DOMAINS, LarkAuth, discoverProfiles, dshConfigDir,
  type AuthProfile, type AuthProgress, type AuthStatus,
} from './auth.ts'
import type { BridgeStatus, BridgeStatusView } from './bridge-status.ts'

/** 退出登录的结果。 */
export interface LogoutOutcome {
  readonly loggedOut: boolean
  readonly message?: string
}

/** 页面渲染权限勾选框需要的那份清单。 */
export interface DomainList {
  readonly domains: readonly string[]
}

/** 这台机器上可以管理的 profile。 */
export interface ProfileList {
  readonly profiles: readonly AuthProfile[]
  /** dsh 自己那份的目录；不指定 configDir 时作用的就是它。 */
  readonly owned: string
}

/** 浏览器这一侧能调到的扫码登录动作。 */
export class FeishuAuthGateway extends TypertRemoteService {
  private readonly auth = new LarkAuth()

  /**
   * @param ctx - 插件上下文。
   * @param bridgeStatus - 握手带来的桥接现状，设置页要显示。
   */
  constructor(ctx: Context, private readonly bridgeStatus: BridgeStatus) {
    super(ctx, 'feishuAuth')
    // 插件被停用或重载时，正在等的那次授权要跟着断，否则会留下一个继续轮询
    // 十五分钟的 lark-cli。
    ctx.effect(() => () => { this.auth.cancel() }, 'dsh-x-feishu: 放弃在途授权')
  }

  /**
   * 某一份 profile 的登录态。
   * @param configDir - 读哪个目录；空串落到 dsh 自己那份，**不落到环境默认**。
   * @returns 登录态。
   */
  @Remote('status')
  status(configDir: string): Promise<AuthStatus> {
    return this.auth.status(configDir)
  }

  /**
   * 这台机器上有哪些 profile 可以管。
   *
   * 页面必须先看见这份清单再动手：默认那份往往属于别的工具，对它 `auth login`
   * 是往别人的应用上加权限，`auth logout` 是把别人踢下线。
   * @returns profile 清单，以及 dsh 自己那份的位置。
   */
  @Remote('profiles')
  async profiles(): Promise<ProfileList> {
    return { profiles: await discoverProfiles(), owned: dshConfigDir() }
  }

  /**
   * 可以开通的业务域。
   *
   * 由宿主给而不是前端写死：能收哪些域是 lark-cli 的事实，抄一份到前端就会有
   * 两处需要一起改。
   * @returns 域清单。
   */
  @Remote('domains')
  domains(): Promise<DomainList> {
    return Promise.resolve({ domains: AUTH_DOMAINS })
  }

  /**
   * 发起一次扫码授权。
   * @param configDir - 授权给哪份 profile；空串落到 dsh 自己那份。
   * @param domains - 这次要开通的业务域。
   * @returns 链接与二维码，或失败原因。
   */
  @Remote('begin')
  begin(configDir: string, domains: readonly string[]): Promise<AuthProgress> {
    return this.auth.begin(configDir, domains)
  }

  /**
   * 给这份 profile 建一个飞书应用。扫码授权之前的那一步。
   * @param configDir - 建在哪份 profile 上；空串落到 dsh 自己那份。
   * @returns 链接与二维码，或失败原因。进度与授权共用 {@link progress}。
   */
  @Remote('bind')
  bind(configDir: string): Promise<AuthProgress> {
    return this.auth.bind(configDir)
  }

  /**
   * 这次授权走到哪一步了。页面靠轮询它知道人扫完了没有。
   * @returns 当前进度。
   */
  @Remote('progress')
  progress(): Promise<AuthProgress> {
    return Promise.resolve(this.auth.progress())
  }

  /**
   * 放弃正在等的那次授权。
   * @returns 空对象；这个动作没有可失败的地方。
   */
  @Remote('cancel')
  cancel(): Promise<Record<string, never>> {
    this.auth.cancel()
    return Promise.resolve({})
  }

  /**
   * 桥接连上没有，以及它现在订着什么、放行谁。
   *
   * 复用别人的桥接时这些都不归 dsh 改，但得让人看见——一个开着、授权也给了、
   * 就是没人能用的渠道，从界面上看不出问题在哪。
   * @returns 桥接现状。
   */
  @Remote('bridge')
  bridge(): Promise<BridgeStatusView> {
    return Promise.resolve(this.bridgeStatus.read())
  }

  /**
   * 退出某一份 profile 的本机登录态。
   * @param configDir - 退哪份；空串落到 dsh 自己那份。
   * @returns 是否真的退了，以及失败原因。
   */
  @Remote('logout')
  logout(configDir: string): Promise<LogoutOutcome> {
    return this.auth.logout(configDir)
  }
}

export default FeishuAuthGateway
