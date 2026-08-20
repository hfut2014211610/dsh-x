# DSH-X 总体计划

本 fork 已完成需求与待安排设计的单一视图。每项指向 [`notes/`](README.md#目录结构) 下的设计笔记；笔记是决策与验收标准的权威来源，本文只做索引与状态。

最后整理：2026-08-20。

## 已完成

| 需求 | 落地位置 | 笔记 |
|---|---|---|
| **桌面 sidecar 壳（Stage A）** — `dsh --profile web` 之上的 Electron 窗口，四来源运行时发现、三信号就绪门控、托盘驻留、单实例锁、进程树拆除 | `apps/desktop/` | [笔记](notes/implemented/2026-08-15-desktop-sidecar-shell.md) |
| **桌面 packed runtime 与安装包发布** — 安装包内嵌由该 release tag 自身构建的运行时，首启解压到 userData，校验和门控 | `scripts/release/`、`apps/desktop/electron-builder.yml` | [笔记](notes/implemented/2026-08-17-desktop-packed-runtime.md) |
| **实机反馈修复轮** — 启动不再冻结主进程（同步 spawn 移出绘制线程、安装版优先自带运行时）、加载页重做（跟随系统主题、分阶段进度、日志默认收起）、伴随栏拖宽驱动共享属性使 composer 同步、伴随栏横向溢出归零、产物自动在预览/编辑器中打开、每种格式都有阅读视图 | `apps/desktop/`、`packages/client/ui-{conversation,writing,ued}/` | [笔记](notes/implemented/2026-08-19-desktop-and-workspace-feedback-round.md) |
| **桌面生命周期归属与应用内升级** — 安装版不再附着外部实例、退出即关停；跨启动回收孤儿运行时（pid + origin 双证据）；退出与「活着但不应答」按同一故障处理，滚动窗口重启预算；自建升级链路（GitHub API 发现、tag 任意位置读版本、sha512 校验、退出时装） | `apps/desktop/` | [笔记](notes/implemented/2026-08-19-desktop-lifecycle-and-updates.md) |
| **写作模式** — `documents` 能力族、文档工具、`writing` preset、浏览器写作 UI | `packages/writing/{documents,documents-local,tool-documents,writing-mode}`、`packages/client/ui-writing/`、`apps/cli/config/agent-presets/writing/` | [笔记](notes/implemented/2026-08-17-writing-mode.md) |
| **写作视图 2026-08-20 一轮** — 打开即是文档而不是文件浏览器（工具栏默认折起，目录列举也随之不再预取）；多标签，切走的那份连未保存草稿一起留着，切回来不重读文件；预览里点一块就地改它的源文 | `packages/client/ui-writing/`、`packages/client/ui-primitives/`（一处默认关闭的上游开关） | [笔记](notes/implemented/2026-08-20-markdown-source-positions.md) |
| **用量统计** — 每请求模型 token 用量折叠为会话投影、`/usage` 报告命令、设置页模型用量面板 | 跨 `packages/`，Web 设置面 | [笔记](notes/implemented/2026-08-14-usage-stats-session-projection-and-command.md) |
| **anchored-standard 预设** — 请求 #1 锚定 Minimal 双工具零注入条件，首次durable 回复或工具调用后提升为按需解锁的常驻工具集；相位由 durable 会话事件推导，压缩边界重入受控相位 | `apps/cli/config/agent-presets/anchored-standard/` | [笔记](notes/implemented/2026-08-17-anchored-standard-preset.md) |
| **锚定条件测量工装与近距离引导行** — 相位契约检查、按观测条件分组的全量会话对比、受控 2×2 付费重放；`session-guide` 行默认关闭 | `personal/probe/`、`apps/cli/config/agent-presets/anchored-standard/session-guide.mjs` | [笔记](notes/implemented/2026-08-18-anchor-probe-and-session-guide.md) |
| **`str_replace_editor` view 越界收敛** — 越界终行收敛而非报错 | `packages/` 编辑器工具 | [笔记](notes/implemented/2026-08-17-editor-view-range-clamp.md) |
| **UED 模式 B 阶段** — 内置 `ued` preset：设计人格 + 并发/冲突 policy section + 复用 `document_*` 与委派三件套（fork + continuable），产物为自包含 HTML；选择器中英双语（顺带补上 `writing` 与 `anchored-standard` 的缺失条目） | `apps/cli/config/agent-presets/ued/`、`packages/client/ui-agent-preset/` | [笔记](notes/implemented/2026-08-18-ued-mode-preset.md) |
| **UED 模式 C 阶段** — 设计视图：原型列表 + 沙箱 iframe 预览，`documents/changed` 去抖刷新；隔离由双向单测与 web e2e 双重断言 | `packages/client/ui-ued/` | [笔记](notes/implemented/2026-08-18-ued-preview-view.md) |
| **连接器设置页** — 设置里新增"连接器"导航项，列出能从外部接进 dsh 的应用渠道并自带飞书卡片；没装的渠道照样列出并给出安装命令；`settings.connector.item` 是下一个渠道自己挂卡片的位置 | `packages/client/ui-settings-connectors/` | [笔记](notes/implemented/2026-08-18-connectors-settings-page.md) |
| **个人插件层** — 模型中心（供应商/模型分离、按模型协议、多供应商降级、厂商预设与探活）、每模型采样默认值、模型中心设置页 | `personal/plugins/dsh-x-{model-hub,model-tuning,ui-model-hub}/` | [插件指南](guides/plugin-guide.md)、[探活复盘](archive/postmortem-2026-08-15-model-hub-probe.md) |

## 待安排

### 桌面 Stage B — 从 sidecar 壳到嵌入式桌面表面

[两阶段提案](notes/proposed/2026-08-15-desktop-runtime-surface.md) 定义方向，[可执行计划](notes/proposed/2026-08-18-desktop-stage-b-executable-plan.md) 拆成六个可独立落地的阶段。**Phase 0–5 当前进度：零**——作为门禁的 embedded-host spike 尚未运行，运行时仍是 sidecar 形态、仍绑一个回环端口。

Phase 6（发布加固）中属于升级义务的那一半已经落地，见上方[桌面生命周期与升级笔记](notes/implemented/2026-08-19-desktop-lifecycle-and-updates.md)；该阶段剩下的是 Linux 产物与 macOS 公证。

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

**C 阶段已做完**（见[实施笔记](notes/implemented/2026-08-18-ued-preview-view.md)）：`packages/client/ui-ued/`，一个 `conversation.view` 标签页，左边列原型、右边沙箱 iframe 渲染，`documents/changed` 带 400ms 尾沿去抖触发刷新。实机验证：iframe 属性恰好是 `allow-scripts`，框内 CSP meta 到位，原型的内联脚本与交互正常。位置偏离提案——放 `packages/client/` 而不是 `personal/plugins/`，因为发行流程只打 `packages/*/*` 和 `apps/*`，放个人插件层的话安装包里不会有这个视图。

[安全评审](notes/proposed/2026-08-18-ued-preview-iframe-security.md)的两条要点都成立。一是方向：在此之前原型是在用户默认浏览器里以 `file://` 裸跑，沙箱 iframe 是**降低**风险而不是引入风险。二是五条硬规则里只有一条错了会全盘失守而且完全看不出来——`allow-scripts` 绝不能和 `allow-same-origin` 同列——它由单测的白名单加黑名单双向断言兜住，web e2e 里再断言一次装配后的真实属性。规则 1 和规则 4 已在本机 Chromium 上实测过。

**缺陷 3 随 C 阶段消解**：`ued` 会话现在有自己的视图，不需要放宽 `ui-writing` 的门。

**缺陷 5（阻断，已修复）**：装了安装包之后 UED 一写文件就报 `file access denied under workspace-write mode`。`documents-local` 调 `fs.writeText` 时不带 per-call 策略，围栏于是用环境策略；而 `sandboxPolicy.resolve()` 不带会话时回落到部署配置的根，Web bundle 把它取自运行时的 `process.cwd()`——开发时在仓库里启动服务，那个目录**正好**等于工作区，所以一直没暴露；打包后它是安装目录，于是每次文档写入都被拒。`writing` 预设同样中招。现在带着调用方会话解析策略（`tool-fs` 本来就是这么做的）。回归断在接缝上而非靠"被拒"：`writableRoots` 永远包含系统临时目录，测试工作区就在那里，根写错了在测试里照样放行。已用 `--patch` 把兜底根指到工作区之外真跑一轮复现并验证。**后续已修**：`applyStructuredEdit`（`.docx`/`.xlsx`）直接用 `node:fs` 写，完全绕过围栏——`create` 明明先用 `writeText` 过一次围栏再落字节，它头上的注释还写着编辑路径同理，实际上编辑路径一次都没过。不需要给 fs 接缝加写字节的方法：改成跟 `create` 同一条路，先带策略 `writeText` 过围栏，字节再落到已被证明可写的路径上。回归钉在 `read-only` 上而不是钉在根上——`workspace-write` 永远放行系统临时目录，测试工作区就在那里，没围栏也照样能写；`read-only` 拒绝一切写，被拒就只可能是因为真的过了围栏。

**两个视图的边栏可调宽**：`ui-primitives` 新增 `ResizeHandle`（指针捕获、移动合并到一帧、方向键、`role="separator"` 带实时 `aria-valuenow`），设计视图的原型栏与写作视图的工具面板共用。宽度存在视图状态里，卸载后回到默认。没有跟应用外框那个分隔条合并——那个是覆盖层定位且与外框列求解耦合。

**视觉一轮**（见[连接器笔记](notes/implemented/2026-08-18-connectors-settings-page.md)末节）：设计视图加了预览宽度切换（自适应 / 桌面 / 平板 / 手机），左栏表头 sticky 并与舞台表头对齐，选中行加竖条，舞台底色下沉一层让白底原型不再跟面板糊在一起；写作视图当前文档行加同样的竖条，字数统计改等宽数字，选中高亮换品牌色调。

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
| **产出级测量**（[提案](notes/proposed/2026-08-18-anchor-outcome-study.md)） | 首个结果已出，但任务饱和 | L1（三处跨包回归、15 个失败测试）两条臂各 3 次**全部 PASS**，产出无差异；同批会话轨迹指纹仍完全分开（we-only 71.8% 对 0%）。结论只能到"锚定不会把活干砸"，不能到"锚定没用"——双方都撞天花板的任务没有分辨力。真正的矛盾是：能自动判分的任务往往两种条件都能过，能分辨的任务往往判分要靠人 |
| **按路由开关 + 压缩重锚验证**（[遗留实现](notes/proposed/2026-08-19-anchored-standard-route-switch.md)） | 待做，证据已足 | 给 `tool-bootstrap` 加 persona-only 档（默认不变），让 Flash 路由在真实使用里攒证据；补一个跨压缩边界的 e2e——`compaction-reanchor` 至今在每个会话上都是 `skip`，那段降级代码从未真正跑过 |
| 修正 `agent.cordis.yml` 头部因果说明 | ✅ 已完成 | 头部现在并列"继承说法"与"本机实测"，两处上游数字就地标注未复现 |
| 相位契约脱离手抄常量 | ✅ 已完成 | `lib/phases.ts` 直接读预设 yml；改预设立刻改变契约期望，已验证 |
| ~~指纹侧大样本复核~~ | **降级** | 精确化的是代理指标而非决策依据；产出级测量出结果前不做 |
| 压缩边界重锚 | **从未验证** | 语料里没有任何会话触发过压缩，契约里 `compaction-reanchor` 永远是 `skip`。需要构造一个足够长的会话 |
| `session-guide` A/B | 待做，优先级已下调 | 其前提（长会话稀释）在本机找不到证据；但指纹不覆盖目标遵从度，所以不是已被证伪 |

减法必须等产出级证据。n=3、单任务、单语言的指纹数据可以推翻一个**说法**（上游的因果解释确实被推翻了），但拆掉一套正在工作的机制需要知道拆了之后活会不会变差——而这一点，整个指纹语料一个字都没说。

## 状态订正待办

- ~~**写作模式笔记状态**~~：已订正并移入 [`notes/implemented/`](notes/implemented/2026-08-17-writing-mode.md)。九条验收标准逐条核过；第九条缺的那一半（组装后的写作会话没有任何断言）本轮补上了，见笔记的「落地情况」一节。
- ~~**`personal/README.md` 文档路径**~~：已订正。同一轮把索引补齐——`plugins/dsh-x-feishu/` 与 `probe/` 此前不在正文里，指向上游 `docs/architecture.md` 的那处也改成了显式的仓库根相对链接（这份 README 里裸写的 `docs/` 一律指 `personal/docs/`）。
- **`personal/plugins/` 下两份模型中心旧副本**：`dsh-x-model-hub/` 与 `dsh-x-ui-model-hub/` 在毕业进 `packages/` 之后没删，两边源码已分叉；`~/.dsh/profiles/headless` 的 lockfile 还链着旧副本。删之前要确认没有 profile 在用，因此没有顺手处理。
