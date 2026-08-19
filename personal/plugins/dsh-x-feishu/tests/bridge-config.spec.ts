/**
 * dsh-x 写、桥接读的那份配置。
 *
 * 这条线上最要紧的一件事是**分工**：设置页管的字段每次保存整个盖掉，其余字段
 * （怎么把 dsh 拉起来、机器人身份兜底）原样留着。搞反任何一边，人都会遇到
 * "在页面上改了不生效"或者"装机时配的东西被页面抹掉"。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BRIDGE_CONFIG, normalizeBridgeConfig, publishBridgeConfig, readBridgeConfig,
  type PublishedBridgeFields,
} from '../src/bridge-config.ts'
import { larkCliEnvironment } from '../bridge/cli.ts'

const FIELDS: PublishedBridgeFields = {
  endpoint: '\\\\.\\pipe\\dsh-x-feishu',
  eventEndpoint: '\\\\.\\pipe\\dsh-x-feishu-events',
  eventConfigDirs: ['C:\\lark\\dsh-x', 'C:\\lark\\agent-bus'],
  cardActionConfigDirs: ['C:\\lark\\dsh-x'],
  policy: {
    dmMode: 'allowlist',
    dmAllowlist: ['ou_me'],
    groupAllowlist: ['oc_team'],
    requireMention: true,
    staleMs: 600_000,
  },
  probeOrigin: 'http://127.0.0.1:13080',
}

let root: string
let path: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-x-feishu-config-'))
  path = join(root, 'config.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function readJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

describe('写出去', () => {
  it('从没有文件写起', async () => {
    expect(await publishBridgeConfig(FIELDS, path)).toBe(true)

    expect(await readJson()).toMatchObject({
      endpoint: FIELDS.endpoint,
      eventConfigDirs: FIELDS.eventConfigDirs,
      cardActionConfigDirs: FIELDS.cardActionConfigDirs,
      probeOrigin: FIELDS.probeOrigin,
      policy: { dmMode: 'allowlist', groupAllowlist: ['oc_team'] },
    })
  })

  it('顶上留一句话，说明这不是手改的地方', async () => {
    await publishBridgeConfig(FIELDS, path)

    const keys = Object.keys(await readJson())
    expect(keys[0]).toBe('//')
  })

  // 设置页保存的是整个命名空间。改一个跟桥接无关的字段不该在磁盘上留下一次
  // 写入，也不该惊动桥接那边的文件监听。
  it('内容没变就不写', async () => {
    await publishBridgeConfig(FIELDS, path)

    expect(await publishBridgeConfig(FIELDS, path)).toBe(false)
  })

  it('改了就写', async () => {
    await publishBridgeConfig(FIELDS, path)

    const changed = { ...FIELDS, policy: { ...FIELDS.policy, dmMode: 'open' as const } }
    expect(await publishBridgeConfig(changed, path)).toBe(true)
    expect((await readJson()).policy).toMatchObject({ dmMode: 'open' })
  })

  // 这两项是装机时定一次的事，不占设置页的位置，所以写的时候要原样留着。
  it('不归设置页管的字段留着', async () => {
    await writeFile(path, JSON.stringify({
      launch: { command: 'pnpm', args: ['dsh', 'web'], cwd: 'D:\\dev\\DSH-X' },
      botOpenIds: { '': 'ou_bot_default' },
      endpoint: '\\\\.\\pipe\\old',
    }), 'utf8')

    await publishBridgeConfig(FIELDS, path)

    const written = await readJson()
    expect(written.launch).toEqual({ command: 'pnpm', args: ['dsh', 'web'], cwd: 'D:\\dev\\DSH-X' })
    expect(written.botOpenIds).toEqual({ '': 'ou_bot_default' })
    // 归设置页管的那个，盖掉了。
    expect(written.endpoint).toBe(FIELDS.endpoint)
  })

  it('文件坏了就从头写一份，而不是罢工', async () => {
    await writeFile(path, '{ 这不是 JSON', 'utf8')

    expect(await publishBridgeConfig(FIELDS, path)).toBe(true)
    expect((await readJson()).endpoint).toBe(FIELDS.endpoint)
  })
})

describe('读回来', () => {
  it('读到什么就是什么', async () => {
    await publishBridgeConfig(FIELDS, path)

    const read = await readBridgeConfig(path)

    expect(read.problem).toBeUndefined()
    expect(read.config.eventConfigDirs).toEqual(FIELDS.eventConfigDirs)
    expect(read.config.policy.groupAllowlist).toEqual(['oc_team'])
  })

  it('没有文件就退回默认，并说清是为什么', async () => {
    const read = await readBridgeConfig(join(root, '不存在.json'))

    expect(read.config).toEqual(DEFAULT_BRIDGE_CONFIG)
    expect(read.problem).toContain('没读到')
  })

  it('文件坏了也退回默认，并说清是为什么', async () => {
    await writeFile(path, '{ 半截', 'utf8')

    const read = await readBridgeConfig(path)

    expect(read.config).toEqual(DEFAULT_BRIDGE_CONFIG)
    expect(read.problem).toContain('不是合法 JSON')
  })
})

describe('收脏值', () => {
  it('不是对象就当没配', () => {
    expect(normalizeBridgeConfig('nope')).toEqual(DEFAULT_BRIDGE_CONFIG)
    expect(normalizeBridgeConfig(null)).toEqual(DEFAULT_BRIDGE_CONFIG)
  })

  // 同一个目录写两遍就是两个 consumer 抢同一个 EventKey，而那正是这套设计
  // 从头到尾在躲的一件事。
  it('应用目录去重、去空白', () => {
    const config = normalizeBridgeConfig({
      eventConfigDirs: [' C:\\lark\\dsh-x ', 'C:\\lark\\dsh-x', '', 7],
    })

    expect(config.eventConfigDirs).toEqual(['C:\\lark\\dsh-x'])
  })

  it('认不得的 dmMode 退回默认拒绝', () => {
    expect(normalizeBridgeConfig({ policy: { dmMode: 'everyone' } }).policy.dmMode).toBe('allowlist')
  })

  // 老文件里那个单数的 botOpenId 指的就是环境默认那份。
  it('老的单数 botOpenId 收进空串键', () => {
    expect(normalizeBridgeConfig({ botOpenId: 'ou_legacy' }).botOpenIds).toEqual({ '': 'ou_legacy' })
  })

  it('新的 botOpenIds 压过老的', () => {
    const config = normalizeBridgeConfig({ botOpenId: 'ou_legacy', botOpenIds: { '': 'ou_new' } })

    expect(config.botOpenIds).toEqual({ '': 'ou_new' })
  })
})

describe('以谁的身份跑 lark-cli', () => {
  it('指定了目录就显式带上', () => {
    expect(larkCliEnvironment('C:\\lark\\dsh-x')).toMatchObject({
      LARKSUITE_CLI_CONFIG_DIR: 'C:\\lark\\dsh-x',
    })
  })

  // 空串是"沿用环境默认那份"，此时不能塞一个空的 CONFIG_DIR——lark-cli 会拿它
  // 当一个真的目录去找。
  it('空串不带这个变量', () => {
    expect(larkCliEnvironment('')).not.toHaveProperty('LARKSUITE_CLI_CONFIG_DIR')
  })

  // 两个 notifier 会往 JSON 输出里塞 _notice，而出站调用的返回值是要解析的。
  it('一直压着更新与技能提示', () => {
    expect(larkCliEnvironment('')).toMatchObject({
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    })
  })
})
