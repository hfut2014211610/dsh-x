# Agent Note: 用量统计从会话日志折叠并在设置界面呈现

Status: implemented

## 问题

harness 以前只报会话这一级的 token 消耗：token-meter 的 `tokenUsage` 单元按供应商分桶累加，session-stats 发布墙钟时间。但没有任何界面能回答"每次模型请求花了多少"——每次请求的 input/cache/output 各是多少、实际走了哪条路由、耗时多久，都看不到。codex/zcode 那种用量面板要的正是这一级视图，而且要做成所有 Web 用户都能打开的设置页，不是逐会话的命令。

## 决策

两个包，各占一个 seam：

- **数据**（`@deepseek-ai/dsh-usage-stats`，packages/session/usage-stats）：`usageStats` 会话投影单元把已有的日志事件折叠成记录，一次模型请求一条。`assistant/chunk` 报上来的 usage 会提前建好或更新这个 step 的记录，所以 usage 已经流出、请求随后失败的那些也算得上账；`assistant/message` 用最终 usage 和 `llmMs` 把记录定下来（`llmMs` 取 `step/start` 到 message 这一段，和 session-stats 求和用的是同一个边界）；`request/context` 补上实际派发的 provider/model 和上下文窗口，最后写入的那次胜出，只在路由变化时落盘。这里没有新增会话事件，没有运行时拦截，也没有动 `SESSION_FORMAT_VERSION`：所有数据都从持久日志重建，所以注册表的 watermark 缓存、持久化检查点和变更通知都是白拿的。`./client` 出口把类型镜像一份给浏览器那边用。
- **呈现**（`@deepseek-ai/dsh-client-ui-settings-usage`，packages/client/ui-settings-usage）：设置界面的"用量"页（槽位 `settings.section`，id `usage`，order 25），把会话列表行里的 `usageStats` 投影值汇总成一个**全局**视图。统计区间选择器（7 天 / 28 天 / 90 天 / 全部，默认 28 天）约束页面上所有数字，往下是整个列表的汇总条、按天排的点阵图、以及每个模型一行的明细表。点阵图一个区间日一格、最多 28 格，颜色深浅按窗口内最忙那天的四分位分档，每格悬浮显示相对日期和当天的分桶；格子设了 aria-hidden，golden 里就不会出现墙钟日期。换区间时拿最后一次成功取回的数据在本地重算，不再请求。面板不认会话身份：会话只贡献请求数据，不贡献身份。早期版本渲染过逐会话、逐请求的下钻，被这个模型级视图取代了。store 只读一页 `session.list`，而每个列表行本来就带着投影块，所以不需要新的 host 端点。

用会话列表当载体是这里少不了的一步：`session.list` 对挂载中的会话从实时注册表切面取投影值，对冷会话从持久化投影缓存取，所以设置作用域的面板自己不持有会话，也能看到每一个会话，不必走 `useProjection` 那条会话作用域的路。host 单元挂在 web-app bundle 里，紧挨 session-stats；base bundle 不挂，那边没人用它。

## 备选方案

- **`/usage` 命令**（`CommandResult.text` Markdown）：先做出来了，评审后按新方向换掉。命令给的是逐会话的一段文本，不是设置页；底下的折叠层原样留用。
- 逐会话行加可展开的每回合条与逐请求表：第二版做了，评审后同样换掉。要的视图是全局的，模型是唯一的下钻轴，全局汇总加按天点阵取代了会话下钻。
- **面板里直接用 `useProjection('usageStats')`**：否决。projections face 只在会话作用域（`SessionProvider` 子树）里有，而设置模态框按设计就不持有会话。
- **拦截 `llm/stream`** 拿逐请求的延迟与 usage：否决。运行时拦截等于把日志里已有的东西再记一遍，还会破坏回放等价性；投影这条路本来就是由已提交的事件驱动的。
- **扩展 token-meter 的 `tokenUsage` 单元**，让它带上逐请求记录：否决。这个单元的值是 O(1) 的分桶累加，塞进一个会不断变长的请求数组，它的数据形状就变了，所有已经在读它的地方都得跟着改；而单开一个 key 不花什么代价。

## 后果

- 同一个 step 上重复采到的 usage，`usageStats` 是替换不是累加（沿用 token-meter 的相邻性不变量），所以重试过的 step 报的是最后一次尝试的数。辅助 LLM 调用（生成标题、搜索）不计账，因为它们的事件不带 usage。
- 面板读的就是侧边栏读的那批列表行，于是：冷会话的新鲜度受检查点约束（简介行用 `asOfSeq` 标出数据到哪了），一页列表限定了总计的范围，面板打开后也不会流式跟上活跃会话的最新请求（要靠打开、重置或手动刷新）。
- Web e2e（`apps/web/tests/usage-settings.e2e.ts`）种了一个三请求、双模型、带投影缓存行的会话：`seedSession` 现在会先起一个不入 store 的 `prepare` 会话，在已启动 host 的注册表上折叠一遍种子，再通过 host 自己的缓存服务写检查点，冷行因此不用 host 侧加载日志就带上了 title 和 usageStats。早于"带标识消息"信封的旧 fixture 跳过写缓存这步，它们的冷行不带投影，行为和以前完全一样。
- 手写种子可以把事件时间写成相对运行时的 token（`{{now}}` / `{{now-<ms>}}`，落成 JSON 数字）：按天分窗的视图和 golden 就不会因为录死的时间戳而过期。`assertFixtureInventory` 会在做基于解析的 header 检查之前，先把这些 token 占位化。
- `realizeSeedFixture` 现在会对替换进来的工作区路径做 JSON 转义，修掉了 Windows 这类反斜杠主机上裸 join 破坏种子 fixture header 行 JSON 的问题。
- 跨会话的汇总仍然放在客户端做；要在服务端做全局折叠，那是一个新的持久化决策。
