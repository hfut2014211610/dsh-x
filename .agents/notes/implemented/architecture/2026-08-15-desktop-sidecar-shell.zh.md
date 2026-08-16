# Agent Note: 桌面 sidecar 壳——桌面运行时 surface 的阶段 A

Status: implemented

[English](2026-08-15-desktop-sidecar-shell.md) | 中文

## 问题

桌面 surface 提案（[桌面运行时 surface](../../proposed/architecture/2026-08-15-desktop-runtime-surface.md)）分两阶段落地，阶段 A 必须先行：在任何内嵌 host 工作开始之前，先交付一个可双击启动、运行官方 web 运行时的 Electron 壳。阶段 A 需要一个不改动任何现有包的壳的安身之处，遵循 app bin 惯例（`apps/cli`、`apps/web`），并通过全部仓库门禁——包括把每个 `apps/*` 包当作发布 release 成员的约束门禁。

## 决策

`apps/desktop`（`@deepseek-ai/dsh-desktop-shell`）即 sidecar 壳：Electron 主进程、桥接加载页的沙箱化 preload、以及打包的加载 UI。主进程经校验过的四来源发现链（部署默认 web origin 上已在服务的实例——本部署为 `127.0.0.1:13080`，可经 `DSH_DESKTOP_PROBE_ORIGIN` 覆盖——然后是 PATH 上的 `dsh`、npx 缓存、安装包内置运行时）解析运行时，以 `web --host 127.0.0.1 --port 0` 拉起，并以三个就绪信号门控窗口：`dsh web:` URL 行、index 返回 HTTP 200、`host.describe` 的 rpcId 回显（`src/discovery.ts`、`src/sidecar.ts`、`src/rpc-probe.ts`）。

安全姿态：只绑回环地址、关闭 `nodeIntegration`、开启 `contextIsolation` 与 Chromium 沙箱、外部导航与新窗口交给系统浏览器、文件 URL 仅允许加载页自身。生命周期：关窗驻留托盘、单实例锁、运行时意外退出自动重启一次、退出时进程树拆除（Windows `taskkill /T`，POSIX 进程组信号，见 `src/process-tree.ts`）。子进程环境原样继承，`DSH_HOME` 原样透传，壳不拥有第二个数据根。

内置运行时以单一归档随包分发，壳在首启时按归档校验和解压到 userData（`src/bundled-runtime.ts`）——这个 electron-builder 构建会整体剥离资源拷贝中的 `node_modules`，安装好的树无法直接经 `extraResources` 分发。解压出的运行时经 `ELECTRON_RUN_AS_NODE` 加 `--expose-internals`（web profile 的 HMR 行所需）跑在 Electron 二进制上，安装后的应用不需要系统 Node.js——PATH 与 npx 来源服务于本就装有 Node 的开发机。Windows 的 shell 拉起对每个参数加引号：应用装在 `DeepSeek Harness.exe` 下，不加引号的路径会在 cmd 中从空格处断开。Electron 二进制下载是可选项（`allowBuilds: electron: false` 加 `pnpm run desktop:prepare`），其余 CI lane 的 `pnpm install` 速度不受影响。

## 结果

- 壳与每个 `apps/*` 包一样是 release 成员：随家族发布到 npm（`files` 策略登记在 `scripts/check-workspace-constraints.ts`），可安装二进制则来自 `desktop-release.yml` 的 electron-builder 矩阵——Windows x64 NSIS + portable 先行，macOS 与 Linux 作业停靠在同一工作流中，待签名预算覆盖后启用。
- 无 key 的 CI 信号是 Playwright-on-Electron 冒烟（`vitest.desktop.config.ts`），它随服务实例探测自适应：部署默认 origin 上有 dsh 应答时，壳必须附着、且退出后该实例必须存活（附着的运行时不归我们杀）；无人应答时，壳必须经临时 staged 的 npm 式 shim 在隔离 `DSH_HOME` 中拉起构建产物 CLI，且退出后不留存活监听。lane 的 node 低于 22.19 时无法满足运行时的 `node:zlib` 依赖，拉起分支携带该原因自跳过。release 工作流另外用打包后的 `win-unpacked` 可执行文件、只依赖内置运行时做冒烟。
- 发现、就绪与拆除是注入依赖的纯模块并配单元套件；Electron 粘合层（`src/main.ts`）刻意保持薄，由两条冒烟 lane 覆盖而非单元测试（apps 不在逐文件覆盖率门禁之内，该门禁原样未动）。
- 附着已在服务的实例绝不杀死它：拆除以所有权为条件，sidecar 句柄记录进程是否由壳拉起。
- 壳所解析的契约由测试钉住：`dsh web:` URL 行形状、`host.describe` rpcId 回显、`dsh --version` 语法。上游若改变其中任一者，桌面套件会在 release 发出一个无法连接的壳之前失败。
- 阶段 B（内嵌 host 的插件组合）仍留在提案的门槛 spike 之后；它落地时，sidecar 保留为回退与远程连接模式。

## 备选方案

提案自身的备选——Tauri、跳过阶段 A、永久停留在阶段 A、内嵌模式复用浏览器信任围栏、外部社区壳——已记录并权衡于[桌面运行时 surface 笔记](../../proposed/architecture/2026-08-15-desktop-runtime-surface.md)，仍为权威。阶段 A 另外选择了 tsc 直出而非 tsdown 打包主进程：入口是只有一个外部依赖（`electron`）的纯 ESM，electron-builder 经 node_modules 解析它，打包器只会增加一个构建步骤和一张外部化清单，而删不掉任何代码。
