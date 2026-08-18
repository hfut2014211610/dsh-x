# DSH-X 总体计划

本 fork 已完成需求与待安排设计的单一视图。每项指向 [`notes/`](README.md#目录结构) 下的设计笔记；笔记是决策与验收标准的权威来源，本文只做索引与状态。

最后整理：2026-08-18。

## 已完成

| 需求 | 落地位置 | 笔记 |
|---|---|---|
| **桌面 sidecar 壳（Stage A）** — `dsh --profile web` 之上的 Electron 窗口，四来源运行时发现、三信号就绪门控、托盘驻留、单实例锁、进程树拆除 | `apps/desktop/` | [笔记](notes/implemented/2026-08-15-desktop-sidecar-shell.md) |
| **桌面 packed runtime 与安装包发布** — 安装包内嵌由该 release tag 自身构建的运行时，首启解压到 userData，校验和门控 | `scripts/release/`、`apps/desktop/electron-builder.yml` | [笔记](notes/implemented/2026-08-17-desktop-packed-runtime.md) |
| **写作模式** — `documents` 能力族、文档工具、`writing` preset、浏览器写作 UI | `packages/writing/{documents,documents-local,tool-documents,writing-mode}`、`packages/client/ui-writing/`、`apps/cli/config/agent-presets/writing/` | [笔记](notes/proposed/2026-08-17-writing-mode.md) ⚠️ 状态待订正 |
| **用量统计** — 每请求模型 token 用量折叠为会话投影、`/usage` 报告命令、设置页模型用量面板 | 跨 `packages/`，Web 设置面 | [笔记](notes/implemented/2026-08-14-usage-stats-session-projection-and-command.md) |
| **anchored-standard 预设** — 请求 #1 锚定 Minimal 双工具零注入条件，首次durable 回复或工具调用后提升为按需解锁的常驻工具集；相位由 durable 会话事件推导，压缩边界重入受控相位 | `apps/cli/config/agent-presets/anchored-standard/` | [笔记](notes/implemented/2026-08-17-anchored-standard-preset.md) |
| **锚定条件测量工装与近距离引导行** — 相位契约检查、按观测条件分组的全量会话对比、受控 2×2 付费重放；`session-guide` 行默认关闭 | `personal/probe/`、`apps/cli/config/agent-presets/anchored-standard/session-guide.mjs` | [笔记](notes/implemented/2026-08-18-anchor-probe-and-session-guide.md) |
| **`str_replace_editor` view 越界收敛** — 越界终行收敛而非报错 | `packages/` 编辑器工具 | [笔记](notes/implemented/2026-08-17-editor-view-range-clamp.md) |
| **UED 模式 B 阶段** — 内置 `ued` preset：设计人格 + 并发/冲突 policy section + 复用 `document_*` 与委派三件套（fork + continuable），产物为自包含 HTML；选择器中英双语（顺带补上 `writing` 与 `anchored-standard` 的缺失条目） | `apps/cli/config/agent-presets/ued/`、`packages/client/ui-agent-preset/` | [笔记](notes/implemented/2026-08-18-ued-mode-preset.md) |
| **个人插件层** — 模型中心（供应商/模型分离、按模型协议、多供应商降级、厂商预设与探活）、每模型采样默认值、模型中心设置页 | `personal/plugins/dsh-x-{model-hub,model-tuning,ui-model-hub}/` | [插件指南](guides/plugin-guide.md)、[探活复盘](archive/postmortem-2026-08-15-model-hub-probe.md) |

## 待安排

### 桌面 Stage B — 从 sidecar 壳到嵌入式桌面表面

[两阶段提案](notes/proposed/2026-08-15-desktop-runtime-surface.md) 定义方向，[可执行计划](notes/proposed/2026-08-18-desktop-stage-b-executable-plan.md) 拆成六个可独立落地的阶段。**当前进度：零**——作为门禁的 embedded-host spike 尚未运行。

| 阶段 | 目标 | 退出条件 |
|---|---|---|
| **Phase 0** — embedded-host 门禁 spike | 决定载波物理位置：Electron 主进程内嵌 Cordis 树，还是宿主留在 stdio/IPC 桥接的 Node 子进程 | 三项探测（引擎与 `node:sqlite`、原生 addon 的 Electron ABI 重编译、Loader 裸 specifier 解析）逐项有证据结论；不落地生产代码 |
| **Phase 1** — 桌面载波与载波等价测试 | 新增 `packages/client/desktop-connection`，四象限线上协议与 in-process 载波逐字节对齐 | 载波等价测试套件在桌面通道绿灯 |
| **Phase 2** — 经 IPC 的 renderer 侧 bundle 传输 | 去掉 loopback HTTP 依赖 | 桌面窗口在无监听端口下到达已 settle 的 UI；web 通道保持绿灯 |
| **Phase 3** — 嵌入式宿主插件与 `desktop` profile | 宿主进入插件树，profile 可管理 | `--dump-config` 不含 webserver 行；运行中不绑定 TCP 端口；`dsh plugin --profile desktop add` 可用；`embeddedHost` 关闭时 sidecar 回退可用 |
| **Phase 4** — 桌面原生能力插件 | 目录选择、路径打开、通知进入插件树 | 每个插件可从 profile 移除，缺失时响铃式降级 |
| **Phase 5** — HMR 与桌面 e2e 通道 | 开发闭环与 CI 信号 | 客户端插件 HMR 在桌面窗口中无刷新工作；桌面 e2e 在 CI 绿灯 |
| **Phase 6** — 发布加固 | 三端安装包与更新路径 | Windows / macOS / Linux 安装包；更新路径端到端演练；未签名构建仍通过 |

每个阶段均须通过仓库门禁：typecheck、lint、coverage、doc-sync、hygiene 与桌面 e2e 通道。

**关键风险**：Phase 0 的三项探测若任一失败，宿主须留在真实 Node 子进程，桥移到 stdio/IPC 传输——组合不变，只有载波物理位置移动。这是计划中唯一会改变后续阶段形态的分叉点，因此必须先跑。

### UED 模式——并发迭代的 HTML 原型设计

设计方案见[笔记](notes/proposed/2026-08-18-ued-mode.md)，B 阶段落地记录见[实施笔记](notes/implemented/2026-08-18-ued-mode-preset.md)。取代已废弃的 [dsh-x-wireframe 方案](notes/rejected/2026-08-17-wireframe-plugin.md)。

**B 阶段已落地**：`apps/cli/config/agent-presets/ued/`，policy section 是唯一新代码，随预设目录携带而非独立插件包（包名从宿主组合解析，会让预设依赖一次 `dsh plugin add` 才挂得起来）。设计方案里"任务可见性复用 `ctx.jobs` / `ui-jobs`"一条与实现不符：continuable 路由不注册 job，可见与取消的实际挂载点是 `ui-subagent` 的会话目录树与 `list_agents` / `interrupt_agent`。

**Open Design 相关事项已作废**（2026-08-18 决定）：不引入第三方设计工具，不 vendor 第三方设计系统，也不再走"先跑一遍其 MCP 路线"这个先决动作。代价是预设不携带成文设计规范，设计判断依赖模型自身知识；接入点（预设内 skill 根，`baseUrl` 推导，机制已由 `cordis` 预设验证）保留给日后自撰内容。

**C 阶段待安排**：预览视图 `dsh-x-ui-ued`，经 `conversation.view` 注册，iframe 渲染 + `documents/changed` 驱动刷新。验收：面板随子线程写入自动刷新；原型内脚本无法触达宿主 RPC 通道。iframe 沙箱逃逸按提案要求单独评审，不与功能一起赶工。

### 锚定收益的受控证据

[笔记](notes/implemented/2026-08-18-anchor-probe-and-session-guide.md)已把 `anchored-standard` 的轨迹收益从"无本机证据"推进到"有观测证据"：751 个推理块上，锚定组与非锚定组的 `we` / `let me` 指纹近乎完全分离。但两组的任务、模型、长度都不同，仍是相关性。

| 动作 | 命令 | 退出条件 |
|---|---|---|
| 受控 2×2 重放 | `node --import tsx/esm personal/probe/replay-first-request.ts --run --n 3` | 工具面杠杆（A vs B）与 persona 杠杆（A vs C）各自有分离的数字；结果落 `personal/probe/results/` |
| `session-guide` A/B | 新会话开启该行，再跑 `compare-presets.ts` | 长会话（≥10 轮）的指纹与步数与关闭时可比；Pro 与 Flash 分开看——上游数据显示效果按模型反转 |

两项都要花钱或花时间，且都必须在**新会话**上做：开启引导行会改变该会话之后所有请求的前缀。

## 状态订正待办

- **写作模式笔记状态**：[`notes/proposed/2026-08-17-writing-mode.md`](notes/proposed/2026-08-17-writing-mode.md) 仍标 `Status: proposed`，但提案的全部包（`documents`、`documents-local`、`tool-documents`、`writing-mode`、`client/ui-writing`）与 `writing` preset 均已存在于工作区（提交 `07ab6d0926`）。应改为 `Status: implemented` 并移入 `notes/implemented/`，同时核对提案验收标准是否逐条满足。
- **`personal/README.md` 文档路径**：正文以 `docs/plugin-guide.md`、`docs/postmortem-2026-08-15-model-hub-probe.md` 指代，实际路径已是 `docs/guides/plugin-guide.md`、`docs/archive/postmortem-2026-08-15-model-hub-probe.md`。这两处是代码跨度而非链接，门禁不覆盖，需手工订正。
