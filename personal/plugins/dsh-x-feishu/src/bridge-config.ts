/**
 * 桥接那份配置的形状、默认值，以及读写它的两端。
 *
 * **dsh-x 是这份配置的唯一出处。** 插件把设置里的值写成
 * `~/.dsh-x-feishu/config.json`，桥接只管读，并且盯着这个文件的变化。这么定是
 * 因为桥接没有界面也没有设置服务，而它要的每一项——准入名单、接哪几个飞书应用、
 * dsh 在哪——都是人在 dsh 的设置页里决定的事。让桥接另外拿一份手写 JSON，等于
 * 同一件事有两个地方要改，改一处不生效。
 *
 * 反过来，桥接**不能**在运行时向 dsh 要配置：它存在的意义之一就是 dsh 不在时
 * 顶上。所以两端之间是一个文件而不是一条 RPC——文件在 dsh 挂了以后还在。
 *
 * 分工写死在 {@link PublishedBridgeFields}：那几项归设置页，写的时候整个盖掉；
 * 其余字段（`launch`、`botOpenIds`）文件里原样留着，因为它们是"怎么把 dsh 拉
 * 起来"和"认证兜底"这类装机时定一次的事，不该占设置页的位置。
 *
 * 只用 node 内置：桥接不 import 任何 dsh 包，这个模块在它那一侧也要能用。
 *
 * @module @personal/dsh-x-feishu/src/bridge-config
 */

import { watch } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DEFAULT_POLICY, type AccessPolicy } from './lark-events.ts'
import { defaultEndpoint } from './protocol.ts'
import { defaultEventRelayEndpoint } from '../bridge/relay.ts'

/** 文件顶上那句话的键。JSON 没有注释，只能占一个字段。 */
const NOTE_KEY = '//'

/** 写进文件的那句话：告诉打开它的人这不是手改的地方。 */
const NOTE = '由 dsh 的「设置 → 连接器 → 飞书」写出，桥接只读。手改这里的 endpoint / '
  + 'eventEndpoint / eventConfigDirs / cardActionConfigDirs / eventCommand / policy / probeOrigin '
  + '会在下次保存时被盖掉；launch 与 botOpenIds 不归设置页管，改了会留着。'

/** 桥接怎么把不在的 dsh 拉起来。装机时定一次，不归设置页管。 */
export interface BridgeLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
}

/** 桥接进程要的全部配置。 */
export interface BridgeConfig {
  /** dsh 插件连进来的本地端点。 */
  readonly endpoint: string
  /** 其他本机 Agent 只读订阅原始飞书事件的端点。 */
  readonly eventEndpoint: string
  /**
   * 接哪几个飞书应用。每个应用的每个 EventKey 仍然只有桥接里的一个 consumer；
   * 数组用来覆盖同一个群里的多个独立机器人应用。空数组沿用 lark-cli 的环境默认。
   */
  readonly eventConfigDirs: readonly string[]
  /** 卡片回调已在开发者后台订阅的应用；空数组表示与 {@link eventConfigDirs} 相同。 */
  readonly cardActionConfigDirs: readonly string[]
  /**
   * 替代 `lark-cli event consume` 的命令；空串表示照常 spawn lark-cli。
   *
   * 别的进程已经独占了那个 EventKey 时用它把事件引过来——一个 EventKey 只允许
   * 一个消费者，抢不过就只能接一根管子。事件键作为最后一个参数追加。
   */
  readonly eventCommand: string
  /** 准入策略。 */
  readonly policy: AccessPolicy
  /**
   * configDir → 机器人 open_id 的手工覆盖；没有的应用启动时向飞书问一次。
   * 键里的空串指环境默认那份。
   */
  readonly botOpenIds: Readonly<Record<string, string>>
  /** 探这个地址判断 dsh 在不在，与桌面壳同一套。 */
  readonly probeOrigin: string
  /** dsh 不在时用什么命令拉起来。 */
  readonly launch: BridgeLaunch
}

/**
 * 设置页管的那几项。
 *
 * 列在这里的字段每次保存都整个盖掉文件里的旧值——这正是"dsh-x 是唯一出处"的
 * 意思。没列在这里的字段，写的时候读出来再原样写回去。
 */
export type PublishedBridgeFields = Pick<
  BridgeConfig,
  'endpoint' | 'eventEndpoint' | 'eventConfigDirs' | 'cardActionConfigDirs'
  | 'eventCommand' | 'policy' | 'probeOrigin'
>

/** 一次读取的结果。 */
export interface BridgeConfigRead {
  readonly config: BridgeConfig
  /** 没读到或读坏了的原因；读到了就没有这个字段。 */
  readonly problem?: string
}

/**
 * 配置文件的位置。
 * @returns `~/.dsh-x-feishu/config.json`。
 */
export function bridgeConfigPath(): string {
  return join(homedir(), '.dsh-x-feishu', 'config.json')
}

/**
 * 桥接留给下次启动的字条位置：上一次它 spawn 了哪些 lark-cli 消费者。
 *
 * 跟配置放一个目录，因为它们描述的是同一个桥接实例。
 * @returns `~/.dsh-x-feishu/owned-consumers.json`。
 */
export function ownedConsumersPath(): string {
  return join(homedir(), '.dsh-x-feishu', 'owned-consumers.json')
}

/** 什么都没配时桥接跑成什么样：默认拒绝，谁都用不了。 */
export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  endpoint: defaultEndpoint(),
  eventEndpoint: defaultEventRelayEndpoint(),
  eventConfigDirs: [],
  cardActionConfigDirs: [],
  eventCommand: '',
  policy: DEFAULT_POLICY,
  botOpenIds: {},
  probeOrigin: 'http://127.0.0.1:13080',
  launch: { command: 'pnpm', args: ['dsh', 'web'] },
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/**
 * 收一个字符串数组：丢掉非字符串与空白项，再去重。
 *
 * 去重不是洁癖：同一个 configDir 写两遍就是两个 consumer 抢同一个 EventKey，
 * 而那正是这套设计从头到尾在躲的一件事。
 * @param value - 读到的值。
 * @returns 规整后的数组；不是数组时为空。
 */
function uniqueList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const trimmed = value.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim()] : [])
  return [...new Set(trimmed)]
}

function natural(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

function policyOf(value: unknown): AccessPolicy {
  const record = recordOf(value) ?? {}
  const mode = record.dmMode
  return {
    dmMode: mode === 'open' || mode === 'allowlist' || mode === 'disabled' ? mode : DEFAULT_POLICY.dmMode,
    dmAllowlist: uniqueList(record.dmAllowlist),
    groupAllowlist: uniqueList(record.groupAllowlist),
    requireMention: typeof record.requireMention === 'boolean'
      ? record.requireMention
      : DEFAULT_POLICY.requireMention,
    staleMs: natural(record.staleMs, DEFAULT_POLICY.staleMs),
  }
}

function launchOf(value: unknown): BridgeLaunch {
  const record = recordOf(value)
  if (record === undefined) return DEFAULT_BRIDGE_CONFIG.launch
  const args = Array.isArray(record.args)
    ? record.args.flatMap(item => typeof item === 'string' ? [item] : [])
    : DEFAULT_BRIDGE_CONFIG.launch.args
  const cwd = typeof record.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
  return {
    command: text(record.command, DEFAULT_BRIDGE_CONFIG.launch.command),
    args,
    // 没有工作目录时不写这个字段，而不是写一个 undefined。
    ...cwd === undefined ? {} : { cwd },
  }
}

/** 老文件里那个单数的 `botOpenId` 指的是环境默认那份，收进 map 的空串键。 */
function botOpenIdsOf(record: Record<string, unknown>): Readonly<Record<string, string>> {
  const map: Record<string, string> = {}
  const legacy = record.botOpenId
  if (typeof legacy === 'string' && legacy.trim() !== '') map[''] = legacy.trim()
  for (const [key, value] of Object.entries(recordOf(record.botOpenIds) ?? {})) {
    if (typeof value === 'string' && value.trim() !== '') map[key.trim()] = value.trim()
  }
  return map
}

/**
 * 把读到的 JSON 收成一份配置。
 *
 * 纯函数，不碰磁盘：桥接读到什么就跑成什么，这一步的判断值得单独拿出来测。
 * @param parsed - `JSON.parse` 的结果。
 * @returns 补齐默认值、去掉脏值之后的配置。
 */
export function normalizeBridgeConfig(parsed: unknown): BridgeConfig {
  const record = recordOf(parsed)
  if (record === undefined) return DEFAULT_BRIDGE_CONFIG
  return {
    endpoint: text(record.endpoint, DEFAULT_BRIDGE_CONFIG.endpoint),
    eventEndpoint: text(record.eventEndpoint, DEFAULT_BRIDGE_CONFIG.eventEndpoint),
    eventConfigDirs: uniqueList(record.eventConfigDirs),
    cardActionConfigDirs: uniqueList(record.cardActionConfigDirs),
    eventCommand: text(record.eventCommand, ''),
    policy: policyOf(record.policy),
    botOpenIds: botOpenIdsOf(record),
    probeOrigin: text(record.probeOrigin, DEFAULT_BRIDGE_CONFIG.probeOrigin),
    launch: launchOf(record.launch),
  }
}

/**
 * 读一次配置。
 * @param path - 文件位置；默认 {@link bridgeConfigPath}。
 * @returns 配置，以及没读到时的原因。
 */
export async function readBridgeConfig(path: string = bridgeConfigPath()): Promise<BridgeConfigRead> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    return { config: DEFAULT_BRIDGE_CONFIG, problem: `没读到 ${path}：${messageOf(error)}` }
  }
  try {
    return { config: normalizeBridgeConfig(JSON.parse(raw)) }
  } catch (error: unknown) {
    return { config: DEFAULT_BRIDGE_CONFIG, problem: `${path} 不是合法 JSON：${messageOf(error)}` }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把设置页管的那几项写进文件，其余字段原样留着。
 *
 * 内容没变就不写：设置页保存的是整个命名空间，改一个跟桥接无关的字段不该在
 * 磁盘上留下一次写入，也不该惊动桥接的文件监听。
 * @param fields - 设置页管的那几项。
 * @param path - 文件位置；默认 {@link bridgeConfigPath}。
 * @returns 这次有没有真的写下去。
 */
export async function publishBridgeConfig(
  fields: PublishedBridgeFields,
  path: string = bridgeConfigPath(),
): Promise<boolean> {
  let existing: Record<string, unknown> = {}
  let before = ''
  try {
    before = await readFile(path, 'utf8')
    existing = recordOf(JSON.parse(before)) ?? {}
  } catch {
    // 没有文件或者文件坏了，都按"从头写一份"处理。
    before = ''
  }
  // 那句话排在最前面，所以先把旧的摘掉：留在原位的话，手写的文件里它会落在
  // 一堆字段后面，而它正是打开文件的人最需要先看到的一句。
  const { [NOTE_KEY]: _note, ...rest } = existing
  const merged = {
    [NOTE_KEY]: NOTE,
    ...rest,
    endpoint: fields.endpoint,
    eventEndpoint: fields.eventEndpoint,
    eventConfigDirs: [...fields.eventConfigDirs],
    cardActionConfigDirs: [...fields.cardActionConfigDirs],
    eventCommand: fields.eventCommand,
    policy: {
      dmMode: fields.policy.dmMode,
      dmAllowlist: [...fields.policy.dmAllowlist],
      groupAllowlist: [...fields.policy.groupAllowlist],
      requireMention: fields.policy.requireMention,
      staleMs: fields.policy.staleMs,
    },
    probeOrigin: fields.probeOrigin,
  }
  const after = `${JSON.stringify(merged, null, 2)}\n`
  if (after === before) return false
  await mkdir(dirname(path), { recursive: true })
  // 先写临时文件再改名：桥接随时可能在读，读到半截的 JSON 会让它退回默认策略。
  const staging = `${path}.tmp`
  await writeFile(staging, after, 'utf8')
  await rename(staging, path)
  return true
}

/**
 * 盯着配置文件的变化。
 *
 * 监听的是**目录**不是文件：写入走的是"临时文件 + 改名"，盯着文件本身的
 * watcher 会跟着旧的那个 inode 一起失效，此后一声不响。
 * @param path - 文件位置。
 * @param onChange - 文件动过之后调一次；短时间内的多次变化会合成一次。
 * @returns 停止监听。
 */
export function watchBridgeConfig(path: string, onChange: () => void): () => void {
  const target = basename(path)
  let timer: NodeJS.Timeout | undefined
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
      if (filename !== null && basename(String(filename)) !== target) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(onChange, 200)
      timer.unref()
    })
    watcher.on('error', () => {})
  } catch {
    // 目录还不存在，或者这个平台不支持目录监听：不能热更，但不该因此起不来。
    return () => {}
  }
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    watcher?.close()
  }
}
