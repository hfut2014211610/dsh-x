# Agent Note: 桌面 Stage B 可执行计划——从 sidecar 壳到嵌入式桌面表面

Status: proposed

## Problem

桌面表面的 Stage A 已交付：`apps/desktop` 是官方 `dsh web` 运行时之上的 Electron sidecar 窗口（[desktop sidecar shell](../implemented/2026-08-15-desktop-sidecar-shell.md)）。它仍是浏览器套壳——每次启动都会在完整浏览器信任栅栏之后拉起一个 loopback HTTP 服务器，桌面原生能力（目录选择、路径打开、通知）仍游离于插件树之外，`dsh plugin` 也没有 `desktop` profile。两阶段提案（[desktop runtime surface](../proposed/2026-08-15-desktop-runtime-surface.md)）定义了 Stage B——在 Electron 主进程内嵌入 Cordis 宿主并配以 IPC 载波——但其中没有任何东西被构建，且作为门禁的 embedded-host spike 从未运行。

本笔记将该提案转化为可执行、有序的计划：分阶段列出要改动的具体包与文件、每阶段的验证方式，以及让每个阶段可独立落地的退出条件。它记录 Stage B 所消费的每条现有 seam 的就绪度，以及每个阶段必须产出的决策。

## Proposal

共六个阶段，按顺序排列，使每个阶段都为下一个阶段降低风险并可独立落地。Phase 0 是提案已经要求的门禁；Phase 1 是最便宜的载波证明，可与 Phase 0 的 spike 并行启动，因为两种载波形态（嵌入式 IPC，或经 stdio/IPC 的真实 Node 子进程）都需要桌面载波子类与载波等价测试。

### Phase 0 — embedded-host gate spike

**目标。** 决定载波的物理位置：Electron 主进程（或 `utilityProcess`）能否通过构建后的 `dsh-app-boot` 启动一棵最小 Cordis 树，还是宿主必须留在经 stdio/IPC 桥接的真实 Node 子进程中？

**步骤。**
- 在 `apps/desktop`（或 `scripts/`）下新增一次性 spike 脚手架：在 Electron 主进程内，针对最小 `cordis.yml`（含 session 持久化的 `dsh-base` 派生叶子）调用 `@deepseek-ai/dsh-app-boot` 的 `boot()`，并为已安装运行时树传入 `bareModuleBaseUrl`。
- 探测提案点名的三个未知项，并逐项记录结果：
  1. 内嵌 Node 满足 dsh 引擎要求与 `node:sqlite` 依赖。Electron 43 内嵌 Node v24.17.0，已超出仓库的 `^22.19 || >=24` 范围，因此这是确认性探测，而非开放问题。
  2. 原生 addon 在 Electron ABI 重编译后能否加载：`koffi`（win32 目录对话框、sandbox ACL）与 `@deepseek-ai/node-addon-landlock-run` addon。针对钉住的 Electron 线验证 `electron-rebuild`/`@electron/rebuild`，并确认打包后的应用能加载它们。
  3. Loader 裸 specifier 能否在 Electron 主进程内配合 `bareModuleBaseUrl` 解析（打包运行时路径已在纯 Node 下验证过；嵌入式环境是新的）。
- 若任一探测失败，让宿主留在真实 Node 子进程中，并把桥移到此进程的 stdio/IPC 传输上——组合不变，只有载波的物理位置移动。

**验证。** spike 逐项打印结论并带证据以 0 退出；Stage B 落地时，通过把本笔记的载波行标记为 implemented 来记录该决策。

**退出。** 得到关于嵌入式 vs 子进程宿主的文档化结论。本阶段不落地任何生产代码。

### Phase 1 — 桌面载波与载波等价测试

**目标。** 在任何宿主组合存在之前，先把四象限线上协议在桌面传输上与 in-process 载波逐字节对齐。

**步骤。**
- 新增 `packages/client/desktop-connection`（`@deepseek-ai/dsh-client-desktop-connection`）：一个 `AbstractApiClient` 子类，其 `doFetch` 经桌面传输序列化，外加承载 mux/host 下行对的两条 IPC 通道（镜像 `dsh-host-webserver` 的 WebSocket 下行）。传输形态跟随 Phase 0：嵌入式用 `ipcRenderer.invoke`，子进程宿主回退用该子进程的 stdio/IPC。
- 复用现有 RPC 语料，把它在 in-process 载波旁经新载波运行，对全部四个象限断言逐字节一致的线上形态（即提案的载波等价测试）。
- 保持基类不动：协议不变量留在 `AbstractApiClient` 中；新子类只实现 `doFetch`（以及 mux/host open 虚方法）。

**验证。** 载波等价测试套件在桌面测试通道中绿灯通过。

**退出。** 一个通过逐字节线上断言的桌面载波；GUI layering 笔记中"no such shell exists"一行在同一改动中变为现实。

### Phase 2 — 经 IPC 的 renderer 侧 bundle 传输

**目标。** 桌面窗口在无 HTTP 索引、无 `/plugins/<id>/client.js` 路由、无监听端口的情况下启动完整客户端 UI。

**步骤。**
- `dsh-client-modules`：放宽硬编码的 `dsh.client.platform === 'web'` 检查以接受桌面平台，并新增桌面平台行，使模块图以相同方式组合。
- 实现 `BootSeams.loadBundle` 的 IPC 版：preload/contextBridge 暴露一个按 id+rev 返回 bundle 文本的 `invoke`，`apps/desktop` 把该 seams 传给 `AppWebEntry`（该 seam 正是为外部 `<script>` 执行无法触及页面上下文的环境准备的）。
- 用 IPC 投递的 manifest 替换桌面 renderer 的 index-tap boot manifest 注入；web 通道的 index tap 保持不变。

**验证。** 桌面窗口在零 TCP 监听器的情况下到达已 settle 的 UI；web 通道及其测试保持绿灯。

**退出。** renderer 不再依赖 HTTP 载波。

### Phase 3 — 嵌入式宿主插件与 `desktop` profile

**目标。** `desktop` 加入 `PROFILE_TEMPLATES`，与 `web`、`headless` 并列；`dsh plugin --profile desktop add` 经现有机制可用；运行中的应用不绑定任何端口。

**步骤。**
- 新增 `packages/host/desktop`（`@deepseek-ai/dsh-host-desktop`）：在 Electron 主进程内（或按 Phase 0 结论在子进程宿主内）经 `dsh-app-boot` 启动 Cordis 树，组装 boot manifest，并注册 IPC 路由（unary、mux/host 下行、respond）。
- 新增 `packages/bundle/desktop`（`@deepseek-ai/dsh-desktop-app`）：一份叠加在 `dsh-base` 之上的 `cordis.patch.yml`，**不**挂载 webserver / frontend-static / web-runtime / 浏览器信任栅栏；在 `dsh-app-boot` 的 `PROFILE_TEMPLATES` 中加入 `desktop`。
- bundle config 的 `embeddedHost` 切换形态：嵌入式（默认）或保留的 Stage A sidecar；后者同时承担经 `/api` + `--trusted-host` 的远程实例连接。

**验证。** `dsh --profile desktop --dump-config` 打印出不含 webserver 行的组合；运行中的应用不绑定任何 TCP 端口；`dsh plugin --profile desktop add` 可用；`embeddedHost` 关闭时 sidecar 回退仍可用。

**退出。** 一个能启动嵌入式表面、且保留 sidecar 作为可用回退的 `desktop` profile。

### Phase 4 — 桌面原生能力插件

**目标。** 桌面原生能力成为已注册插件，每个都能从 profile 移除，缺失时响铃式降级。

**步骤。**
- 目录选择：把 `dsh-host-directory-picker-native`（已交付：koffi win32 对话框、osascript、zenity）挂到 directory-picker seam 上；Electron 的 `dialog.showOpenDialog` 成为又一个后端选项。
- 路径打开：为 `host.openPath` 提供 Electron `shell.openPath` 后端。
- 通知：Electron 主进程订阅 turn-end 事件并触发系统通知。
- 每个插件都是独立的可移除行；缺失时响铃式失败，绝不静默。

**验证。** 每个插件都能从 profile 移除，且其缺失响铃式降级；无 key 的 e2e 覆盖已挂载路径。

**退出。** 桌面表面的原生能力是组合，而非 shell 外挂。

### Phase 5 — HMR 与桌面 e2e 通道

**目标。** 客户端插件 HMR 在桌面窗口中无刷新工作，桌面 e2e 通道在 CI 中无 key 运行，覆盖嵌入式与 sidecar 两种形态。

**步骤。**
- HMR：sidecar 子进程已用的 `--expose-internals` 路径扩展到嵌入式宿主；`ClientModuleRegistry.rebuilt()` 通知经 IPC 到达 renderer，使模块表无需重载即可失效。
- 扩展 `vitest.desktop.config.ts` 与 Playwright-on-Electron smoke（`apps/desktop/tests/shell.e2e.ts`、`packaged.e2e.ts`）以覆盖嵌入式形态；保留 attach/spawn-reap 分支。

**验证。** HMR 验收测试无刷新通过；桌面 e2e 通道绿灯。

**退出。** 一个像 web 表面一样热重载客户端插件的桌面表面。

### Phase 6 — 发布加固

**目标。** 完整桌面化在三大 OS 家族上交付，并带签名与更新。

**步骤。**
- 在 Windows 与 macOS 流程已验证后，启用 `desktop-release.yml` 中的 Linux 任务（AppImage + deb）。
- 在现有 secret 模式之后接入 macOS 公证（Apple Developer ID），并保持未签名回退可用。
- 把 `autoUpdater`（electron-updater）接入发布工作流，按 profile 分通道；这是桌面 README 已点名的更新义务，目前没有任何产物满足它。
- 保持 `packed` 运行时源路径对尚未发布到 npm 的版本可用。

**验证。** Windows、macOS、Linux 三端安装包；更新路径端到端演练；未签名构建仍通过 CI。

**退出。** 桌面表面在每个受支持的 OS 上都发布完备。

## 依赖的既有 seam

本计划消费（而非修改）以下已交付的 seam：

- `dsh-host-apiproxy` 中的 `AbstractApiClient` / `doFetch`——载波替换点；`InProcessApiClient` 是逐字节一致的参考载波。
- `@deepseek-ai/dsh-client-web` 中的 `BootSeams.loadBundle`——非 HTTP 环境的模块传输覆盖。
- `dsh-app-boot` 中带 `bareModuleBaseUrl` 的 `boot()` / `mountRootInclude`——嵌入式宿主入口，已在封闭打包运行时上验证。
- `dsh-app-boot` 中的 `PROFILE_TEMPLATES`（`web`、`headless`）——将新增 `desktop` 的名录。
- directory-picker seam 及其已交付的原生后端（`dsh-host-directory-picker-native`）。
- `dsh-client-modules` 的 node 半边——唯一需要小幅扩展（平台值）而非原样复用的 seam。

## Alternatives considered

**跳过 spike，直接落地嵌入式宿主。** 提案已拒绝此做法：它会让可交付产物受制于未经验证的 Electron Node、原生 ABI 与 Loader 解析。本计划把 spike 放在最前，正是为了让失败的 spike 移动载波位置而不是让项目停滞。

**把 Phase 1 放在 Phase 3 之后。** 载波等价测试在任何宿主组合存在之前最便宜，而且它们钉住的协议契约正是宿主 profile 将要实现的。把它排在最前，意味着 Phase 3 是针对已钉住的 wire 实现，而非自行发明。

**用 Tauri 替代 Electron。** 提案已权衡（Rust 主进程无法嵌入 Cordis 宿主；每条桥都要跨 Rust↔Node 序列化边界）。Electron 让两个阶段共用一种 shell 技术。

**永久停留在 Stage A。** 提案已拒绝：HTTP 服务器与信任栅栏会留在每次安装上，桌面能力也永远进不了组合。本计划正是为关闭这一缺口而存在。

## Acceptance criteria

- Phase 0：关于嵌入式 vs 子进程宿主的文档化 spike 结论，附逐项证据。
- Phase 1：桌面载波在全部四象限上对 in-process 载波通过逐字节线上断言。
- Phase 2：桌面窗口在无监听端口的情况下到达已 settle 的 UI；web 通道保持绿灯。
- Phase 3：`dsh --profile desktop --dump-config` 打印出不含 webserver 行；运行中的应用不绑定任何 TCP 端口；`dsh plugin --profile desktop add` 可用；`embeddedHost` 关闭时 sidecar 回退仍可用。
- Phase 4：每个桌面原生插件都能从 profile 移除，且其缺失响铃式降级。
- Phase 5：客户端插件 HMR 在桌面窗口中无刷新工作；桌面 e2e 通道在 CI 中绿灯。
- Phase 6：Windows、macOS、Linux 三端安装包；更新路径端到端演练；未签名构建仍通过。
- 每个阶段都通过仓库门禁：typecheck、lint、coverage、doc-sync、hygiene 与桌面 e2e 通道。

## Risks

Electron 的内嵌 Node 随每个稳定线移动；dsh 引擎升级或原生 addon ABI 破坏可能搁浅钉住的 shell。在发布时钉住 Electron 线并保留 Stage A sidecar 可以限制此风险：最坏情况下桌面应用以 sidecar 模式交付，直到嵌入式宿主跟上。Phase 0 spike 正是最先偿还这一风险的地方。

`file://` 启动与 IPC bundle 传输触及客户端插件加载模型的边缘（index tap、脚本执行、CSP）。`BootSeams` 正是为这种环境存在的；残余风险是 HMR 与模块表边界情况，由载波等价与 HMR 验收测试收口。

`dsh.client.platform` 扩展与 IPC boot manifest 路径是对共享 seam（`dsh-client-modules`）仅有的两处改动；二者都是增量式的，web 通道的测试会钉住未变行为。

代码签名与公证带来持续成本与 secret 管理。未签名回退必须持续可用，使 CI 永不依赖证书存在。

本计划兑现了 [GUI layering and RPC protocol note](../../../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 与 [client plugin loading model](../../../../.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md) 所预见的 Electron 载波；Stage B 落地时，前者的假设性 IPC-bridge 行变为现实，其"no such shell exists"事实在同一改动中更新。[api browser-trust boundary note](../../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md) 对每个网络载波仍具权威性。
