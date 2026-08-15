# Agent Note: 用量统计从会话日志折叠并在设置界面呈现

Status: implemented

[English](2026-08-14-usage-stats-session-projection-and-command.md) | 中文

## 问题

harness 此前只报告会话粒度的 token 消耗：token-meter 的 `tokenUsage` 单元累计供应商分桶，session-stats 发布墙钟时间，但没有任何界面回答"每次模型请求花了什么"——逐请求的 input/cache/output 拆分、请求实际运行的路由和它的延迟。codex/zcode 风格的用量面板需要的正是这种请求粒度视图，而且期望的呈现是一个所有 Web 用户都能打开的设置界面页面，不是逐会话的命令。

## 决策

两个包，各占一个 seam：

- **数据**（`@deepseek-ai/dsh-usage-stats`，packages/session/usage-stats）：一个 `usageStats` 会话投影单元把既有日志事件折叠为每次模型请求一条记录——`assistant/chunk` 的 usage 上报会提前创建或更新该 step 的记录（已流出 usage 随后失败的请求仍被计账），`assistant/message` 以最终 usage 与 `llmMs`（`step/start` → message，即 session-stats 求和的同一边界）落定它，`request/context` 提供实际派发的 provider/model 与上下文窗口（最后写入胜出，仅在路由变化时落盘）。没有新会话事件、没有运行时拦截、没有 `SESSION_FORMAT_VERSION` 变动：一切从持久日志重建，投影因此免费获得注册表的 watermark 缓存、持久化检查点与变更通知。`./client` 出口为浏览器消费方镜像类型。
- **呈现**（`@deepseek-ai/dsh-client-ui-settings-usage`，packages/client/ui-settings-usage）：设置界面的"用量"页（槽位 `settings.section`，id `usage`，order 25），把会话列表行的 `usageStats` 投影值聚合为一个**全局**视图——统计区间选择器（7 天 / 28 天 / 90 天 / 全部，默认 28 天）约束所有数字，全列表汇总条、按天点阵图（每个区间日一格、上限 28 格，强度按窗口内最忙一日的四分位分档，每格悬浮提示展示相对日期与当日分桶，格子 aria-hidden 使 golden 不含墙钟日期）、以及每个模型一行聚合的明细表；切换区间对最后一次成功数据离线重聚合。面板无视会话身份：会话只贡献请求，不贡献身份；早期迭代渲染的逐会话/逐请求下钻按此模型级视图被替换。store 读取一页 `session.list`；每个列表行本就携带投影块，因此不存在新的 host 端点。

会话列表载体是承重选择：`session.list` 对挂载中的会话从实时注册表切面提供投影值，对冷会话从持久化投影缓存提供，因此设置作用域的面板（不持有会话）无需 `useProjection` 的会话作用域就能看到每个会话。web-app bundle 在 session-stats 旁挂载 host 单元；base bundle 不挂（那里没有消费方）。

## 备选方案

- **`/usage` 命令**（`CommandResult.text` Markdown）：先做了，随后按评审方向替换——命令是逐会话的 UI 文本，不是设置界面；折叠层原样保留。
- 逐会话行加可展开的每回合条与逐请求表：第二版做了，随后按评审方向替换——期望的视图是全局的，模型是唯一的下钻轴；全局聚合与按天点阵取代了会话下钻。
- **面板内 `useProjection('usageStats')`**：否决——projections face 只存在于会话作用域（`SessionProvider` 子树）；设置模态框按构造不持有会话。
- **拦截 `llm/stream`** 获取逐请求延迟与 usage：否决——运行时拦截重复记录日志已有的内容并破坏回放等价性；投影 seam 已经从已提交事件驱动状态。
- **扩展 token-meter 的 `tokenUsage` 单元**加逐请求记录：否决——该单元的值是 O(1) 分桶累计；增长的请求数组会改变它对每个既有消费方的契约，而独立 key 没有任何成本。

## 后果

- `usageStats` 记录对同一 step 的重复 usage 采样是替换而非累计（token-meter 的相邻性不变量），因此重试的 step 报告其最终尝试；辅助 LLM 调用（标题、搜索）不计账，因为它们的事件不携带 usage。
- 面板读取的正是侧边栏读取的列表行：冷会话新鲜度受检查点约束（简介行以 `asOfSeq` 披露），单页列表限定总计范围，打开的面板不流式跟随活跃会话的最新请求（打开/重置/按需刷新）。
- Web e2e（`apps/web/tests/usage-settings.e2e.ts`）种子一个带投影缓存行的三请求双模型会话：`seedSession` 现在经一个不入 store 的 `prepare` 会话在已启动 host 的注册表上折叠一次种子，并通过 host 自己的缓存服务写检查点，因此冷行以零 host 侧日志加载携带 title 与 usageStats。早于"带标识消息"信封的旧 fixture 跳过缓存步骤（它们的冷行不带投影，与之前行为完全一致）。
- 手写种子可以把事件时间标记为相对运行时（`{{now}}` / `{{now-<ms>}}`，以 JSON 数字落地）：按天分窗的视图与 golden 永不因固定录制时间戳而过期，`assertFixtureInventory` 在其基于解析的 header 检查前先把这些 token 占位化。
- `realizeSeedFixture` 现在对替换进来的工作区路径做 JSON 转义，修复反斜杠主机（Windows）上种子 fixture 被裸 join 破坏 header 行 JSON 的问题。
- 跨会话聚合保持在客户端；任何服务端全局折叠都是新的持久化决策。
