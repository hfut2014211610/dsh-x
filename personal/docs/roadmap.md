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

设计方案见[笔记](notes/proposed/2026-08-18-ued-mode.md)，B 阶段做出来的东西记在[实施笔记](notes/implemented/2026-08-18-ued-mode-preset.md)。取代已废弃的 [dsh-x-wireframe 方案](notes/rejected/2026-08-17-wireframe-plugin.md)。

**B 阶段已做完**：`apps/cli/config/agent-presets/ued/`，只有 policy section 是新代码，跟着预设目录走而不是做成独立插件包（包名要从宿主组合解析，那样预设就得先 `dsh plugin add` 才挂得起来）。设计方案里"任务可见性复用 `ctx.jobs` / `ui-jobs`"一条与实现不符：continuable 路由不注册 job，可见与取消的实际挂载点是 `ui-subagent` 的会话目录树与 `list_agents` / `interrupt_agent`。

**Open Design 相关事项已作废**（2026-08-18 决定）：不引入第三方设计工具，不 vendor 第三方设计系统，也不再走"先跑一遍其 MCP 路线"这个先决动作。代价是预设不携带成文设计规范，设计判断依赖模型自身知识；接入点（预设内 skill 根，`baseUrl` 推导，机制已由 `cordis` 预设验证）保留给日后自撰内容。

**B 阶段实测**（四轮真实会话，见[实测笔记](notes/proposed/2026-08-18-ued-b-stage-live-run.md)）：五条验收标准现在**全部验过**。

| 验收 | 结果 |
|---|---|
| 工具集只含 `document_*` 与委派三件套 | ✅ e2e 断言 |
| 产出自包含 HTML | ✅ 551 行，零外部引用 |
| 产物成为可点开的 chip | ✅ 修完缺陷 2 后 |
| 三条指令不阻塞、可见可取消 | ✅ 委派、会话头子代理目录、`send_message` 续投都通 |
| 撞版本后重读重做，改动不丢 | ✅ 构造出真冲突后跑通，两个线程的改动最终都在 |

过程里查出四个代码缺陷，全部已改：

- **缺陷 1（阻断）**：`document_read` 的 `render` 只输出 `content`，version 从不交给模型，而 `document_edit` 的 `base_version` 只能来自它。三轮修改指令约 60 次调用、零次成功，模型最后去读 harness 源码想反推 version 长什么样。`writing` 预设一样中招。
- **缺陷 2**：`ui-deliverables` 按渲染意图而非工具名识别产出文件，文档工具没声明调用视图，所以写出来的文件永远不生成 chip。
- **缺陷 4（严重）**：模型想要不存在的字符串锚定替换，编出 `{find, unit:'line'}` 但没有 `start`/`end`。`applyTextEdit` 的越界检查对 `undefined` 全为假，偏移量算成整份文档，于是 **21 931 字节的页面被 168 字节替换文本静默覆盖，`isError: false`，版本守卫也看不见**。写作模式下更危险，长文会被一次"看起来成功"的编辑清空。
- **policy 少一句**：子线程在父会话回合结束后还在干活，父会话却立刻读文件核对，读到"不存在"当成失败，还重发了一遍。已补上"落定通知到达前不要读文件核对"。

**缺陷 3 仍未处理**：`ui-writing` 的视图只对 `writing` 开，`ued` 会话在应用内没有工作区视图。跟 C 阶段一起决定。

**C 阶段待安排**：预览视图 `dsh-x-ui-ued`，经 `conversation.view` 注册，iframe 渲染，`documents/changed` 触发刷新。[安全评审已完成](notes/proposed/2026-08-18-ued-preview-iframe-security.md)。结论有两条要点。一是方向：现在原型是在用户默认浏览器里以 `file://` 裸跑，沙箱 iframe 是**降低**风险而不是引入风险。二是归纳出的五条硬规则里，只有一条错了会全盘失守而且完全看不出来——`allow-scripts` 绝不能和 `allow-same-origin` 同列——所以它必须由白名单加黑名单双向断言的单测兜住，不能靠人工评审。规则 1 和规则 4 已在本机 Chromium 上实测过。

### 锚定收益的受控证据

[笔记](notes/implemented/2026-08-18-anchor-probe-and-session-guide.md)已把 `anchored-standard` 的轨迹收益推进到**有本机受控证据**，并把预设的三条杠杆全部分开测了（本地网关 `x-models`，三个模型 × 两协议，共 108 次请求）：

| 杠杆 | 预设机制 | 结论 |
|---|---|---|
| **persona** | `persona` 行（`complete: true`） | **承重，12/12 翻转** |
| 工具目录 | `tool-bootstrap` + `dev-tool-search` | Flash-0731（默认路由）为零；两个 Pro 有效 |
| 上下文注入 | `context-gate` + `instruction-hint` + `skill-search` | **为零，方向还相反**——抑制它让两个 Pro 锚得更差 |

长程漂移另测（免费，`drift.ts`）：**锚定不衰减**，486 块的会话十个位置桶 `let me` 全为 0%。但代词指纹不覆盖思考长度，同一会话块中位长度从 253 涨到 2077。

这两点合起来意味着：预设绝大部分复杂度与全部前缀缓存代价，来自两组**本机数据不支持**的机制。

| 动作 | 状态 | 退出条件 |
|---|---|---|
| 受控三杠杆分离 | ✅ 已完成，结果在 `personal/probe/results/` | 三条杠杆各自有分离的数字 |
| 长程漂移 | ✅ 已完成 | 锚定组按位置分桶无单调下滑 |
| **产出级测量**（[提案](notes/proposed/2026-08-18-anchor-outcome-study.md)） | 可以开跑 | 6 个能自动判分的任务 × 两条件。**headless 前置已打通**：`personal/probe/tasks/preset-setup.mjs` 包住 `agents.create` 补上 `setup`，锚定臂相位契约 4/4 过（前两条路都失败了，原因记在提案里）。先跑 T1+T6 的 4 个会话看看判分脚本和会话长度是否可用 |
| 修正 `agent.cordis.yml` 头部因果说明 | ✅ 已完成 | 头部现在并列"继承说法"与"本机实测"，两处上游数字就地标注未复现 |
| 相位契约脱离手抄常量 | ✅ 已完成 | `lib/phases.ts` 直接读预设 yml；改预设立刻改变契约期望，已验证 |
| ~~指纹侧大样本复核~~ | **降级** | 精确化的是代理指标而非决策依据；产出级测量出结果前不做 |
| 压缩边界重锚 | **从未验证** | 语料里没有任何会话触发过压缩，契约里 `compaction-reanchor` 永远是 `skip`。需要构造一个足够长的会话 |
| `session-guide` A/B | 待做，优先级已下调 | 其前提（长会话稀释）在本机找不到证据；但指纹不覆盖目标遵从度，所以不是已被证伪 |

减法必须等产出级证据。n=3、单任务、单语言的指纹数据可以推翻一个**说法**（上游的因果解释确实被推翻了），但拆掉一套正在工作的机制需要知道拆了之后活会不会变差——而这一点，整个指纹语料一个字都没说。

## 状态订正待办

- **写作模式笔记状态**：[`notes/proposed/2026-08-17-writing-mode.md`](notes/proposed/2026-08-17-writing-mode.md) 仍标 `Status: proposed`，但提案的全部包（`documents`、`documents-local`、`tool-documents`、`writing-mode`、`client/ui-writing`）与 `writing` preset 均已存在于工作区（提交 `07ab6d0926`）。应改为 `Status: implemented` 并移入 `notes/implemented/`，同时核对提案验收标准是否逐条满足。
- **`personal/README.md` 文档路径**：正文以 `docs/plugin-guide.md`、`docs/postmortem-2026-08-15-model-hub-probe.md` 指代，实际路径已是 `docs/guides/plugin-guide.md`、`docs/archive/postmortem-2026-08-15-model-hub-probe.md`。这两处是代码跨度而非链接，门禁不覆盖，需手工订正。
