# Agent Note: 两阶段桌面运行时 surface：Electron sidecar 壳，然后内嵌 host

Status: proposed

[English](2026-08-15-desktop-runtime-surface.md) | 中文

## 问题

dsh 目前只提供两个 surface：`web`（浏览器应用）与 `headless`（无 UI 的一次性运行器）。今天想要桌面应用的用户得到的只是一个浏览器标签页，外加一个需要手动启动的进程。桌面形态承担着 web surface 不具备的义务：无需 Node.js 或 CLI 前置条件的双击启动、关闭标签页后仍存活的自有窗口与托盘、操作系统原生的目录选择、通知与路径打开，以及带签名与更新的可安装产物。

社区用外部壳填补了这个空白：Electron 或 Tauri 壳把 `dsh web` 拉起为子进程，再加载其回环地址 URL。该形态保留了 HTTP 载体，因此每个桌面用户仍在运行一个带完整浏览器信任围栏的监听 web 服务器；桌面原生能力被栓在壳上、游离于组合之外——对 profile、bundle 与 `dsh plugin` 不可见。其中最大的壳明确写道：把桌面层按官方插件机制交付，是它尚未完成的路线图项。

架构早已预料到这个 surface。[GUI 分层与 RPC 协议笔记](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)点名了 Electron 目标——"将来的 Electron 应用经由 IPC fetch 载体复用同一套 web client 包"——并把 IPC 桥子类列为假想的载流行；`dsh-host-webserver` 记载了 Electron 经 `file://` 加载 dist、经 IPC 桥承载 fetch。尚不存在的是这个决策：用哪种壳、运行时从哪里来、阶段如何落地，以及 HTTP surface 消失后信任围栏何去何从。

## 提案

分两个阶段加入桌面 surface。两个阶段都不改动官方 web UI：桌面壳渲染已发布的 dist，所有 agent 行为留在现有插件树中。预先锁定的决策：Electron 采用最新稳定线；sidecar 形态永久保留，作为回退与远程连接模式；Windows 首发并列入代码签名预算（先 Windows 签名，后 Apple Developer ID 公证）；desktop profile 通过现有 `dsh plugin` 机制接受插件安装。

### 阶段 A —— sidecar 壳（可发版的 1.0）

`apps/desktop` 是与 `apps/cli`、`apps/web` 并列的新 app bin：Electron 主进程、preload 与打包壳。它把官方 `dsh --profile web` 拉起为子进程，并在强化的 BrowserWindow 中加载其打印出的 URL。不改动任何现有包。

- 运行时发现链：已在部署默认 web origin（本部署为 `127.0.0.1:13080`；随产品发布的 profile 默认为 3080）上服务的实例 → PATH 上的 `dsh` → npx 缓存（`~/.npm/_npx`、`%LOCALAPPDATA%\npm-cache\_npx`）→ 安装包 `extraResources` 内置的运行时。每个来源在启动前经过校验（`package.json` 名称与版本），所选来源显示在连接 UI 中。
- 端口与就绪：以 `--port 0` 拉起，从 stdout 解析 `dsh web:` URL 行，轮询 index 直到 HTTP 200，再完成 `host.describe` 握手，然后才显示窗口。
- 安全基线：只绑 `127.0.0.1`；渲染进程关闭 `nodeIntegration`、开启 `contextIsolation` 与 Chromium 沙箱；新窗口与跨源导航交给系统浏览器；Cordis HMR 所需的 `--expose-internals` 只授予子进程。
- 数据：原样透传 `DSH_HOME`（默认 `~/.dsh`）；会话、插件、凭据与设置和浏览器 surface 共享，壳不创建第二个数据根。
- 壳 UX：带阶段、日志与重试的加载页；关窗隐藏到托盘、agent 工作继续；单实例锁；退出时进程树 kill（Windows `taskkill /T`）；崩溃自动重启一次。
- 打包：electron-builder 矩阵，Windows x64 NSIS + portable 先行，随后 macOS arm64/x64 DMG，再后 Linux x64 AppImage/deb；GitHub Actions release 工作流对每个产物做打包冒烟测试；签名密钥先为 Windows 接入。

阶段 A 的退出条件：Windows 安装包可双击启动、共享 `~/.dsh`、退出后无孤儿进程，且下方阶段 B 门槛 spike 通过。

### 阶段 B 门槛 —— 内嵌 host spike

在构建阶段 B 之前，验证 Electron 主进程（或 `utilityProcess`）能通过构建产物 `dsh-app-boot` 启动一棵最小 Cordis 树：内置 Node 满足 dsh engines 与会话持久化的 SQLite 依赖；原生模块（landlock runner、win32 对话框绑定）在 Electron ABI 重编译后可加载；Loader 的 bare specifier 解析在 `bareModuleBaseUrl` 下工作。任一项失败，阶段 B 就把 host 留在真实 Node 子进程里，把桥移到该进程的 stdio/IPC 传输上——下文组合不变，只是载体的物理位置移动。

### 阶段 B —— 桌面运行时插件

`packages/bundle/desktop`（`@deepseek-ai/dsh-desktop-app`）像 `dsh-web-app` 一样骑在 `dsh-base` 之上，`desktop` 与 `web`、`headless` 一起进入 `PROFILE_TEMPLATES`。`dsh plugin --profile desktop add` 通过现有 profile 机制原样可用。

与 web bundle 的组合差异：

| 行 | 桌面处理 |
|---|---|
| webserver / frontend-static / web-runtime / 浏览器信任围栏 | 不挂载——不存在 HTTP surface |
| `dsh-host-desktop`（新） | 在 Electron 主进程内经 `dsh-app-boot` 启动 Cordis 树，组装 boot manifest，注册 IPC 路由 |
| `dsh-host-apiproxy` | 不变；其载体改变 |
| `dsh-client-desktop-connection`（新） | 桌面载体：`AbstractApiClient` 子类，`doFetch` 走 `ipcRenderer.invoke`，另加两条 IPC 通道承载 mux/host 下行流对 |
| client roster | 同一批包；boot manifest 改经 preload/contextBridge 注入（替代 index tap），client bundle 经 `BootSeams.loadBundle` 走 IPC |

结果：

- 无监听端口。[api 浏览器信任边界笔记](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md)记载的 loopback/trusted-host/Origin/DNS-rebinding 围栏保护的是网络载体；内嵌桌面组合没有网络载体，因此一行围栏都不挂。该笔记对 web 与远程载体仍是权威。
- wire 协议不变。四象限消息并集、zod 校验与 rpcId 纪律在 IPC 载体上逐字节一致地运行；载体等价性测试钉住这一点。
- 桌面原生能力成为注册的插件，而非壳外挂：[directory-picker seam](../../implemented/feature/2026-07-27-native-workspace-directory-picker.md) 上注册 Electron `dialog.showOpenDialog` backend；`host.openPath` 用 `shell.openPath`；Electron 主进程订阅 turn 结束事件发出操作系统通知。每一项都可从 profile 中移除。
- bundle config 的 `embeddedHost` 切换形态：内嵌（阶段 B 默认）或保留的阶段 A sidecar；后者同时承担经 `/api` + `--trusted-host` 的远程实例连接。

### 仓库融合

新包遵守仓库规则：ESM、`@deepseek-ai/dsh-<name>`、每包 invariant、带 Model Experience 章节的 README、tsconfig 聚合注册，client 包纳入覆盖率门禁。标签分类体系已把浏览器与 Electron 图形界面归入同一个 `area/web` 领域。桌面 e2e 以无 key replay 模式运行 Playwright-on-Electron，与 web lane 并列。

## 备选方案

**用 Tauri 壳而非 Electron。** 阶段 B 要把 Cordis host 内嵌进壳的主进程；Tauri 的主进程是 Rust，host 只能继续当 Node sidecar，每条 IPC 桥都要在 wire 信封之外再跨一层 Rust↔Node 序列化边界。社区唯一一个做透的 Tauri 壳验证的是 sidecar 形态，不是内嵌形态。Electron 让两个阶段共用一种壳技术。

**跳过阶段 A，直接落内嵌 host。** 那会把可发版产物抵押给内嵌 host spike：Electron Node 引擎、原生模块 ABI、Loader 解析与打包在后期之前全部未经验证。阶段 A 先交付产品面、安装包、release 工作流，以及阶段 B 留作回退的进程生命周期代码；spike 失败时只是给载体搬家，而不是让项目停摆。

**永久停留在阶段 A。** 每个桌面安装仍带着 web 服务器、端口与信任围栏；桌面原生能力留在组合之外，对 `dsh plugin` 与 profile 不可见；社区空白——经官方插件机制交付的桌面 surface——依然敞开。这个空白正是本提案要关闭的。

**内嵌模式复用浏览器信任围栏。** 围栏是网络载体的可达性策略。内嵌模式没有网络载体：渲染进程经进程内 IPC 与 host 对话。挂上围栏只会增加一个死的"安全机制"，其存在反而被误读为保护。

**以外部社区壳形态交付。** 该形态无法把桌面能力变成插件，无法共享 release 与签名流水线，并且分裂了"dsh surface 是什么"的心智模型。本决策的要点正是：桌面 surface 是一个组合，而不是一个壳。

## 验收标准

阶段 A：

- Windows 安装包双击启动、进入官方 web UI、与浏览器 surface 共享 `~/.dsh`、退出后无孤儿进程；macOS 与 Linux 产物走同一工作流跟进。
- 运行时发现链在文档化条件下选中其四个来源中的每一个，并报告所选来源与版本。
- 渲染进程强化成立：无 `nodeIntegration`、`contextIsolation` 开启、外部导航离开应用。
- Playwright-on-Electron 冒烟在 CI 中无 key 运行。

阶段 B：

- `dsh --profile desktop --dump-config` 打印出不含 webserver 行的组合，运行中的桌面应用不绑定任何 TCP 端口。
- 同一份 RPC 语料在 IPC 载体与进程内载体上通过逐字节一致的 wire 断言。
- client 插件 HMR 在桌面窗口内经 `dev:web` watcher 无刷新生效。
- 每个桌面原生插件（目录选择器、路径打开、通知）都可从 profile 移除，其缺席大声降级、绝不静默。
- `embeddedHost` 关闭时，sidecar 回退与远程实例连接仍然可用。
- 仓库门禁通过：typecheck、lint、覆盖率、doc-sync、hygiene，以及桌面 e2e lane。

## 风险

Electron 内置 Node 随每条稳定线移动；dsh engines 提升或原生模块 ABI 断裂可能困住一个钉住版本的壳。发版时钉住 Electron 线、加上保留的阶段 A sidecar，可以框住该风险：最坏情况桌面应用以 sidecar 模式发版，直到内嵌 host 追上。

上游 RC 迭代可能改变阶段 A 所解析的 CLI 标志、stdout URL 行或 boot manifest 形状。发现与就绪用针对构建产物的集成测试钉住各自约定；内置运行时来源为每次发版固定一组已验证的配对。

`file://` 启动与 IPC bundle 传输触及 [client 插件加载模型](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md) 的边缘（index tap、脚本执行、CSP）。`BootSeams` 正是为此环境而设；残余风险是 HMR 与模块表的边角情形，由载体等价性与 HMR 验收测试框住。

代码签名带来持续成本与密钥管理（Windows 先行，随后 Apple 公证）。未签名的回退构建必须保持可用，CI 永不依赖证书在场。

本笔记实现 [GUI 分层与 RPC 协议笔记](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)与 [client 插件加载模型](../../implemented/architecture/2026-07-23-client-plugin-loading-model.md)所预期的 Electron 载体；阶段 B 落地时，前者的假想 IPC 桥行成为现实，其"尚无此类壳"的事实将在同一变更中更新。[api 浏览器信任边界笔记](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) 对一切网络载体仍是权威。
