# `@deepseek-ai/dsh-desktop-shell`

[English](README.md) | 中文

桌面壳是官方 dsh web 运行时之上的 Electron sidecar 窗口（桌面 surface 的阶段 A）：它在回环地址上以系统分配端口拉起 `dsh --profile web`，完成就绪握手后，在强化窗口中渲染已发布的 web UI。全部 agent 行为留在现有插件树中；壳只负责窗口、托盘与进程生命周期，不改动 web UI 本身。

## 运行时发现

每次启动按经过校验的发现链解析运行时，顺序为：已在部署默认 web origin（本部署为 `http://127.0.0.1:13080`；可用 `DSH_DESKTOP_PROBE_ORIGIN` 覆盖）上服务的实例（经 `host.describe` 探测识别）、`PATH` 上的 `dsh`（经 `--version` 校验）、npx 缓存（`~/.npm/_npx`、`%LOCALAPPDATA%\npm-cache\_npx`）、以及安装包 `extraResources` 内置的运行时。磁盘来源必须出示 `@deepseek-ai/dsh` 自己的 package 清单才能启动；已在服务的实例只附着，绝不拉起或杀死。所选来源与版本显示在加载页上。

**安装版完全跳过「已在服务的实例」这一档。** 不是自己拉起的运行时就不该由自己停掉，附着上去意味着用户退出应用后还留着一个在跑的服务——安装版一律自己持有运行时。源码检出下仍默认探测，那里终端里留着一个 `dsh web` 正是要的效果；显式设置 `DSH_DESKTOP_PROBE_ORIGIN` 在两个方向上都优先。

**安装版还会优先用自己内置的那份运行时**，链上其余来源保留为回退。安装包内嵌运行时的意义就是不依赖机器上碰巧有什么；优先用它同时省掉每次启动的一次 shell 拉起和一轮 npx 缓存扫描。源码检出保持原顺序——那里开发者自己装的 `dsh` 才是他正在改的那个。

被拉起的运行时一律执行 `web --host 127.0.0.1 --port 0`；就绪判据依次是 stdout 上的 `dsh web:` URL 行、index 返回 HTTP 200、`host.describe` 回显——三者齐备后窗口才展示 web UI。

这条链上的每一步都是异步执行的，这件事比听起来重要：主进程同时持有窗口和给加载页推状态的 IPC，一个同步子进程会把「正在汇报进度的那块屏」一起冻住。原本同步的有两处——PATH 校验（Windows 上要拉一个 shell，而那个二进制通常并不存在），以及首次运行解压内置运行时（冷机器上要在杀毒实时扫描下写出几万个小文件）。现在两处都不再卡帧。

## 窗口与进程生命周期

渲染进程关闭 `nodeIntegration`、开启 `contextIsolation` 与 Chromium 沙箱；新窗口与跨源导航交给系统浏览器。关窗隐藏到托盘、运行时继续服务 agent 工作；退出时杀死拉起的进程树（Windows `taskkill /T`，POSIX 进程组信号），不留孤儿。每用户单实例（单实例锁）。

两类故障按同一件事处理，因为对使用者来说结果一样——应用用不了了：运行时退出，和运行时不再应答。后者必须主动去问：事件循环卡死或写操作挂住时，进程还活着、socket 还接受连接，而界面上每一个请求都悬着；所以已连接的运行时会被同一个 `host.describe` 握手周期性探测，连续多次没应答就和退出一样报故障。单次没应答从不算故障——笔记本从睡眠恢复就会丢一次。

故障由滚动预算而不是终身计数来应对（`src/restart-policy.ts`）：十分钟内允许三次重启，退避 0 秒 → 5 秒 → 30 秒；超出窗口的故障被遗忘，所以一小时挂一次的运行时永远会重启，每次启动都挂的则停在加载页并附上日志尾部。重试按钮恢复完整预算——用户按下它这件事本身是窗口不掌握的信息，也许他刚腾出了那个一直被占的端口。

壳被直接杀掉时（任务管理器、崩溃、断电）根本不会走退出路径，它拉起的运行时会继续服务而没有任何东西再去停它。因此每次启动都记下自己持有的 pid 与 origin，并在拉起任何东西之前把这条记录读回来（`src/owned-runtime.ts`）。只有在记录的 pid 仍然存活**并且**那个 origin 上仍有 dsh 应答时才会执行杀进程：单凭 pid 不构成身份，杀掉一个被复用的 pid 就是杀掉一个本壳从未启动过的进程。

内置运行时以单一归档（`resources/dsh-runtime.zip`）随包分发，壳在首启时把它解压到自己的 userData（`src/bundled-runtime.ts`）——因为这个 electron-builder 构建会整体剥离资源拷贝中的 `node_modules`；解压出的树直接跑在 Electron 二进制上（`ELECTRON_RUN_AS_NODE` 加 `--expose-internals`，供 web profile 的 HMR 行使用），安装后的应用不需要系统 Node.js。`PATH` 与 npx 来源服务于本就装有 Node 的开发机。

## 加载页

`loading.html` 是一个纯沙箱文档，每次状态变化收到一份快照后重绘。它用五段来表示五个阶段——壳始终知道自己在第几段；阶段计时由快照里的时间戳在本地累加，所以一段长到不再发任何更新的等待，画面上仍然在动。配色以浅色为底、深色为覆盖，窗口创建时就带上对应的 `backgroundColor`，因此从窗口出现到页面绘制之间不会闪一下白。

日志墙默认收起。那是开发者视角，不是打开应用的人该读的东西——但失败时它会自动展开一次，因为那时候它是唯一能说明问题的东西。

## 升级

托盘提供 **Check for updates…**，另外在连接成功二十秒后跑一次无人值守检查——放在窗口已经可用之后，绝不放在启动过程中，那会和运行时抢同一条刚建立的网络。检查没发现新版就什么都不说；只有真的有可用更新才会打断用户。

这里没有用 electron-updater，原因在打好的包里看得见：`electron-builder.yml` 写了显式的 `files` 列表，asar 里只有 `lib/`、preload 和加载页，完全没有 `node_modules`——在这里加一个运行时依赖，它根本不会出现在安装后的应用里。第二个原因是 macOS：原地应用更新需要已签名的应用，而本 fork 的 macOS 构建没有签名。

替代它的是 `src/updater.ts`：用 GitHub API 的 JSON 拿发布列表（所以「发现更新」这一步不需要 YAML 解析器）、从 tag 的任意位置读版本号而不是认死 `v` 前缀（本仓库的发布工具打的是 `dsh-v0.3.1`，恰好是标准 tag 解析器读不出来的形状）、同扩展名下优先选安装器而不是便携版、下载后用 electron-builder 本来就会生成在安装包旁边的 `latest*.yml` 里的 `sha512` 校验。校验不通过是拒绝安装而不是给个警告——下一步就要把这个文件交给操作系统执行。发布时没带 channel 文件的版本会在未校验的情况下下载，并在日志里说明是哪一种情况。安装器只在运行时已经停掉之后、作为退出路径的最后一步启动，因为它要替换的正是本进程正在使用的文件。

[electron-builder.yml](electron-builder.yml) 里的 `publish` 显式写明了本 fork：默认值是从 package 清单的 `repository` 推断的，那指向上游，会让每一个安装后的应用去查一个从来不含这些构建的发布通道。

## 数据

子进程环境即壳自身环境，`DSH_HOME`（默认 `~/.dsh`）原样透传：会话、插件、凭据与设置和浏览器 surface 共享，壳不创建第二个数据根。

## 开发

`pnpm run dev:desktop` 下载 Electron 二进制（`desktop:prepare`；workspace 的构建脚本门禁刻意跳过它）、构建仓库产物，并让窗口走与安装版相同的发现链：探测 origin 上有服务实例就附着，否则拉起机器上任何通过校验的 `dsh`（仓库检出内没有 `dsh` shim——全局安装一个、或在 `PATH` 上临时放置一个 shim 目录即可演练拉起路径）。`pnpm run test:desktop` 以同样方式运行无 key 的 Playwright-on-Electron 冒烟：探测 origin 有服务实例时附着（并断言退出后该实例仍存活），否则经临时 shim 在隔离 `DSH_HOME` 中拉起构建产物 CLI（并断言退出后进程被清理）；当 node 低于 22.19——无法满足运行时的 `node:zlib` 依赖——拉起分支会携带该原因自跳过。本地打包需先准备内置运行时目录：`npm install --prefix apps/desktop/resources/dsh-runtime --omit=dev @deepseek-ai/dsh@<version>`，再执行 `pnpm --filter @deepseek-ai/dsh-desktop-shell exec electron-builder`——见 [electron-builder.yml](electron-builder.yml) 与 desktop-release 工作流。

[桌面运行时 surface 笔记](../../personal/docs/notes/proposed/2026-08-15-desktop-runtime-surface.md)拥有两阶段设计；[阶段 A 实现笔记](../../personal/docs/notes/implemented/2026-08-15-desktop-sidecar-shell.md)拥有已落地内容。
