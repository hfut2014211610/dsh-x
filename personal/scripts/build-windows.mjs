#!/usr/bin/env node
/**
 * 本地构建 Windows 桌面版（个人层工具，不入 pnpm workspace）。
 *
 * 每轮改动完成后交付 Windows 安装包的固定流程。产出：
 *   apps/desktop/release/DeepSeek Harness Setup <ver>.exe  （NSIS 安装器）
 *   apps/desktop/release/DeepSeek Harness <ver>.exe        （便携版）
 *
 * 步骤（与 desktop-release 工作流的 packed 路径一致，全在本机执行）：
 *   1. build:lib + build:web + 桌面 tsc
 *   2. 打包 dsh / vendor 两个 release 家族 + landlock entry 为 tarball
 *      （release:pack.ts 的 spawnSync pnpm 在 Windows 解析不了 .cmd，
 *       因此这里逐包 `pnpm pack`，经 shell 解析）
 *   3. scripts/release/desktop-runtime.ts 求依赖闭包 → stage 清单
 *   4. stage 内 npm install（外部依赖与原生预编译来自 registry）
 *   5. System32 bsdtar 压 zip（GNU tar 不认 `D:` 盘符路径）
 *   6. electron-builder --win nsis portable
 *
 * 用法：node personal/scripts/build-windows.mjs [--skip-build] [--reuse-runtime]
 *   --skip-build     跳过第 1 步（刚跑过构建时复用 lib/ 与 web 产物）。
 *   --reuse-runtime  跳过第 2–5 步，复用已有的 dsh-runtime.zip。只改了
 *                    apps/desktop 时用它——那四步的产出会与上次完全相同。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const skipBuild = process.argv.includes('--skip-build')
/**
 * 复用已有的 dsh-runtime.zip，跳过第 2–5 步。
 *
 * 那四步产出的只有一样东西：内置运行时的归档。改动如果只在 apps/desktop 里
 * （壳的代码、加载页、打包配置），它们重跑一遍的结果和上一次逐字节相同，却要
 * 打 243 个 tarball、求闭包、装依赖、再压几万个文件。
 *
 * 有意做成显式开关而不是自动判断：真正可靠的判断要覆盖整棵 packages/apps/vendor
 * 树，而第 1 步每次都会重写 lib/ 的时间戳，任何基于时间戳的启发都会立刻失效。
 * 与其给一个会在错误的时候命中的缓存，不如让调用方说清楚这一次改了什么。
 */
const reuseRuntime = process.argv.includes('--reuse-runtime')
const SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'system32')
/** shell:true 让 spawnSync 解析 pnpm/npm 的 .cmd shim；PATH 前置 System32 提供 bsdtar。 */
const run = (command, args, opts = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PATH: `${SYSTEM32}${process.env.PATH ? `;${process.env.PATH}` : ''}` },
    ...opts,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`)
  }
}

/**
 * 一个目录若是包（含 package.json 且带 name），返回其名，否则 null。
 *
 * 直接读文件，不再为每个目录拉一个 node 进程去 require 它。这个函数在 250 来个
 * 目录上各调一次，每次一个进程启动，光这一项就是几十秒。
 */
const packageName = (dir) => {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).name || null
  } catch {
    return null
  }
}

/** 同时最多跑几个 pnpm pack：给 CPU 留两核，免得打包把机器占死。 */
const PACK_CONCURRENCY = Math.max(2, Math.min(12, cpus().length - 2))

/** 异步版 run：并发打包用，语义与 run 一致（非零退出即抛）。 */
const runAsync = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: true,
    env: { ...process.env, PATH: `${SYSTEM32}${process.env.PATH ? `;${process.env.PATH}` : ''}` },
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  child.once('error', reject)
  child.once('close', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`${command} ${args.join(' ')} exited ${String(code)}: ${stderr.slice(0, 300)}`))
  })
})

/**
 * 打包一个 release 家族。
 *
 * 并发而非串行：每个成员是一次独立的 `pnpm pack`，互不依赖，而单次约 0.5 秒里
 * 绝大部分是 pnpm 自己的启动开销。243 个成员串行要两分钟，这段时间 CPU 基本闲着。
 */
const packFamily = async (memberDirs, destination) => {
  // 绝对路径：pnpm --dir 先切进包目录，相对 --pack-destination 会按包目录解析。
  const absolute = join(root, destination)
  rmSync(absolute, { recursive: true, force: true })
  mkdirSync(absolute, { recursive: true })
  const queue = [...memberDirs]
  const worker = async () => {
    for (;;) {
      const dir = queue.shift()
      if (dir === undefined) return
      await runAsync('pnpm', ['--dir', JSON.stringify(dir), 'pack', '--pack-destination', JSON.stringify(absolute)])
    }
  }
  await Promise.all(Array.from({ length: Math.min(PACK_CONCURRENCY, queue.length) }, worker))
}

console.log('[build-windows] 1/6 building lib, web, and the desktop shell')
if (!skipBuild) {
  run('pnpm', ['run', 'build:lib'])
  run('pnpm', ['run', 'build:web'])
}
run('npx', ['tsc', '-b', 'apps/desktop/tsconfig.json'])

const RUNTIME_ZIP = join(root, 'apps/desktop/resources/dsh-runtime.zip')

if (reuseRuntime && existsSync(RUNTIME_ZIP)) {
  console.log('[build-windows] 2-5/6 skipped — reusing the existing dsh-runtime.zip')
} else {
if (reuseRuntime) console.log('[build-windows] --reuse-runtime ignored: no dsh-runtime.zip to reuse')
console.log('[build-windows] 2/6 packing release families')
const dshDirs = [
  ...readdirSync(join(root, 'packages')).flatMap(group => {
    const groupDir = join(root, 'packages', group)
    return statSync(groupDir).isDirectory() ? readdirSync(groupDir).map(pkg => join(groupDir, pkg)) : []
  }),
  ...readdirSync(join(root, 'apps')).map(app => join(root, 'apps', app)),
].filter(dir => packageName(dir) !== null)
await packFamily(dshDirs, 'dist/npm-dsh')
await packFamily(readdirSync(join(root, 'vendor')).map(v => join(root, 'vendor', v)).filter(dir => packageName(dir) !== null), 'dist/npm-vendor')
run('pnpm', ['--dir', 'native/landlock-run', 'run', 'build:ts'])
rmSync(join(root, 'dist/npm-landlock'), { recursive: true, force: true })
mkdirSync(join(root, 'dist/npm-landlock'), { recursive: true })
run('pnpm', ['--dir', 'native/landlock-run/packages/entry', 'pack', '--pack-destination', JSON.stringify(join(root, 'dist/npm-landlock'))])

console.log('[build-windows] 3/6 resolving the runtime closure')
rmSync('dist/runtime-stage', { recursive: true, force: true })
run('pnpm', ['exec', 'tsx', 'scripts/release/desktop-runtime.ts',
  '--from', 'dist/npm-dsh', '--from', 'dist/npm-vendor', '--from', 'dist/npm-landlock',
  '--stage', 'dist/runtime-stage'])

console.log('[build-windows] 4/6 installing the runtime stage')
// cwd 而非 --prefix：两者叠加会把前缀再接到 cwd 之后。
run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', '--omit=dev'],
  { cwd: join(root, 'dist/runtime-stage') })

console.log('[build-windows] 5/6 zipping the bundled runtime')
mkdirSync(join(root, 'apps/desktop/resources'), { recursive: true })
rmSync(RUNTIME_ZIP, { force: true })
run(join(SYSTEM32, 'tar.exe'), ['-a', '-cf', 'apps/desktop/resources/dsh-runtime.zip', '-C', 'dist/runtime-stage', '.'])
}

console.log('[build-windows] 6/6 packaging installers')
/**
 * 产物目录带上版本号。
 *
 * 两个原因。其一，同名产物无法分辨：一个还没发布的 0.3.2 和已经发布的 0.3.2
 * 文件名一模一样，装上以后没人知道手里是哪个。其二，electron-builder 在写
 * app.asar 前要先删掉上一次的，而 Windows 上这个文件常被杀毒或索引服务按住不
 * 放——一次锁住就意味着这台机器再也打不出包，除非重启。每次写进一个新目录，
 * 两个问题一起没有。
 */
const forkVersion = /^\s*version:\s*(\S+)\s*$/m.exec(
  readFileSync(join(root, 'apps/desktop/electron-builder.yml'), 'utf8').split('extraMetadata:')[1] ?? '',
)?.[1] ?? 'dev'
const outDir = `release-${forkVersion}`
run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop-shell', 'exec', 'electron-builder',
  '--win', 'nsis', 'portable', '--publish', 'never', `--config.directories.output=${outDir}`])

console.log(`[build-windows] done — installers in apps/desktop/${outDir}/:`)
for (const name of readdirSync(join(root, 'apps/desktop', outDir))) {
  if (name.endsWith('.exe')) console.log(`  ${name}`)
}
