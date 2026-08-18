# Agent Note: 锚定收益的产出级测量（提案）

Status: proposed

## Problem

[测量工装笔记](../implemented/2026-08-18-anchor-probe-and-session-guide.md)用 108 次请求把 `anchored-standard` 的三条杠杆分开了，结论是只有 persona 承重，工具目录与上下文注入两组机制在本机路由上都不被数据支持。

但那 108 次请求测的全是**指纹**——`we` / `let me` 的措辞分布。工装自己的文档里反复写着"指纹不等于能力"，然后整套证据链建立在这个代理指标上。上游至少还有分数（Project2：Minimal 99/96 对 Standard 91/92），本 fork 一个都没有。

于是"该不该拆掉那两组机制"这个决定，目前无论如何都做不了：

- 拆，依据是"指纹上没贡献"——可指纹本来就不是要优化的东西；
- 不拆，依据是"上游说有用"——可上游的因果解释已经在本机被推翻。

**缺的不是更大的 n，是另一个指标。** 把指纹测到 n=30 只会让代理指标更精确，不会让它更相关。这一点是对上一份笔记里"大样本复核是做减法之前的门禁"的修正：门禁设错了。

## Decision（待批准）

用**可自动判定结果的任务**，在两个条件下各跑一遍，比较产出而非措辞。

### 判分原则

1. **一条命令，exit 0/1。** 判分脚本不含我的判断，否则等于把要消除的东西请回来。
2. **任务必须够长。** 观测数据里锚定会话是 144–500 步、非锚定 26–30 步；3 步的任务不可能分辨两种轨迹形态。
3. **每次运行独立的 git worktree**，同一 commit 出发，跑完丢弃。
4. **任务形态必须两边都有。** 锚定轨迹是"短块多步、想一段做一段"，非锚定是"一条长链"。全是 debug 型任务会系统性偏向前者——那是把结论提前写好。所以下面刻意混了偏迭代与偏规划两类。

### 候选任务集

| # | 任务 | 形态 | 判分命令 |
|---|---|---|---|
| **T1** | 种入一处 `packages/core/session/src/chunk-rows.ts` 的单行回归，任务是"测试有失败，定位并修复，不要改测试文件" | 偏迭代 | `npx vitest run packages/core/session/tests` exit 0 **且** `git diff --name-only` 不含 `tests/`（约 3 秒） |
| **T2** | "自动注入的 AGENTS.md 摘要在哪个 seam 被折进模型请求？相对用户消息在什么位置、为什么？写进 `ANSWER.md`" | 偏迭代（检索） | `ANSWER.md` 同时匹配 `agent-instructions`、`pre-step`、`(after|之后|随后)`。真值：`packages/context/agent-instructions/src/index.ts`，折在 claimed 批次之后 |
| **T3** | 种入一处坏文档链接，任务是"`verify-md-links` 失败，修好" | 机械/中性 | 门禁 exit 0 |
| **T4** | "给 `personal/probe/lib/phases.ts` 增加第六条检查 `no-heavy-tools-at-promotion`：晋升后的 header#1 不得含 `web_search` / `subagent` / `workflow`" | 偏规划（按规格新增） | 预先写好的断言脚本：新检查 id 存在，且在已知良性会话上 `pass`、在合成的违规 header 上 `fail` |
| **T5** | 种入一处**跨文件**回归（改 A 包的导出语义，让 B 包的测试失败），任务同 T1 | 偏迭代（深） | 对应 vitest 套件 exit 0 且未改测试 |
| **T6** | "给 `personal/probe/` 补一套 `node:test` 单元测试，覆盖 `classifier` / `phases` / `log` 三个模块的导出函数" | 偏规划（长程） | `node --test personal/probe/tests` exit 0 **且** 测试文件提及的被测函数名 ≥ 12 个 |

T6 顺带补掉一个真实欠账——`personal/probe/` 目前零测试，而它现在承载着全部结论。

**被我否掉的一类候选**：形如"改动 X 需要动哪些文件，给出清单"的影响面题。判分要拿我拟的真值集去比对，等于把我的判断塞回评分环节。

### 运行方式

`dsh --profile headless "<task>"` 可以一次答完并退出，所以整套是可脚本的。但它不带预设选择：`--dump-config` 显示它直接组合 agent，没有 `agentPresets` 那一层。锚定臂因此要靠启动器的 `--patch` 覆盖层补上，具体怎么补见下面的 spike 结果。

验收标准从一开始就定死了，也确实起了作用：用 `analyze-session.ts` 跑覆盖层产生的会话，相位契约必须过。契约不过就说明这一轮没复现出锚定条件，产出分数一律作废。

### 先导批次

不要一次上 12 个会话。先跑 **T1 + T6 各两个条件 = 4 个会话**，看两件还没验过的事：判分脚本是不是真能判，以及这两个任务的会话长度有没有进到能分辨两种轨迹的区间（观测数据里锚定会话 144–500 步、非锚定 26–30 步）。相位契约那一条已经在 spike 里验过了，但每轮仍要跑，它是唯一能发现"这轮跑错条件了"的检查。先导过了再补齐剩下 8 个。



## Spike 结果（2026-08-18）：走通了，但前两条路都是死的

方案里写的那个 spike 跑完了。**结论是可以脚本化**，代价是绕了两次弯。判定标准始终是相位契约的输出，不是我读代码得出的判断。

### 第一条路：把预设的行抄进 `--patch` 覆盖层——加载就报错

`@deepseek-ai/dsh-persona` 要注册 `deployment:persona` 这个段，而宿主平面的 `system-prompt` 已经占了这个名字。报错本身就写了怎么办：*"for a per-agent override, register through that agent's `agent.ctx` instead"*。

也就是说预设组合只能挂在单个 agent 的作用域下，不是宿主平面能承载的东西。而 persona 恰好是实测里唯一真正管用的那个因素，所以一个复现不了 persona 的覆盖层，根本没资格当锚定臂。

### 第二条路：`agent/created` 里挂真预设——挂上了，但晚了一步

组合成功，任务答对，`agent-preset/selected` 也落库了。看起来完全正常。契约给出的却是：

```
[FAIL] bootstrap-catalog   header#0 = 25 个标准工具，期望 [bash, str_replace_editor]
[FAIL] minimal-system      system = "You are an AI agent powered by DeepSeek Harness…"
[FAIL] clean-first-request injected: agent-instructions, skill-catalog
[PASS] resident-promotion  header#1 = 锚定 resident 集
```

预设从请求 #2 才生效，而请求 #1 正是整个研究唯一关心的那个。原因在 `packages/core/agent/src/index.ts`：`agent/created` 是同步派发的，监听器返回的 promise 被刻意不 await，所以异步的 `recompose` 必然落在首个请求后面。

**这次没有契约就会出事**：退出码 0、答案正确、预设标签也对，整轮数据看着都是好的，实际上两条臂的首个请求完全一样，等于没有对照。

### 第三条路：包住 `agents.create`——通过

正确的时机是 `CreateAgentOptions.setup`，它跑在"minting agentCtx 之后、插入和广播之前、首次 prompt 组装之前"。但只有调用 `agents.create()` 的那一方能传它，对这个 profile 就是 `packages/bundle/headless/src/index.ts`，上游文件，本 fork 不改。

`personal/probe/tasks/preset-setup.mjs` 从插件里包住注册表的 `create` 方法，在里面补上 `setup`，从而够到同一个时机。约 40 行，上游 runner 一行不动，也不存在第二份会走样的副本。契约结果：

```
[PASS] bootstrap-catalog   header#0 tools = [bash, str_replace_editor]
[PASS] minimal-system      system == Minimal sentence
[PASS] clean-first-request no auto-injected context before promotion
[PASS] resident-promotion  header#1 = [bash, dev_tool_search, skill_load, skill_search, str_replace_editor]
```

wide 臂就是原样的 headless，无需任何覆盖层：header#0 是 25 个工具、标准 system、两种注入齐全。两条臂的差别干净，正是研究要的那个差别。

### 现成的运行方式

```sh
node personal/probe/tasks/run-condition.mjs --condition anchored --task "<任务>"
node personal/probe/tasks/run-condition.mjs --condition wide     --task "<任务>"
```

跑完会打印会话路径，直接喂给 `analyze-session.ts` 验。**每次锚定臂的运行都要验**，`bootstrap-catalog` 不过就说明那一轮无效。

三条踩出来的路径规则记在模板头部，都是当时卡住的地方：`--patch` 里的相对插件名按 **profile 目录**解析而不是按 patch 文件；`!!js` 只对 config 值求值，不对 `name` 求值，算出来的名字会变成 `[object Object]`；裸的 win32 绝对路径会被当成 `d:` 协议拒掉，必须写成 `file://`。

`mount-preset.mjs` 留着没删，头部标了实测失败和原因，免得下一个人再走一遍第二条路。

**先导批次现在没有前置阻塞了。**


## 先导批次结果（2026-08-18）：实验台成立，任务集不成立

跑了两批共 6 个会话。**结论是实验台可以用，但这套任务集测不出东西**，得重新设计。先导要验的两件事，一件过了一件没过。

### 实验台：过

- worktree 隔离、两条条件、自动判分、契约验证，端到端跑通，全程无人工介入。
- 锚定臂的相位契约 **3/3 次全过**，说明每一轮的首个请求确实是锚定条件。
- 轨迹差异在实验台上复现了，和历史语料一致：

| 组 | 会话 | 推理块 | we-only% | letMe% | 块中位长度 |
|---|---:|---:|---:|---:|---:|
| anchored | 2 | 41 | 72.8% | 1.3% | 315 |
| wide | 1 | 21 | 0.0% | 90.5% | 1305 |

- 研究会话落在独立的项目目录（`--D-dev-.dsh-probe-worktree--`），不会掺进日常语料。

### 任务集：不过

**T1 分辨不出两条臂。** 两边都修好了种入的回归，步数都是 11，一模一样。而且两边推理块都是 0，模型对这个难度根本没展开思考。

**T6 同一条件下两次跑出完全不同的结果。**

| 批次 | 条件 | 产出 | 步数 |
|---|---|---|---:|
| 一 | anchored | 三个测试文件共 25KB，11/11 导出函数覆盖 | 41 |
| 一 | wide | 同上 | 31 |
| 二 | anchored | `node --test` 直接失败 | 24 |
| 二 | wide | 141 字节的占位测试（`assert.equal(1+1, 2)`）就收工 | 30 |

第一批两条臂都做完了，第二批两条臂都没做完。**同一条件的两次运行之间的差异，比两条条件之间的差异还大。** n=1 在这里没有任何意义。

**任务太短。** 观测语料里能看出差异的是 144–500 步的会话，这里最长 41 步。两条轨迹形态的区别要在长任务上才显出来，短任务两边都能糊弄过去。

### 判分脚本自己的两个 bug，都是先导抓出来的

1. **阈值设在天花板之上**：要求覆盖 ≥12 个导出函数，而三个模块一共只导出 11 个。这个任务按构造不可能通过，第一批两条臂都做对了却都判 FAIL。已改成 ≥8。
2. **正则没锚行首**：`export function` 不带 `^` 会连注释里的词一起算，把分母抬高。已改成 `^export function` 配 `gm`。

这两个都只有真跑一遍才会暴露，也正是先导批次存在的理由。

### 下一批要改什么

| 改动 | 原因 |
|---|---|
| 每格 n≥5 | 同条件两次运行的方差已经压过条件间差异，n=1 的数字不能用 |
| 任务要进到 100 步以上 | 41 步分辨不出来；观测到差异的区间是 144–500 步 |
| 规格写死到没法半途收工 | wide 臂写个 `1+1=2` 就交差，说明"补一套单元测试"这种说法留了太多余地 |
| 判分脚本先自测 | 拿现成的正确答案和现成的错误答案各跑一遍判分，确认它能分开，再拿去跑会话 |

T1 那种"种入回归再修好"的形态可以保留，但要种更深的、跨文件的，让它进到需要反复试的区间。

## Consequences

- 这是本轮唯一能支撑"拆或不拆"的证据类型。指纹侧的大样本复核就此**降级**——它精确化的是代理指标，不是决策依据。
- 成本以时间为主而非额度：T6 类任务在语料里对应 144–500 步的会话。12 个会话是可观的墙钟时间。
- 判分脚本与种入的回归本身要入库（建议 `personal/probe/tasks/`），否则实验不可重复，跟没做差别不大。
- 若产出无差异：两组不承重的机制该拆，且拆得有依据——`tool-bootstrap` + `dev-tool-search` 与 `context-gate` + `instruction-hint` + `skill-search` 是预设几乎全部复杂度与全部前缀缓存代价的来源。
- 若产出有差异而指纹无法解释：说明真正起作用的东西不在已测的三条杠杆里，那比拆机制重要得多。
- 若两个条件在不同任务形态上各有胜负：那才是"按路由/按任务选档"的真正依据，也是 `dsh-router-standard` 那套思路唯一值得吸收的形态。

## 未决

- **压缩边界重锚仍然零验证**：语料里没有任何会话触发过压缩，契约里 `compaction-reanchor` 永远是 `skip`。T6 这类长程任务有机会顺带触发，届时该条检查会首次真正生效。
- **`session-guide` 的目标遵从度轴**：指纹测不到它的三锚（回顾/收敛/反跑题）。同一批任务可以顺带跑第三个条件（锚定 + 开启该行），成本是多 6 个会话。
