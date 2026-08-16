# `@deepseek-ai/dsh-desktop-shell`

[English](README.md) | 中文

桌面壳是官方 dsh web 运行时之上的 Electron sidecar 窗口（桌面 surface 的阶段 A）：它在回环地址上以系统分配端口拉起 `dsh --profile web`，完成就绪握手后，在强化窗口中渲染已发布的 web UI。全部 agent 行为留在现有插件树中；壳只负责窗口、托盘与进程生命周期，不改动 web UI 本身。

## 运行时发现

每次启动按经过校验的发现链解析运行时，顺序为：已在部署默认 web origin（本部署为 `http://127.0.0.1:13080`；可用 `DSH_DESKTOP_PROBE_ORIGIN` 覆盖）上服务的实例（经 `host.describe` 探测识别）、`PATH` 上的 `dsh`（经 `--version` 校验）、npx 缓存（`~/.npm/_npx`、`%LOCALAPPDATA%\npm-cache\_npx`）、以及安装包 `extraResources` 内置的运行时。磁盘来源必须出示 `@deepseek-ai/dsh` 自己的 package 清单才能启动；已在服务的实例只附着，绝不拉起或杀死。所选来源与版本显示在加载页上。

被拉起的运行时一律执行 `web --host 127.0.0.1 --port 0`；就绪判据依次是 stdout 上的 `dsh web:` URL 行、index 返回 HTTP 200、`host.describe` 回显——三者齐备后窗口才展示 web UI。

## 窗口与进程生命周期

渲染进程关闭 `nodeIntegration`、开启 `contextIsolation` 与 Chromium 沙箱；新窗口与跨源导航交给系统浏览器。关窗隐藏到托盘、运行时继续服务 agent 工作；退出时杀死拉起的进程树（Windows `taskkill /T`，POSIX 进程组信号），不留孤儿。运行时意外退出会自动重启一次；第二次退出则停在加载页，显示运行时日志尾部与重试按钮。每用户单实例（单实例锁）。

内置运行时以单一归档（`resources/dsh-runtime.zip`）随包分发，壳在首启时把它解压到自己的 userData（`src/bundled-runtime.ts`）——因为这个 electron-builder 构建会整体剥离资源拷贝中的 `node_modules`；解压出的树直接跑在 Electron 二进制上（`ELECTRON_RUN_AS_NODE` 加 `--expose-internals`，供 web profile 的 HMR 行使用），安装后的应用不需要系统 Node.js。`PATH` 与 npx 来源服务于本就装有 Node 的开发机。

## 数据

子进程环境即壳自身环境，`DSH_HOME`（默认 `~/.dsh`）原样透传：会话、插件、凭据与设置和浏览器 surface 共享，壳不创建第二个数据根。

## 开发

`pnpm run dev:desktop` 下载 Electron 二进制（`desktop:prepare`；workspace 的构建脚本门禁刻意跳过它）、构建仓库产物，并让窗口走与安装版相同的发现链：探测 origin 上有服务实例就附着，否则拉起机器上任何通过校验的 `dsh`（仓库检出内没有 `dsh` shim——全局安装一个、或在 `PATH` 上临时放置一个 shim 目录即可演练拉起路径）。`pnpm run test:desktop` 以同样方式运行无 key 的 Playwright-on-Electron 冒烟：探测 origin 有服务实例时附着（并断言退出后该实例仍存活），否则经临时 shim 在隔离 `DSH_HOME` 中拉起构建产物 CLI（并断言退出后进程被清理）；当 node 低于 22.19——无法满足运行时的 `node:zlib` 依赖——拉起分支会携带该原因自跳过。本地打包需先准备内置运行时目录：`npm install --prefix apps/desktop/resources/dsh-runtime --omit=dev @deepseek-ai/dsh@<version>`，再执行 `pnpm --filter @deepseek-ai/dsh-desktop-shell exec electron-builder`——见 [electron-builder.yml](electron-builder.yml) 与 desktop-release 工作流。

[桌面运行时 surface 笔记](../../.agents/notes/proposed/architecture/2026-08-15-desktop-runtime-surface.md)拥有两阶段设计；[阶段 A 实现笔记](../../.agents/notes/implemented/architecture/2026-08-15-desktop-sidecar-shell.md)拥有已落地内容。
