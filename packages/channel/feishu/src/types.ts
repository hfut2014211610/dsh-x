/**
 * Types that cross the `feishuAuth/*` Remote boundary.
 *
 * They live here rather than beside the code that produces them because Typert
 * requires a boundary type to be nameable from a public, non-root type subpath
 * — a browser reading the generated descriptor has to be able to import the
 * declaration without pulling in the host implementation behind it.
 * @module @deepseek-ai/dsh-feishu/types
 */

import type { BridgeSummary } from './protocol.ts'

/** 一个身份现在的样子。 */
export interface AuthIdentity {
  /** lark-cli 自己的措辞：`ready` / `needs_refresh` / `missing` …… */
  readonly status: string
  readonly available: boolean
  readonly message: string
}

/** 用户身份，扫码授权得到的那一个。 */
export interface AuthUserIdentity extends AuthIdentity {
  readonly openId?: string
  readonly userName?: string
  readonly tokenStatus?: string
  /** 已授予的 scope，按空格拆开。 */
  readonly scopes: readonly string[]
  readonly expiresAt?: string
  readonly refreshExpiresAt?: string
}

/** 这台机器上某一份 profile 的飞书登录态。 */
export interface AuthStatus {
  /** 这份状态说的是哪个目录。原样回给页面，省得它自己去记。 */
  readonly configDir: string
  /** lark-cli 在不在。不在的话下面全是空的，页面只能先让人去装。 */
  readonly installed: boolean
  /**
   * 这份 profile 绑没绑应用。
   *
   * 没绑跟没登录是两件事：没绑要先 `lark-cli config init` 申请/绑定一个应用，
   * 没登录才轮到扫码。dsh 自己那份一开始必然是没绑的。
   */
  readonly configured: boolean
  /** lark-cli 自己给的下一步提示，没绑的时候有。 */
  readonly configHint?: string
  readonly appId?: string
  readonly brand?: string
  /** 当前生效的身份（`user` / `bot`）。 */
  readonly identity?: string
  /**
   * 机器人身份。**扫码给不了它权限**——bot 的 scope 只能在开发者后台开通，
   * 所以页面对它只能展示状态，不能提供按钮。
   */
  readonly bot?: AuthIdentity
  readonly user?: AuthUserIdentity
  /** 读不出来时的原因。 */
  readonly error?: string
}

/** 一次设备码授权的起点。 */
export interface AuthChallenge {
  /** 原样透传，绝不改动（编码、拼接、加空格都不行）。 */
  readonly verificationUrl: string
  /** 二维码 PNG 的 data URI；生成失败就没有，页面还有链接可用。 */
  readonly qrDataUrl?: string
}

/** 授权走到哪一步。 */
export type AuthProgress =
  | { readonly phase: 'idle' }
  | { readonly phase: 'waiting'; readonly challenge: AuthChallenge }
  | { readonly phase: 'granted' }
  | { readonly phase: 'failed'; readonly message: string }

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

/** 一份可以在这一页上管理的 lark-cli profile。 */
export interface AuthProfile {
  /** 绝对路径。 */
  readonly configDir: string
  /** 目录名；`~/.lark-cli` 本身叫 default。 */
  readonly name: string
  /** 这个目录绑的应用；还没绑就没有。 */
  readonly appId?: string
  /** 是不是 dsh 自己那份。 */
  readonly owned: boolean
}

/** 设置页要显示的那点东西。 */
export interface BridgeStatusView {
  /** 桥接连上没有。没连上时下面的现状是空的。 */
  readonly connected: boolean
  /** 桥接现在的样子；没连上，或者对面是个老桥接，就没有。 */
  readonly bridge?: BridgeSummary
}
