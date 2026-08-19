/**
 * 扫码登录与权限开通：插件这一侧对 `lark-cli auth *` 的全部接触面。
 *
 * 桥接进程之所以独占 `lark-cli`，是因为**一个 event key 只允许一个消费者**——
 * 那条约束只管事件订阅，不管认证。认证是一次性的交互动作，而且必须在桥接还
 * 起不来的时候就能用：凭证没配好的时候，让人先去把需要凭证的东西跑起来是说不
 * 通的。所以 auth 由插件自己跑，`bridge/lark.ts` 仍然是出站业务调用的唯一出口。
 *
 * 设备码流程（lark-cli 自己的文档叫 split-flow）：
 * 1. `auth login --no-wait --json` 立刻拿到 `verification_url` 和 `device_code`
 * 2. `auth qrcode <url> --output` 把链接变成二维码
 * 3. `auth login --device-code <code>` 轮询到用户扫完为止
 *
 * 第三步会一直阻塞到授权完成或过期，所以它在后台跑，页面轮询进度——把它塞进
 * 一次 RPC 里会挂住几分钟。lark-cli 的技能文档劝 agent 不要在展示 URL 的同一轮
 * 里就启动轮询，那是针对不透传中间输出的 harness 说的；这里二维码在 `begin()`
 * 返回的那一刻就已经在屏幕上，所以并发启动轮询正是设备码 UI 本来的样子。
 *
 * @module @personal/dsh-x-feishu/src/auth
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { larkCliInvocation } from '../bridge/cli.ts'

/** 读命令的上限。`auth status` 要解析 token，偶尔还会摸一次网络。 */
const READ_TIMEOUT_MS = 30_000
/** 发起授权的上限：一次网络往返。 */
const BEGIN_TIMEOUT_MS = 60_000
/** 轮询的上限。设备码本身会先过期，这只是兜底。 */
const POLL_TIMEOUT_MS = 15 * 60_000

/**
 * 抑制 lark-cli 的更新与技能提示。
 *
 * 两者都会往 JSON 里塞 `_notice`。解析时忽略它就行，但少一个字段就少一处
 * 可能被误读成结果的东西。
 */
const QUIET_ENV = {
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
  LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
} as const

/** 一次 lark-cli 调用的结果。 */
interface CliResult {
  /** 进程退出码为 0。 */
  readonly ok: boolean
  /** 解析出来的 JSON，能解析的话。 */
  readonly json?: Record<string, unknown>
  /** 失败原因；`missing` 表示这台机器上根本没有 lark-cli。 */
  readonly failure?: { kind: 'missing' | 'failed'; message: string }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 跑一条 lark-cli 命令。
 *
 * 从不抛：调用方要区分的是"没装"、"跑失败了"和"跑成功了"，这三种都是答案。
 * @param args - 传给 lark-cli 的 argv。
 * @param timeoutMs - 这条命令的上限。
 * @param cwd - 工作目录；只有二维码那条需要（`--output` 只收当前目录下的相对路径）。
 * @param signal - 取消信号；轮询那条要真把子进程杀掉，否则放弃一次授权会留下
 * 一个继续等十五分钟的 lark-cli。
 * @returns 结果与失败原因。
 */
async function runLark(
  args: readonly string[], timeoutMs: number, cwd?: string, signal?: AbortSignal,
): Promise<CliResult> {
  const invocation = larkCliInvocation(args)
  return new Promise<CliResult>((resolve) => {
    execFile(
      invocation.file,
      [...invocation.args],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, ...QUIET_ENV },
        ...cwd === undefined ? {} : { cwd },
        ...signal === undefined ? {} : { signal },
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // stdout 先解析：lark-cli 失败时也常常回一份带 error 字段的 JSON，
        // 那比退出码更能说清楚发生了什么。
        let json: Record<string, unknown> | undefined
        try {
          json = record(JSON.parse(stdout))
        } catch {
          json = undefined
        }
        if (error === null) {
          resolve(json === undefined ? { ok: true } : { ok: true, json })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          resolve({ ok: false, failure: { kind: 'missing', message: 'lark-cli 不在这台机器上' } })
          return
        }
        const message = text(record(json?.error)?.message)
          ?? text(json?.message)
          ?? text(stderr.trim())
          ?? error.message
        resolve({
          ok: false,
          ...json === undefined ? {} : { json },
          failure: { kind: 'failed', message },
        })
      },
    )
  })
}

/**
 * `auth login --domain` 收的全部业务域，抄自 lark-cli v1.0.87 的 `--help`。
 *
 * 这是一份白名单而不是一条正则：域名要原样进 argv，而来源是浏览器。写成
 * `/^[a-z-]+$/` 之类的形状校验会放行 `--scope` —— 连字符在字符类里，一个看起来
 * 像标志的值就能改掉整条命令的意思。固定集合就没有这种缝。
 */
export const AUTH_DOMAINS = [
  'im', 'docs', 'drive', 'calendar', 'contact', 'mail', 'task', 'approval',
  'base', 'sheets', 'slides', 'wiki', 'vc', 'okr', 'minutes', 'note',
  'attendance', 'markdown', 'mindnotes', 'application', 'apps', 'event', 'all',
] as const

/** 一个业务域。 */
export type AuthDomain = typeof AUTH_DOMAINS[number]

const DOMAIN_SET: ReadonlySet<string> = new Set(AUTH_DOMAINS)

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

/** 这台机器上的飞书登录态。 */
export interface AuthStatus {
  /** lark-cli 在不在。不在的话下面全是空的，页面只能先让人去装。 */
  readonly installed: boolean
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

function identityOf(value: unknown): AuthIdentity | undefined {
  const source = record(value)
  if (source === undefined) return undefined
  return {
    status: text(source.status) ?? 'unknown',
    available: source.available === true,
    message: text(source.message) ?? '',
  }
}

function userIdentityOf(value: unknown): AuthUserIdentity | undefined {
  const base = identityOf(value)
  const source = record(value)
  if (base === undefined || source === undefined) return undefined
  const scope = text(source.scope)
  return {
    ...base,
    ...text(source.openId) === undefined ? {} : { openId: text(source.openId)! },
    ...text(source.userName) === undefined ? {} : { userName: text(source.userName)! },
    ...text(source.tokenStatus) === undefined ? {} : { tokenStatus: text(source.tokenStatus)! },
    scopes: scope === undefined ? [] : scope.split(/\s+/).filter(Boolean),
    ...text(source.expiresAt) === undefined ? {} : { expiresAt: text(source.expiresAt)! },
    ...text(source.refreshExpiresAt) === undefined
      ? {}
      : { refreshExpiresAt: text(source.refreshExpiresAt)! },
  }
}

/**
 * 一次登录尝试的在途状态。
 *
 * `device_code` 只活在这里，从不上屏也从不回给浏览器：它等价于一张待兑换的
 * 授权票，页面拿它没有用处，泄漏出去却能被人替你把授权兑走。
 */
interface Pending {
  readonly challenge: AuthChallenge
  /** 轮询进程结束时落定；`undefined` 表示还在等。 */
  outcome: { granted: boolean; message?: string } | undefined
}

/** 插件这一侧的扫码登录与权限查询。 */
export class LarkAuth {
  private pending: Pending | undefined
  private aborter: AbortController | undefined

  /**
   * 读当前登录态。
   * @returns 登录态；lark-cli 不在时 `installed` 为 false。
   */
  async status(): Promise<AuthStatus> {
    const result = await runLark(['auth', 'status', '--json'], READ_TIMEOUT_MS)
    if (result.failure?.kind === 'missing') return { installed: false }
    if (!result.ok || result.json === undefined) {
      return { installed: true, error: result.failure?.message ?? 'lark-cli 没有返回可解析的登录态' }
    }
    const json = result.json
    const identities = record(json.identities)
    const bot = identityOf(identities?.bot)
    const user = userIdentityOf(identities?.user)
    return {
      installed: true,
      ...text(json.appId) === undefined ? {} : { appId: text(json.appId)! },
      ...text(json.brand) === undefined ? {} : { brand: text(json.brand)! },
      ...text(json.identity) === undefined ? {} : { identity: text(json.identity)! },
      ...bot === undefined ? {} : { bot },
      ...user === undefined ? {} : { user },
    }
  }

  /**
   * 把一个链接变成二维码 PNG 的 data URI。
   *
   * `--output` 只收当前目录下的相对路径，所以在一个临时目录里跑再读回来。
   * 失败不算错：页面上链接和二维码是并列的两条路，少一条还能走另一条。
   * @param url - 原样传入的验证链接。
   * @returns data URI，生成不出来就是 undefined。
   */
  private async qrcode(url: string): Promise<string | undefined> {
    let dir: string | undefined
    try {
      dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-qr-'))
      const result = await runLark(['auth', 'qrcode', url, '--output', 'qr.png'], READ_TIMEOUT_MS, dir)
      if (!result.ok) return undefined
      const png = await readFile(join(dir, 'qr.png'))
      return `data:image/png;base64,${png.toString('base64')}`
    } catch {
      return undefined
    } finally {
      if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * 发起一次扫码授权。
   *
   * `auth login` 必须带范围，`--domain` 或 `--scope` 至少给一个；多次登录的
   * scope 是累加的，所以只勾这次要加的就够了。已经在等的那一次会被顶掉——
   * 页面上只有一张二维码，留着旧的只会让人扫到一张已经不作数的。
   * @param domains - 要开通的业务域。
   * @returns 链接与二维码；发起失败时是失败态。
   */
  async begin(domains: readonly string[]): Promise<AuthProgress> {
    this.cancel()
    const wanted = domains.filter(domain => DOMAIN_SET.has(domain))
    if (wanted.length === 0) return { phase: 'failed', message: '至少要选一个要开通的权限域' }

    const started = await runLark(
      ['auth', 'login', '--no-wait', '--json', '--domain', wanted.join(',')],
      BEGIN_TIMEOUT_MS,
    )
    if (started.failure?.kind === 'missing') {
      return { phase: 'failed', message: 'lark-cli 不在这台机器上' }
    }
    const json = started.json
    const url = text(json?.verification_url) ?? text(json?.verification_uri_complete)
    const deviceCode = text(json?.device_code)
    if (!started.ok || url === undefined || deviceCode === undefined) {
      return {
        phase: 'failed',
        message: started.failure?.message ?? 'lark-cli 没有回授权链接',
      }
    }

    const qrDataUrl = await this.qrcode(url)
    const challenge: AuthChallenge = {
      verificationUrl: url,
      ...qrDataUrl === undefined ? {} : { qrDataUrl },
    }
    const pending: Pending = { challenge, outcome: undefined }
    this.pending = pending
    this.poll(pending, deviceCode)
    return { phase: 'waiting', challenge }
  }

  /**
   * 在后台轮询到用户扫完为止。
   * @param pending - 这一次尝试的状态槽。
   * @param deviceCode - 只在这里出现的设备码。
   */
  private poll(pending: Pending, deviceCode: string): void {
    const aborter = new AbortController()
    this.aborter = aborter
    void runLark(['auth', 'login', '--device-code', deviceCode, '--json'], POLL_TIMEOUT_MS, undefined, aborter.signal)
      .then((result) => {
        if (aborter.signal.aborted) return
        pending.outcome = result.ok
          ? { granted: true }
          : { granted: false, message: result.failure?.message ?? '授权没有完成' }
      })
      .catch((error: unknown) => {
        if (aborter.signal.aborted) return
        pending.outcome = { granted: false, message: error instanceof Error ? error.message : String(error) }
      })
  }

  /**
   * 这一次授权走到哪一步了。
   * @returns 当前进度；落定之后再读一次就回到 idle。
   */
  progress(): AuthProgress {
    const pending = this.pending
    if (pending === undefined) return { phase: 'idle' }
    if (pending.outcome === undefined) return { phase: 'waiting', challenge: pending.challenge }
    // 落定就把槽清掉：页面读到一次结果就够了，留着会让下一次发起看起来"早就成了"。
    this.pending = undefined
    this.aborter = undefined
    return pending.outcome.granted
      ? { phase: 'granted' }
      : { phase: 'failed', message: pending.outcome.message ?? '授权没有完成' }
  }

  /** 放弃正在等的那一次授权。 */
  cancel(): void {
    this.aborter?.abort()
    this.aborter = undefined
    this.pending = undefined
  }

  /**
   * 退出本机登录态。
   *
   * 只清这台机器上的 token；用户在飞书那边给应用的授权仍然在，要撤销得去飞书
   * 的授权管理页。页面必须把这句话说出来，否则"退出登录"会被当成"取消授权"。
   * @returns 是否真的退了，以及失败原因。
   */
  async logout(): Promise<{ loggedOut: boolean; message?: string }> {
    this.cancel()
    const result = await runLark(['auth', 'logout', '--json'], READ_TIMEOUT_MS)
    if (result.ok) return { loggedOut: result.json?.loggedOut !== false }
    return { loggedOut: false, message: result.failure?.message ?? '退出登录没有成功' }
  }
}
