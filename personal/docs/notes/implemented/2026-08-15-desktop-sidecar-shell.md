# Agent Note: 桌面 sidecar 壳：桌面运行时 surface 的阶段 A

Status: implemented

## 问题

桌面 surface 提案（[桌面运行时 surface](../proposed/2026-08-15-desktop-runtime-surface.md)）分两阶段做，阶段 A 必须先行：在动手做内嵌 host 之前，先交付一个双击就能启动、跑官方 web 运行时的 Electron 壳。阶段 A 要给这个壳找一个不改动任何现有包的安身之处，要遵循 app bin 的惯例（`apps/cli`、`apps/web`），还要过掉仓库的全部检查，其中包括那条把每个 `apps/*` 包都当作发布成员的工作区约束检查。

## 决策

`apps/desktop`（`@deepseek-ai/dsh-desktop-shell`）就是这个 sidecar 壳，由三部分组成：Electron 主进程、给加载页做桥接的沙箱化 preload、打包进去的加载 UI。主进程按四个来源依次找运行时，每一步都校验：先看部署默认的 web origin 上有没有已经在服务的实例（本部署是 `127.0.0.1:13080`，可用 `DSH_DESKTOP_PROBE_ORIGIN` 覆盖），再依次是 PATH 上的 `dsh`、npx 缓存、安装包内置的运行时。找到后用 `web --host 127.0.0.1 --port 0` 拉起，并等三个就绪信号都到齐才开窗：`dsh web:` 的 URL 行、index 返回 HTTP 200、`host.describe` 回显 rpcId（`src/discovery.ts`、`src/sidecar.ts`、`src/rpc-probe.ts`）。

安全上的做法：只绑回环地址，关掉 `nodeIntegration`，开 `contextIsolation` 和 Chromium 沙箱，外部导航与新开窗口一律交给系统浏览器，文件 URL 只允许加载页自己。生命周期：关窗后驻留托盘，加单实例锁，运行时意外退出自动重启一次，退出时整棵进程树一起拆（Windows 用 `taskkill /T`，POSIX 发进程组信号，见 `src/process-tree.ts`）。子进程环境原样继承，`DSH_HOME` 原样透传，壳不会自己再开一个数据根。

内置运行时打成单个归档随包分发，壳首次启动时先比对校验和再解压到 userData（`src/bundled-runtime.ts`）——这个 electron-builder 构建会把资源拷贝里的 `node_modules` 整个剥掉，装好的树没法直接走 `extraResources` 分发。解压出来的运行时跑在 Electron 二进制上，靠 `ELECTRON_RUN_AS_NODE` 加 `--expose-internals`（web profile 的 HMR 行需要它），所以装好的应用不需要系统 Node.js；PATH 和 npx 这两个来源是给本来就装了 Node 的开发机用的。Windows 上拉起时每个参数都要加引号：应用装在 `DeepSeek Harness.exe` 底下，不加引号的路径在 cmd 里会从空格处断开。Electron 二进制的下载是可选的（`allowBuilds: electron: false` 配合 `pnpm run desktop:prepare`），其他 CI lane 的 `pnpm install` 速度不受影响。

## 后果

- 壳和其他 `apps/*` 包一样是发布成员：随家族发到 npm（`files` 策略登记在 `scripts/check-workspace-constraints.ts`），可安装的二进制则来自 `desktop-release.yml` 的 electron-builder 矩阵。Windows x64 的 NSIS 与 portable 先做，macOS 和 Linux 的作业已经停在同一个工作流里，等签名预算到位再开。
- 无 key 的 CI 信号是 Playwright-on-Electron 冒烟（`vitest.desktop.config.ts`），它会先探有没有在服务的实例，再决定怎么跑：默认 origin 上有 dsh 应答时，壳必须附着上去，而且壳退出后那个实例必须还活着（附着上的运行时不归我们杀）；没人应答时，壳必须通过临时 staged 的 npm 式 shim，在隔离的 `DSH_HOME` 里把构建产物 CLI 拉起来，退出后不许留下还在监听的进程。lane 的 node 低于 22.19 时满足不了运行时对 `node:zlib` 的依赖，拉起这条分支会带着这个原因自己跳过。release 工作流另跑一遍冒烟，用打包后的 `win-unpacked` 可执行文件，只走内置运行时。
- 发现、就绪、拆除这三块是注入依赖的纯模块，各配单元测试；Electron 的粘合层（`src/main.ts`）刻意写得很薄，由两条冒烟 lane 覆盖，不写单元测试（apps 不在逐文件覆盖率检查的范围内，那条检查原样没动）。
- 附着到已经在服务的实例时绝不杀它：拆不拆看所有权，sidecar 句柄记着这个进程是不是壳自己拉起来的。
- 壳依赖的那几处约定都由测试守着：`dsh web:` 的 URL 行长什么样、`host.describe` 会回显 rpcId、`dsh --version` 的语法。上游改动其中任何一个，桌面测试套件会先失败，不会让 release 发出一个连不上的壳。
- 阶段 B（把 host 内嵌进来的插件组合）还压在提案里那个门槛 spike 后面；它做出来之后，sidecar 仍然保留，用作回退和远程连接模式。

## 备选方案

提案本身的备选方案——Tauri、跳过阶段 A、永远停在阶段 A、内嵌模式复用浏览器的信任围栏、用社区现成的壳——都记在[桌面运行时 surface 笔记](../proposed/2026-08-15-desktop-runtime-surface.md)里并权衡过，以那篇为准。阶段 A 自己多做了一个选择：主进程用 tsc 直出，不用 tsdown 打包。入口是纯 ESM，外部依赖只有 `electron` 一个，electron-builder 走 node_modules 解析它；上打包器只会多一个构建步骤和一张外部化清单，一行代码也删不掉。
