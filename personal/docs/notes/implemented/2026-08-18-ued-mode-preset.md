# Agent Note: UED 模式 B 阶段——内置 `ued` 预设

Status: implemented

落地 [UED 模式设计笔记](../proposed/2026-08-18-ued-mode.md) 的 B 阶段。该笔记留在 `proposed/`，因为它同时提出了尚未落地的 C 阶段预览视图；本笔记记录 B 阶段实际落地的组合与三处偏离提案的判断。

## 问题

dsh 没有面向 UI 设计的模式。设计工作的形态是"迭代为主、指令短频快"：首次生成只占很小一部分，其后是一条接一条的小改动。若每条改动都在主会话内联执行并阻塞，交互节奏被破坏；若切到外部工具，模型既看不到产物也无法按指令修改它。

## 决策

新增第六个内置预设 `apps/cli/config/agent-presets/ued/`（选择器名"UED 模式"，order 6）。它不发明中间表示，也不写客户端代码——产物就是工作区里的自包含 HTML 文件，`documents-local` 的 `formatOf()` 无白名单，`.html` 落入 `'code'` 分支，因此写作模式已在用的版本守卫 `document_*` 接缝原样承载原型，写成功的文件同样成为聊天里可点开的 deliverables chip。

组合共四段，只有 policy section 是新代码：

- **`persona`** —— 设计人格，替换部署默认。
- **`ued-mode`**（`./ued-mode.mjs`，本预设唯一新代码）—— 注册 `ued:policy` 提示段（order 90，与 `writing:policy` 同位）。内容分四块：产物形态（单文件自包含 HTML、一屏一文件、无构建步骤、无外部资源）、编辑规则（只经 `document_edit` + 前次 `document_read` 的版本）、并发规则（每条改动起一个线程，`send_message` 续投同一产物的后续工作，`list_agents` 查看、`interrupt_agent` 取消，同时活跃线程数封顶）、冲突策略（按产物分线程 → 撞 `DOCUMENT_STALE_VERSION` 后重读重做 → 主线程串行落盘）。`delegationTool` 与 `maxActiveThreads` 是必填 config，缺失或类型不符在挂载时报错——线程数是随部署变化的选择，不能是插件里的 `DEFAULT_*` 常量。
- **`tool-documents`** —— 复用，五个 `document_*` 工具。
- **委派三件套** —— `tool-subagent-control`（`send_message` / `interrupt_agent`）、`tool-subagent-control/list-agents`（`list_agents`）、以及一个 `provider: fork`、`backgroundMode: continuable`、`toolName: subagent` 的 `tool-subagent` 实例。

`fork` 而非 `spawn`：设计线程收到的指令是"按钮改圆角"这类片段，只有贴着本会话已有的设计上下文才成立；fork 子会话以父会话**已完成**的 turns 为种子（精确切到最后一个 `turn/end`，不含进行中的半截 turn），spawn 则要求每条指令都自带完整背景。

`continuable` 而非 base bundle 给 fork 配的 `one-shot`：one-shot 存在的理由是让 fork 子会话的请求前缀与父会话逐字节一致以复用 KV cache（见上游 `2026-08-10-fork-children-stay-one-shot.md`），而这里更需要的是子线程在启动后仍可被 `send_message` 寻址，以承接同一产物的下一条指令。

组合内没有任何行 `provide()` 服务，因此不需要 `isolate` realm。`documents` 服务、`subagents` 注册表、`fork` 后端全部留在 web bundle 的宿主面。

## 与提案的偏差

**policy 插件放在预设目录内，而不是 `personal/plugins/dsh-x-ued/`。** `dsh-agent-presets` 对行的解析规则是：**包名从宿主组合解析，相对路径从预设自己的目录解析**。写成 `@personal/dsh-x-ued` 的话，预设只有在 `dsh plugin add` 把它装进 profile 的 node_modules 之后才挂得起来——一个内置预设不该依赖一次插件安装才能工作。写成 `./ued-mode.mjs` 则随目录携带，`agentPresets.copy` 复制整个预设目录后依然可用。这与 fork 已有的 `anchored-standard`（五个预设本地 `.mjs`）是同一模式，也不违反 fork 边界：新增预设目录不修改任何上游文件。

**并发的可见与取消不在 `ui-jobs`。** 提案的复用矩阵把它记成 `ctx.jobs` + `ui-jobs`，与实际不符：`tool-subagent` 只在**一次性后台**路由里调 `jobs.start()`，continuable 路由走 `ctx.subagents.startContinuable()` 并直接返回 `{ kind: 'continuable', subagentId }`，不注册任何 job。因此 `ui-jobs` 不会列出设计线程。真正的挂载点是 `ui-subagent`：它向 `conversation.session.header.actions` 贡献可展开的子会话目录树，逐行显示 `running`/`inactive`、用量与时长，选中即进入子会话 transcript；运行中的 continuable 子会话由其 composer 的 Stop 经 `subagent.interrupt` 取消。模型侧对应 `list_agents` 与 `interrupt_agent`。本预设因此不挂 `tool-jobs`——它不产生任何 job。

**未 vendor 设计系统。** 提案的 B 阶段还包括从 Open Design vendor 3–5 个设计系统作为 skills。本次未做：那是把约 260 KB 第三方 Apache-2.0 内容连同 LICENSE、NOTICE 与来源 commit 一并落进本仓库的决定，与预设本身可分离，且 B 阶段的五条验收标准无一依赖它。落地路径已确认可行：`cordis` 预设把自己的 skill 根写成 `customSkillDirs: [!!js "…fileURLToPath(new URL('skills/', baseUrl))"]`——`baseUrl` 在预设的 `!!js` 求值环境里就是预设自己的目录，因此 skill 根随目录携带。照此在 `ued/skills/` 下放置 `SKILL.md` 形式的设计系统，再补 `skill-filesystem`（加 `includeDefaultRoots: false`，使设计会话只看到设计规范而非工程 skills）与 `tool-skill` 两行即可。空的 skill 根加加载工具等于白付目录注入的 token，所以机制与内容作为一个整体一起落地，而不是先挂空壳。

## 备选方案

**并入写作模式。** 否决，理由同提案：writing preset 只有 persona + writing-mode + tool-documents 三行、不挂委派工具，拿不到并发；设计人格与写作人格、并发策略与文档策略混在一个 preset 里会互相污染。

**给预设加 `tool-ask-user`。** 否决：policy 要求"跨线程改同一视觉元素前先回主会话确认"，但主会话本就是交互式的，普通回复即可完成确认；加一个工具会破坏"只含 `document_*` 与委派三件套、不含编码工具"这条验收标准。

**把 subagent 实例命名为 `subagent_fork`（与 `standard` 一致）。** 否决：本预设只暴露这一条委派路由，`subagent` 是更直接的名字。代价是 `ued-mode` 的 `delegationTool` 必须与该行的 `toolName` 保持一致，两处都写了交叉注释。

## 后果

- 选择器新增第六个内置预设。`apps/cli/tests/web-agent-presets.e2e.ts` 的完整清单断言相应更新——顺带补上此前遗漏的 `writing`，该断言在此之前已与磁盘不符。
- 同一文件新增 `ued` 组合测试，覆盖三条验收标准：工具目录**精确**等于五个 `document_*` 加 `interrupt_agent`/`list_agents`/`send_message`/`subagent`（编码工具回流是这类组合最安静的失败模式）；委派工具的描述来自 fork 的继承措辞（spawn 路由会挂得同样干净，却悄悄要求每条指令自带完整背景）；`ued:policy` 段包含冲突恢复与线程数封顶。
- `apps/web/tests/snapshots/agent-preset-selection/menu.expected.md` 需增加对应菜单项。
- `ued-mode.mjs` 的两个 config 必填，因此复制该预设后删掉 `config:` 会在挂载时明确报错，而不是静默丢失并发策略。

## 风险

| 风险 | 现状 |
|---|---|
| 语义冲突静默覆盖 | 版本守卫覆盖不到，只能靠 policy 强制"按产物分线程"优先、跨线程改同一元素先回主会话确认。这是本模式已知的、无运行时兜底的盲区 |
| `delegationTool` 与 `toolName` 漂移 | 两处交叉注释加一条 e2e 断言；没有机械门禁能把它们绑死 |
| continuable fork 牺牲请求前缀复用 | 有意为之（见上）；代价是每个设计线程的首个请求不复用父会话的 KV cache |
| C 阶段 iframe 沙箱逃逸 | 未开始。提案要求单独评审，不与功能一起赶工 |
