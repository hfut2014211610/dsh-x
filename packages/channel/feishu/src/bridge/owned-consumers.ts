/**
 * 桥接对自己 spawn 出去的 lark-cli 消费者留的字条，以及下次启动时按字条回收。
 *
 * 正常收摊会把每个消费者关掉——关 stdin，等它自己把**服务端**那份订阅退掉。
 * 但被直接杀掉的桥接（任务管理器、崩溃、断电）根本走不到那条路，留下的消费者
 * 还占着 EventKey，而**一个 EventKey 只允许一个消费者**，于是下一次起桥接就
 * 抢不到，表现成「桥接跑着但一条消息都收不到」。
 *
 * 下一次启动是这些孤儿唯一还能被认出来的地方，所以每次 spawn 都写下 pid，
 * 起来时先读回来。
 *
 * **pid 不是身份**：操作系统会重用 pid，只凭 pid 去杀，杀掉的可能是一个跟桥接
 * 毫无关系的进程。所以字条同时记下 EventKey，回收时两条证据都要对上——pid 还
 * 活着，**并且**那个进程的命令行里确实有这个 EventKey。两条同时凑巧对上，需要
 * pid 被重用之后，新进程的命令行里恰好还带着同一个 EventKey。
 *
 * 只用 node 内置：桥接刻意不 import 任何 dsh 包，它得能在没有仓库的机器上单独跑。
 * @module dsh-feishu/bridge/owned-consumers
 */

import { spawnSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'

/** 桥接 spawn 一个消费者之后写下的东西。 */
export interface OwnedConsumer {
  /** 子进程 pid，要杀的就是它。 */
  pid: number
  /** 它认领的 EventKey，身份检查的第二半。 */
  eventKey: string
}

/** 环境依赖；每一个都是测试可以替换的接缝。 */
export interface ReapDeps {
  /** 上一次留下的字条，没有就是空的。 */
  readRecords: () => Promise<readonly OwnedConsumer[]>
  /** 扔掉字条；每条路径都要走，包括一个都没杀的那条。 */
  clearRecords: () => Promise<void>
  /** pid 是否还指向一个活着的进程。 */
  alive: (pid: number) => boolean
  /** 这个 pid 的命令行；拿不到就是 undefined。 */
  commandLine: (pid: number) => string | undefined
  /** 杀掉它。 */
  kill: (pid: number) => void
}

/**
 * 回收上一次桥接没来得及停掉的消费者。
 *
 * 无论结果如何都会清掉字条：留着过期的字条等于让它被反复检查，而每检查一次，
 * 它记的那个 pid 就多一次被别人重用的机会。
 * @param deps - 环境依赖。
 * @returns 每杀掉一个写一行日志；没动过任何进程时是空数组。
 */
export async function reapOwnedConsumers(deps: ReapDeps): Promise<string[]> {
  const records = await deps.readRecords()
  const lines: string[] = []
  for (const record of records) {
    if (!deps.alive(record.pid)) continue
    const command = deps.commandLine(record.pid)
    // 命令行读不到（权限、进程刚好在这一刻退了）就当它不是我们的：宁可留一个
    // 孤儿让人手工处理，也不能凭 pid 杀一个不认识的进程。
    if (command === undefined || !command.includes(record.eventKey)) continue
    deps.kill(record.pid)
    lines.push(`回收上次留下的消费者 ${record.eventKey}（pid ${String(record.pid)}）`)
  }
  await deps.clearRecords()
  return lines
}

/**
 * 读某个 pid 的命令行。
 *
 * 两个平台各自一条最普通的查询，都只用 node 内置的 spawnSync。失败一律返回
 * undefined，交给上面那条「读不到就不动」的规则。
 * @param pid - 要查的进程。
 * @returns 命令行文本，拿不到时 undefined。
 */
export function readCommandLine(pid: number): string | undefined {
  const query = process.platform === 'win32'
    ? {
      file: 'powershell.exe',
      args: [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`,
      ],
    }
    : { file: 'ps', args: ['-p', String(pid), '-o', 'args='] }
  try {
    const result = spawnSync(query.file, query.args, { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
    if (result.status !== 0) return undefined
    const text = result.stdout.trim()
    return text === '' ? undefined : text
  } catch {
    // spawnSync 只在拿不到那个可执行文件时抛；一样按「读不到」处理。
    return undefined
  }
}

/** `process.kill(pid, 0)`：不发信号，只问它还在不在。 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH 是没有这个进程；EPERM 是有但不归我们管，那也不该去杀它。
    return false
  }
}

/**
 * 把字条落到磁盘上，整份覆盖。
 *
 * 整份写而不是追加：字条描述的是「此刻这个桥接拥有哪些消费者」，追加会让已经
 * 停掉的消费者永远留在里面。
 * @param path - 字条文件。
 * @param records - 此刻拥有的全部消费者。
 */
export async function writeOwnedConsumers(path: string, records: readonly OwnedConsumer[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(records, undefined, 2)}\n`, 'utf8')
}

/**
 * 读回字条。
 *
 * 文件不存在、读不动、或者内容不是预期的形状，一律当作没有字条——一份坏掉的
 * 字条能提供的最好结果就是什么都不做。
 * @param path - 字条文件。
 * @returns 上一次记下的消费者。
 */
export async function readOwnedConsumers(path: string): Promise<readonly OwnedConsumer[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is OwnedConsumer => (
      typeof entry === 'object' && entry !== null
      && typeof (entry as OwnedConsumer).pid === 'number'
      && typeof (entry as OwnedConsumer).eventKey === 'string'
    ))
  } catch {
    return []
  }
}

/** 扔掉字条；文件本来就不在也算成功。 */
export async function clearOwnedConsumers(path: string): Promise<void> {
  await rm(path, { force: true })
}
