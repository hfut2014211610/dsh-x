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
 * 每一条命令都带**显式的** `LARKSUITE_CLI_CONFIG_DIR`，一次都不用环境默认。
 * 这台机器上默认那份属于别的工具，而 `auth login` 会把 scope 加到那个应用上、
 * `auth logout` 会把那个应用的登录态清掉。隐式地跟着环境走，等于让这一页随手
 * 改动别人的授权。不指定就落到 dsh 自己那份（{@link dshConfigDir}）。
 *
 * @module @personal/dsh-x-feishu/src/auth
 */

import { execFile, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { larkCliInvocation } from '../bridge/cli.ts'

/** 读命令的上限。`auth status` 要解析 token，偶尔还会摸一次网络。 */
const READ_TIMEOUT_MS = 30_000
/** 发起授权的上限：一次网络往返。 */
const BEGIN_TIMEOUT_MS = 60_000
/** 轮询的上限。设备码本身会先过期，这只是兜底。 */
const POLL_TIMEOUT_MS = 15 * 60_000
/** 建应用那一步等多久才该吐出验证链接。 */
const BIND_URL_TIMEOUT_MS = 60_000
/** 建应用整个过程的上限：它一直挂到人在浏览器里做完。 */
const BIND_TIMEOUT_MS = 15 * 60_000

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

/**
 * lark-cli 存 profile 的根目录。
 * @returns `~/.lark-cli`。
 */
function larkRoot(): string {
  return join(homedir(), '.lark-cli')
}

/** dsh 默认用的那个 profile 名。 */
export const DEFAULT_PROFILE_ID = 'dsh'

/**
 * dsh 自己的家目录。
 *
 * 自己算而不是 import 那个包：这一层要跟桥接共用，而桥接不 import 任何 dsh 包。
 * 规则与宿主一致——`DSH_HOME` 优先，否则 `~/.dsh`。
 * @returns 绝对路径。
 */
export function dshHome(): string {
  const declared = process.env.DSH_HOME?.trim()
  return declared !== undefined && declared !== '' ? declared : join(homedir(), '.dsh')
}

/**
 * dsh 自己那份 profile 的目录。
 *
 * 单独一份，不跟环境默认共用：默认那份先到先得，谁跑过 `lark-cli config init`
 * 就是谁的，而这一页的每个动作都会改到它。
 * @returns `~/.lark-cli/dsh`。
 */
export function dshConfigDir(): string {
  return join(larkRoot(), DEFAULT_PROFILE_ID)
}

/**
 * 把请求解析成真正要用的那个目录。
 *
 * 收三种写法：空串落到 dsh 自己那份（**不落到环境默认**）；一个不带分隔符的
 * 名字当 profile id，落到 `~/.lark-cli/<id>`；带分隔符的当绝对路径原样用。
 * 这是唯一的收口——只要每条命令都经过它，就不存在"忘了指定于是改了别人的
 * 应用"这条路。
 * @param requested - 目录、profile id，或空串。
 * @returns 要写进 `LARKSUITE_CLI_CONFIG_DIR` 的绝对路径。
 */
export function resolveConfigDir(requested: string): string {
  const value = requested.trim()
  if (value === '') return dshConfigDir()
  // 带分隔符的当路径，原样用。
  if (value.includes('/') || value.includes('\\')) return value
  // 剩下的当 profile 名。名字里只收这几类字符，`.` 与 `..` 一并挡掉——一个
  // 设置项不该有办法把目录指到 `~/.lark-cli` 外面去。
  const named = /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..'
  return named ? join(larkRoot(), value) : dshConfigDir()
}

/**
 * 等一条长跑命令把验证链接打出来。
 *
 * 它不会因此结束——链接出现的时候人还没开始操作。所以这里只等到第一条链接，
 * 进程留着继续跑。
 * @param child - 已经在跑的子进程。
 * @param output - 到目前为止收到的全部输出。
 * @param timeoutMs - 等多久放弃。
 * @returns 第一条 https 链接；没等到就是 `undefined`。
 */
function firstUrl(
  child: ChildProcessByStdio<null, Readable, Readable>,
  output: () => string,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const done = (url: string | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', look)
      child.stderr.off('data', look)
      child.off('exit', onExit)
      resolve(url)
    }
    const look = (): void => {
      const match = /https:\/\/\S+/.exec(output())
      if (match !== null) done(match[0].replace(/[)\]"',.]+$/, ''))
    }
    const onExit = (): void => { look(); done(undefined) }
    const timer = setTimeout(() => { done(undefined) }, timeoutMs)
    timer.unref()
    child.stdout.on('data', look)
    child.stderr.on('data', look)
    child.once('exit', onExit)
    look()
  })
}

/**
 * 一段输出里最后那句有内容的话，用来当失败原因。
 * @param output - 全部输出。
 * @returns 最后一行非空文本；全空就是 `undefined`。
 */
function tailOf(output: string): string | undefined {
  const lines = output.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.at(-1)
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

/** 一次 lark-cli 调用的结果。 */
interface CliResult {
  /** 进程退出码为 0。 */
  readonly ok: boolean
  /** 解析出来的 JSON，能解析的话。 */
  readonly json?: Record<string, unknown>
  /**
   * 失败原因。`missing` 是这台机器上没有 lark-cli，`unconfigured` 是这份
   * profile 还没绑应用——两者都不是"没登录"，指向的下一步也完全不同。
   */
  readonly failure?: { kind: 'missing' | 'unconfigured' | 'failed'; message: string; hint?: string }
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
 * @param configDir - 这条命令作用在哪份 profile 上。必填，没有"跟着环境走"。
 * @param args - 传给 lark-cli 的 argv。
 * @param timeoutMs - 这条命令的上限。
 * @param cwd - 工作目录；只有二维码那条需要（`--output` 只收当前目录下的相对路径）。
 * @param signal - 取消信号；轮询那条要真把子进程杀掉，否则放弃一次授权会留下
 * 一个继续等十五分钟的 lark-cli。
 * @returns 结果与失败原因。
 */
async function runLark(
  configDir: string, args: readonly string[], timeoutMs: number, cwd?: string, signal?: AbortSignal,
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
        env: { ...process.env, ...QUIET_ENV, LARKSUITE_CLI_CONFIG_DIR: configDir },
        ...cwd === undefined ? {} : { cwd },
        ...signal === undefined ? {} : { signal },
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // stdout 先、stderr 后：lark-cli 成功时把结果写 stdout，失败时把那份
        // 带 `error.subtype` 的信封写 stderr。只读 stdout 的话，"这份 profile
        // 还没绑应用"就会退化成一整坨 JSON 塞进错误消息里。
        const parse = (raw: string): Record<string, unknown> | undefined => {
          try {
            return record(JSON.parse(raw))
          } catch {
            return undefined
          }
        }
        const json = parse(stdout) ?? parse(stderr)
        if (error === null) {
          resolve(json === undefined ? { ok: true } : { ok: true, json })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          resolve({ ok: false, failure: { kind: 'missing', message: 'lark-cli 不在这台机器上' } })
          return
        }
        const envelope = record(json?.error)
        const message = text(envelope?.message)
          ?? text(json?.message)
          ?? text(stderr.trim())
          ?? error.message
        // 「这份 profile 还没绑应用」有它自己的下一步（`config init`），跟登录
        // 失败不是一回事，所以在这里就分开，别让上层去猜措辞。
        const unconfigured = envelope?.subtype === 'not_configured' || envelope?.type === 'config'
        const hint = text(envelope?.hint)
        resolve({
          ok: false,
          ...json === undefined ? {} : { json },
          failure: {
            kind: unconfigured ? 'unconfigured' : 'failed',
            message,
            ...hint === undefined ? {} : { hint },
          },
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

/**
 * 列出这台机器上可以管理的 profile。
 *
 * 直接读每个目录的 `config.json` 而不是逐个 spawn lark-cli：快，而且读一份
 * 配置不该有任何副作用。
 * @returns 默认那份、每个子目录一份，外加 dsh 自己那份（哪怕还不存在）。
 */
export async function discoverProfiles(): Promise<AuthProfile[]> {
  const root = larkRoot()
  const owned = dshConfigDir()
  const seen = new Map<string, AuthProfile>()

  const appIdOf = async (dir: string): Promise<string | undefined> => {
    try {
      const parsed = record(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')))
      const apps = parsed?.apps
      if (!Array.isArray(apps)) return undefined
      return text(record(apps[0])?.appId)
    } catch {
      return undefined
    }
  }

  const add = async (dir: string, name: string): Promise<void> => {
    const appId = await appIdOf(dir)
    // 没绑应用就**不写这个字段**，而不是写一个 undefined：RPC 边界按"键在不在"
    // 校验，一个值为 undefined 的键会被判成类型不对，整条结果被拒。
    seen.set(dir, {
      configDir: dir,
      name,
      ...appId === undefined ? {} : { appId },
      owned: dir === owned,
    })
  }

  await add(root, 'default')
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      if (await appIdOf(dir) === undefined && dir !== owned) continue
      await add(dir, basename(dir))
    }
  } catch {
    // 根目录都没有：这台机器上还没用过 lark-cli，下面 dsh 那份照样要列出来。
  }
  if (!seen.has(owned)) seen.set(owned, { configDir: owned, name: basename(owned), owned: true })
  return [...seen.values()]
}

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
  /** 这次授权作用在哪份 profile 上。 */
  readonly configDir: string
  readonly challenge: AuthChallenge
  /** 轮询进程结束时落定；`undefined` 表示还在等。 */
  outcome: { granted: boolean; message?: string } | undefined
}

/** 插件这一侧的扫码登录与权限查询。 */
export class LarkAuth {
  private pending: Pending | undefined
  private aborter: AbortController | undefined

  /**
   * 读某一份 profile 的登录态。
   * @param requestedDir - 要读哪个目录；空串落到 dsh 自己那份。
   * @returns 登录态；lark-cli 不在时 `installed` 为 false。
   */
  async status(requestedDir: string): Promise<AuthStatus> {
    const configDir = resolveConfigDir(requestedDir)
    const result = await runLark(configDir, ['auth', 'status', '--json'], READ_TIMEOUT_MS)
    if (result.failure?.kind === 'missing') {
      return { configDir, installed: false, configured: false }
    }
    if (result.failure?.kind === 'unconfigured') {
      return {
        configDir,
        installed: true,
        configured: false,
        ...result.failure.hint === undefined ? {} : { configHint: result.failure.hint },
      }
    }
    if (!result.ok || result.json === undefined) {
      return {
        configDir,
        installed: true,
        configured: true,
        error: result.failure?.message ?? 'lark-cli 没有返回可解析的登录态',
      }
    }
    const json = result.json
    const identities = record(json.identities)
    const bot = identityOf(identities?.bot)
    const user = userIdentityOf(identities?.user)
    return {
      configDir,
      installed: true,
      configured: true,
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
  private async qrcode(configDir: string, url: string): Promise<string | undefined> {
    let dir: string | undefined
    try {
      dir = await mkdtemp(join(tmpdir(), 'dsh-feishu-qr-'))
      const result = await runLark(configDir, ['auth', 'qrcode', url, '--output', 'qr.png'], READ_TIMEOUT_MS, dir)
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
   * 给这份 profile 建一个飞书应用。
   *
   * 扫码授权之前的那一步。没有应用就没有可授权的对象，所以一份新 profile 上
   * 「扫码授权」是点不了的——先得有个应用。
   *
   * `config init --new` 与设备码是同一个形状：它一直挂到人在浏览器里做完，中途
   * 把验证链接打到输出里。所以这里也是后台跑、页面轮询，而且**跟授权共用同一个
   * 进度槽**——页面那条轮询循环因此一行都不用改。
   *
   * 它没有 `--json`，只能从输出里捞第一条 https 链接。
   * @param requestedDir - 建在哪份 profile 上；空串落到 dsh 自己那份。
   * @returns 链接与二维码，或失败原因。
   */
  async bind(requestedDir: string): Promise<AuthProgress> {
    this.cancel()
    const configDir = resolveConfigDir(requestedDir)
    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      const invocation = larkCliInvocation(['config', 'init', '--new'])
      child = spawn(invocation.file, [...invocation.args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...QUIET_ENV, LARKSUITE_CLI_CONFIG_DIR: configDir },
      })
    } catch (error: unknown) {
      return { phase: 'failed', message: error instanceof Error ? error.message : String(error) }
    }

    const seen: string[] = []
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const collect = (chunk: string): void => { seen.push(chunk) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const aborter = new AbortController()
    this.aborter = aborter
    aborter.signal.addEventListener('abort', () => { child.kill() })

    const url = await firstUrl(child, () => seen.join(''), BIND_URL_TIMEOUT_MS)
    if (url === undefined) {
      child.kill()
      this.aborter = undefined
      return { phase: 'failed', message: tailOf(seen.join('')) ?? 'lark-cli 没有回建应用的链接' }
    }

    const qrDataUrl = await this.qrcode(configDir, url)
    const pending: Pending = {
      configDir,
      challenge: { verificationUrl: url, ...qrDataUrl === undefined ? {} : { qrDataUrl } },
      outcome: undefined,
    }
    this.pending = pending
    this.watchBind(pending, child, aborter, () => seen.join(''))
    return { phase: 'waiting', challenge: pending.challenge }
  }

  /** 等 `config init` 退出，然后看这份 profile 到底绑上没有。 */
  private watchBind(
    pending: Pending,
    child: ChildProcessByStdio<null, Readable, Readable>,
    aborter: AbortController,
    output: () => string,
  ): void {
    const timer = setTimeout(() => { child.kill() }, BIND_TIMEOUT_MS)
    timer.unref()
    child.once('exit', (code: number | null) => {
      clearTimeout(timer)
      if (aborter.signal.aborted) return
      // 以 `auth status` 为准而不是退出码：真正要问的是"这份 profile 现在有
      // 应用了没有"，而不是"那条命令自认为成功了没有"。
      void this.status(pending.configDir).then((status) => {
        pending.outcome = status.configured === true
          ? { granted: true }
          : { granted: false, message: tailOf(output()) ?? `lark-cli 退出码 ${String(code)}` }
      }).catch((error: unknown) => {
        pending.outcome = { granted: false, message: error instanceof Error ? error.message : String(error) }
      })
    })
  }

  /**
   * 发起一次扫码授权。
   *
   * `auth login` 必须带范围，`--domain` 或 `--scope` 至少给一个；多次登录的
   * scope 是累加的，所以只勾这次要加的就够了。已经在等的那一次会被顶掉——
   * 页面上只有一张二维码，留着旧的只会让人扫到一张已经不作数的。
   * @param requestedDir - 授权给哪份 profile；空串落到 dsh 自己那份。
   * @param domains - 要开通的业务域。
   * @returns 链接与二维码；发起失败时是失败态。
   */
  async begin(requestedDir: string, domains: readonly string[]): Promise<AuthProgress> {
    this.cancel()
    const configDir = resolveConfigDir(requestedDir)
    const wanted = domains.filter(domain => DOMAIN_SET.has(domain))
    if (wanted.length === 0) return { phase: 'failed', message: '至少要选一个要开通的权限域' }

    const started = await runLark(
      configDir,
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

    const qrDataUrl = await this.qrcode(configDir, url)
    const challenge: AuthChallenge = {
      verificationUrl: url,
      ...qrDataUrl === undefined ? {} : { qrDataUrl },
    }
    const pending: Pending = { configDir, challenge, outcome: undefined }
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
    void runLark(pending.configDir, ['auth', 'login', '--device-code', deviceCode, '--json'], POLL_TIMEOUT_MS, undefined, aborter.signal)
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
   * @param requestedDir - 退哪份 profile；空串落到 dsh 自己那份。
   * @returns 是否真的退了，以及失败原因。
   */
  async logout(requestedDir: string): Promise<{ loggedOut: boolean; message?: string }> {
    this.cancel()
    const result = await runLark(resolveConfigDir(requestedDir), ['auth', 'logout', '--json'], READ_TIMEOUT_MS)
    if (result.ok) return { loggedOut: result.json?.loggedOut !== false }
    return { loggedOut: false, message: result.failure?.message ?? '退出登录没有成功' }
  }
}
