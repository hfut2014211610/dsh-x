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
 * 用法：node personal/scripts/build-windows.mjs [--skip-build]
 *   --skip-build 跳过第 1 步（刚跑过构建时复用 lib/ 与 web 产物）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const skipBuild = process.argv.includes('--skip-build')
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

/** 一个目录若是包（含 package.json 且带 name/version），返回其名，否则 null。 */
const packageName = (dir) => {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  const parsed = JSON.parse(spawnSync('node', ['-e', `console.log(JSON.stringify(require(${JSON.stringify(manifest)}).name ?? ''))`]).stdout.toString())
  return parsed || null
}

const packFamily = (memberDirs, destination) => {
  // 绝对路径：pnpm --dir 先切进包目录，相对 --pack-destination 会按包目录解析。
  const absolute = join(root, destination)
  rmSync(absolute, { recursive: true, force: true })
  mkdirSync(absolute, { recursive: true })
  for (const dir of memberDirs) {
    run('pnpm', ['--dir', JSON.stringify(dir), 'pack', '--pack-destination', JSON.stringify(absolute)])
  }
}

console.log('[build-windows] 1/6 building lib, web, and the desktop shell')
if (!skipBuild) {
  run('pnpm', ['run', 'build:lib'])
  run('pnpm', ['run', 'build:web'])
}
run('npx', ['tsc', '-b', 'apps/desktop/tsconfig.json'])

console.log('[build-windows] 2/6 packing release families')
const dshDirs = [
  ...readdirSync(join(root, 'packages')).flatMap(group => {
    const groupDir = join(root, 'packages', group)
    return statSync(groupDir).isDirectory() ? readdirSync(groupDir).map(pkg => join(groupDir, pkg)) : []
  }),
  ...readdirSync(join(root, 'apps')).map(app => join(root, 'apps', app)),
].filter(dir => packageName(dir) !== null)
packFamily(dshDirs, 'dist/npm-dsh')
packFamily(readdirSync(join(root, 'vendor')).map(v => join(root, 'vendor', v)).filter(dir => packageName(dir) !== null), 'dist/npm-vendor')
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
rmSync(join(root, 'apps/desktop/resources/dsh-runtime.zip'), { force: true })
run(join(SYSTEM32, 'tar.exe'), ['-a', '-cf', 'apps/desktop/resources/dsh-runtime.zip', '-C', 'dist/runtime-stage', '.'])

console.log('[build-windows] 6/6 packaging installers')
run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop-shell', 'exec', 'electron-builder', '--win', 'nsis', 'portable', '--publish', 'never'])

console.log('[build-windows] done — installers in apps/desktop/release/:')
for (const name of readdirSync(join(root, 'apps/desktop/release'))) {
  if (name.endsWith('.exe')) console.log(`  ${name}`)
}
