/**
 * 扫码登录的 RPC 面：连接器页那张卡片够得到的全部动作。
 *
 * 与 `auth.ts` 分开，是因为那一层只跟 lark-cli 打交道、可以脱开 cordis 单测；
 * 这一层只负责把它摆到 `feishuAuth/*` 上。
 *
 * @module @personal/dsh-x-feishu/src/auth-gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { AUTH_DOMAINS, LarkAuth, type AuthProgress, type AuthStatus } from './auth.ts'

/** 退出登录的结果。 */
export interface LogoutOutcome {
  readonly loggedOut: boolean
  readonly message?: string
}

/** 页面渲染权限勾选框需要的那份清单。 */
export interface DomainList {
  readonly domains: readonly string[]
}

/** 浏览器这一侧能调到的扫码登录动作。 */
export class FeishuAuthGateway extends TypertRemoteService {
  private readonly auth = new LarkAuth()

  /** @param ctx - 插件上下文。 */
  constructor(ctx: Context) {
    super(ctx, 'feishuAuth')
    // 插件被停用或重载时，正在等的那次授权要跟着断，否则会留下一个继续轮询
    // 十五分钟的 lark-cli。
    ctx.effect(() => () => { this.auth.cancel() }, 'dsh-x-feishu: 放弃在途授权')
  }

  /**
   * 这台机器上的登录态。
   * @returns 登录态；lark-cli 不在时 `installed` 为 false。
   */
  @Remote('status')
  status(): Promise<AuthStatus> {
    return this.auth.status()
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
   * @param request - 这次要开通的业务域。
   * @returns 链接与二维码，或失败原因。
   */
  @Remote('begin')
  begin(request: { domains: readonly string[] }): Promise<AuthProgress> {
    return this.auth.begin(request.domains)
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
   * 退出本机登录态。
   * @returns 是否真的退了，以及失败原因。
   */
  @Remote('logout')
  logout(): Promise<LogoutOutcome> {
    return this.auth.logout()
  }
}

export default FeishuAuthGateway
