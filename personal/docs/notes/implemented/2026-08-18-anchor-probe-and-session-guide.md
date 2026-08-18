# Agent Note: 锚定条件测量工装与近距离引导行

Status: implemented

## 问题

[`anchored-standard` 预设笔记](2026-08-17-anchored-standard-preset.md)结尾自己承认了一处缺口：

> 轨迹上的收益属于继承来的证据，不是本地保证：锚定条件（schema、预算、注入）由新测试断言，轨迹本身没有断言，因为无密钥的测试断言不了模型行为。

也就是说，预设的**机制**有 e2e 断言，预设的**收益**一条本机证据都没有，全靠继承上游 `xiaobright/dsh-anchored-standard` 在它自己评测上的测量。

第二处缺口来自调研另外两个社区仓库（`KDB-Wind/dsh-minimal-anchored`、`yjh051108/dsh-routing-suite`）。前者是本预设的严格子集，没有可吸收的东西。后者的 `dsh-router-standard` 提出了一条本预设完全没覆盖的轴：本预设管完**首轮**条件就撒手，而长会话里锚定条件虽然还在前缀里，占比却一路稀释下去，没有任何机制重述工作姿态。那个项目管对策叫"近距离引导"——每条用户消息后面追加一条固定引导——并报告三个锚（回顾、防跑题、给结论）把开放任务的完成率从 0% 提到了 100%。

## 决策

两件事：一件补证据，一件补机制。

### 一、`personal/probe/`：锚定条件的本机测量工装

四个脚本，三个不花钱、一个花钱：

- **`analyze-session.ts`**（免费）：单会话体检。它成立的前提是**相位约定**——loop 只在请求头变化时追加一条 `request/header`（`packages/core/session/src/request-header.ts`），所以 header 事件的序列就是模型实际看到的工具目录序列，预设那套两段式设计因此在持久日志里完全看得见。五条检查：首轮目录恰好是那对双工具、首轮 system 与 Minimal 逐字相同、晋升前没有自动注入、晋升到的是 resident 集而不是整份目录倒出来、每个压缩边界之后重新裁剪。`skip` 表示这一情形没出现过，不等于通过。
- **`compare-presets.ts`**（免费）：把历史会话全量聚合。**按观测到的首轮条件分组，不按预设标签分**——`agent-preset/selected` 只在显式选预设时才落库，实测就有跑在锚定条件下、标签却是 `(unrecorded)` 的会话；只有 header 才如实反映"模型看到了什么"。
- **`drift.ts`**（免费）：长程漂移。按位置分桶把会话的推理块走一遍，再按压缩 epoch 分段，回答"锚定撑不撑得住"。单请求重放在结构上就测不到这件事。
- **`replay-first-request.ts`**（付费，默认 dry-run）：受控重放。任务固定，system 与 tool schema **逐字取自真实会话的 `request/header`**，注入内容取自真实的 wide 会话。A/B 只差工具面，A/C 只差 persona，A/E 只差上下文注入，F 是完整的 standard 条件。

轨迹指纹分类器（词表与打分权重）移植自 `dsh-router-standard` 的 `probe/classifier.mjs`（MIT），**权重刻意一个没动**，为的是让数字和上游可比。其余部分是本 fork 自己写的，归属见 `personal/probe/NOTICE`。

### 二、`session-guide.mjs`：近距离引导行，**默认关闭**

从 `agent/pre-step` 瀑布注入，位置紧跟在本步 CLAIMED 的消息批次后面——和 `dsh-agent-instructions` 同一个位置，理由也一样：用户提示在前，driver 追加的运行时上下文在后。这个位置还保证前缀缓存不受影响：pre-step 消息是持久的，第 N 轮的引导到第 N+1 轮仍在历史里，共享前缀只增不改。

幂等同样从持久事件推出来：引导消息的 id 是它所跟随的那条用户消息 id 的函数，resume、reload、重新 claim 都算出同一个 id，被"已引导"检查挡掉。晋升前不注入，`compaction/end` 边界降级之后也不注入。

## 实测结果

`compare-presets.ts --limit 250`，89 个日志里 8 个有效：

| 组 | n | 语言 | 推理块 | we-only% | letMe% | we/块 | letMe/块 | 块中位长度 | 步/会话 |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| wide（完整首轮目录） | 6 | zh | 155 | 1.4% | 76.6% | 0.1 | 3.5 | 1859 | 30.3 |
| anchored（双工具首轮） | 2 | zh | 596 | **69.0%** | **0.5%** | 2.3 | 0.0 | 265 | 322.5 |

751 个推理块上两组几乎完全分开。单个 `anchored-standard` 会话（`deepseek-v4-pro`，110 块）五条相位检查全过，header 时间线是 `2 → 5 → 6` 个工具（初始双工具对 → resident 集 → `dev_tool_search` 解锁 `pwsh`），指纹 we 2.7 / let's 1.0 / **let me 0.0**。

三点限定：

- **这是观测数据，不是受控实验。** 两组的任务、模型、长度都不同，预设还是当时人工选的。目前只是待验证的假设，要受控结论得跑 `replay-first-request.ts`。
- **指纹不等于能力。** 轨迹形态变了，不代表结果更好。
- **中文题面也复现了**，和上游 issue #6/#11「中文题面不能稳定产生英文 `we` 指纹」的报告对不上。样本量小，但值得单独记一笔。

还有一处形态差异同样明显：锚定组推理块中位 265 字符、平均 322 步，非锚定组 1859 字符、30 步，一边是"想一段做一段"，一边是"一条长链"，和 `dsh-router-standard` README 里描述的两种思考形态一致。

分类器的 `minimal-like` 标签阈值在真实会话上明显失准（110 块里 109 块判成 `ambiguous`）：阈值是拿单轮探针调出来的，那里的推理块要开启整个任务，习惯以 `We need…` 起头；长会话里大多是中途续接的短块。所以聚合层新增 `weOnlyShare` / `letMeShare` 两个指标并以它们为准，原标签保留，但降级成参考。

## 受控重放结果：system 与工具目录这两项

在本地网关 `x-models` 的三个模型上跑完整 2×2，两个协议，一共 **72 次请求，零失败**。任务固定为某个真实会话的首条中文提示（278 字符），锚定臂用 `anchored-standard` 会话的 header#0（2 工具 / 46 字符 system），wide 臂用 `standard` 会话的 header#0（25 工具 / 6200 字符 system）。表里是 **we-only%**（n=3）：

| 模型 / 协议 | A `Min+2` | B `Min+25` | C `wide+2` | D `wide+25` |
|---|---|---|---|---|
| Flash-0731 / openai | **100** | **100** | 0 | 0 |
| Flash-0731 / anthropic | **100** | **100** | 0 | 0 |
| Pro-0813 / openai | **100** | 0 | 0 | 0 |
| Pro-0813 / anthropic | 33 | 0 | 0 | 0 |
| Pro / openai | 33 | 0 | 0 | 0 |
| Pro / anthropic | 67 | 0 | 0 | 0 |

1. **起决定作用的是 persona，三个模型两个协议全都一致。** A→C 与 B→D 合起来 **12 组对照**，每组只要换掉 Minimal 那一句就翻转轨迹，无一例外。
2. **工具面在 Flash-0731 上完全不起作用。** 单元 B——Minimal persona 配完整的 25 个工具目录——两个协议下都保持 100% 锚定，而且模型确实用了这份宽目录（请求了 `pwsh`/`glob`/`grep`/`todo_write`），不是目录没生效。
3. **工具面在两个 Pro 条目上都起作用。** A→B 一律掉到 0%，persona 和目录必须一起裁。
4. **两个 Pro 条目连最好的那格 A 都只有 33–67%**，而 Flash-0731 是 100%。预设是照着 Pro 级模型设计的，实测正好反过来：Flash 稳定锚住，Pro 靠抛硬币。而 `agent-default-model` 恰恰是 `deepseek-v4-flash-0731`——**默认路由付了裁剪目录的全部代价，换来的可测收益是零**。

**这和本预设的出身相反。** `dsh-anchored-standard` / `dsh-minimal-anchored` 把首轮工具 schema 当成关键，persona 当成次要条件（它们那张 5/5 对 8/8 的对照表）。本机数据反过来，倒是和 `dsh-router-standard` 的"persona 主导、tool-schema 次要"一致。

限定：n=3，单元内还有方差（33% 就是 3 次里中 1 次）；单一任务、单一语言；指纹不等于能力；wide 臂的 system 取自另一个项目的会话。`deepseek-v4-pro` 和 `deepseek-v4-pro-0813` 是 model-hub 里两个不同条目（显示名互相交叉），两个都测了。原始结果在 `personal/probe/results/`。

新增能力：`lib/endpoint.ts` 现在会说两种方言（`openai` / `anthropic`），由 `--protocol` 显式指定。本 fork 的 model-hub 是按模型选协议的，拿 harness 根本不会用的协议去重放，等于改了被测对象的线上形状。顺带修掉一个真隐患：原来的默认 baseURL 按**模型名**匹配，会把本地网关上的 `deepseek-v4-pro-0813` 悄悄重定向到 `api.deepseek.com`，同名不同模型。现在只按 provider 路由名匹配。

## 第三项：上下文注入（单元 E/F）

A–D 只把 system 和目录分开了。预设控制的是**三**项条件，第三项是 `context-gate` 压掉的自动注入。单元 E 把 system 和目录都固定在锚定值上，只加上从真实 wide 会话里取出来的注入（4 条消息、9569 字符：AGENTS.md 摘要 + 技能目录 + 2 条 plugin）；F 是三样全放开，也就是完整的普通 standard 首请求。

| 模型 / 协议 | A（无注入） | **E（+注入）** | F（全放开） |
|---|---|---|---|
| Flash-0731 / openai | 100 | **100** | 0 |
| Flash-0731 / anthropic | 100 | **100** | 0 |
| Pro-0813 / openai | 100 | **100** | 0 |
| Pro-0813 / anthropic | 33 | **100** | 0 |
| Pro / openai | 33 | **100** | 0 |
| Pro / anthropic | 67 | **100** | 0 |

**注入不但没打断锚定，还把两个 Pro 条目从部分锚定抬成了完全锚定。** 只看 A 没满分的那三格：A 是 9 次里锚住 4 次，E 是 9 次锚住 9 次，四个还有空间的组合里一次也没往反方向走。这和 `context-gate` 的立论（上游"技能目录在场时 9 次锚定 0 次"）直接冲突。

有个混杂因素要点明：E 比 A 多了 9569 字符输入，"上下文更多所以更有依据"同样能解释这个方向。但不管哪种解释，"压掉注入有助于锚定"都得不到支持。

三项条件的账：

| 条件 | 预设机制 | 首请求上的贡献 |
|---|---|---|
| **persona** | `persona` 行（`complete: true`） | **真正管用，12/12 翻转** |
| 工具目录 | `tool-bootstrap` + `dev-tool-search` | Flash 上为零；两个 Pro 上有效 |
| 上下文注入 | `context-gate` + `instruction-hint` + `skill-search` | **为零，方向还相反** |

## 长程漂移（`drift.ts`，免费）

上面全都是**单请求**实验。预设控制的是首请求，但它**声称**的是首请求锚定整个会话，这一点单请求重放测不到。存下来的会话本身就是长程的，所以漂移可以免费测：按位置分桶把推理块走一遍，再按压缩 epoch 分段。

| 会话 | 预设 / 模型 | 块 | 首桶 → 末桶 we-only | letMe |
|---|---|---|---|---|
| a69c76e8 | anchored-standard / Pro | 110 | 64% → 73% **STABLE** | 全程 0% |
| 5fe2b4df | 锚定（未记标签）/ Flash | **486** | 63% → 87% **RISE** | **十桶全 0%** |
| 146bc746 | code / Pro（wide） | 66 | 0% → 0% | 全程 ~100% |
| 9ff33cf3 | code / Pro（wide） | 36 | 0% → 25% | 100% → 25% |

**锚定不衰减**：486 块、十个桶，`let me` 一次都没出现；两个锚定会话都持平或走高。

这对 `session-guide` 是反证——它的前提"长会话里锚定被稀释"，在本机找不到。但**别过度解读**：指纹测的是行文风格，不是目标遵从度，`session-guide` 那三个锚（回顾、防跑题、给结论）是另一根轴，这里没测。

指纹**没**捕捉到的另一种漂移：锚定 Pro 会话的块中位长度从 253 涨到了 2077 字符。准确的说法是"**代词轨迹不漂移，思考长度会**"。

空白：语料里**没有任何一个会话触发过压缩**，所以压缩边界重新锚定这套设计至今没验证过——相位检查里 `compaction-reanchor` 永远是 `skip`。

## 备选方案

**从 `dsh-minimal-anchored` 吸收内容。** 否决：逐项比过之后，它是本预设的严格子集——首轮剥离按 `source.kind` 列黑名单（本预设是把整个 `SystemPrompt.context()` 家族清空）、晋升时倒出完整目录（本预设裁到 resident 集，预设注释也写明倒出来会把轨迹打回 standard-like）、没有压缩边界重新锚定、没有子 agent 同步。它唯一多出来的 `bootstrapMaxTokens: 1024` 是默认开启的，原笔记已经论证过否决、只留作 opt-in；而且它全部实验数据都带着这顶帽子跑，等于把 schema 和预算帽两项绑在一起测。

**吸收 `dsh-router-standard` 的分类，换掉 persona。** 否决：本预设的锚就是"persona 与 Minimal 逐字节相同 + `complete: true`"，换 persona 等于拆自己的地基。而且那个项目的 standard 模式（RL 句 + 双工具面）和本预设是同一个东西，真正新的只有 spec/react/weak 几个变体。

**默认开启 `session-guide`。** 否决，三条理由按分量排：(1) 稀释这件事本身在本 fork 从没测量过，更谈不上它的对策，默认开启等于拿两个未验证假设换掉一个；(2) 上游自己的数据显示效果按模型反转——回顾和给结论这两个锚点能抬 Flash，而在它的 P24 轮次里，同一批锚点让 Pro 的套件分数低于裸配置（83% < 87.5%），默认开启等于对一半路由悄悄加了一条有害臂；(3) 这个想法已发布的实现根本跑不起来——`dsh-router-standard` v0.3.0 的 `preset/router-standard/router-bootstrap.mjs` 在 `session/event` 处理器里调了 `bandOf` 和 `extractText`，两个都没 import，一进处理器就是 ReferenceError，它 README 宣传的"路由 96% + 收敛 100% + 反稀释"在发布代码里从来没运行过。本行的机制是照着描述重写的，不是移植那份代码。

**把上游那张中英关键词复杂度表内置进来。** 否决：`complexText` 的分派留给 `complexPattern` 配置项，默认不启用。把上游针对他们自己路由调出来的词表烧进默认值，等于把他们的调参当成发现搬过来。

**用 `session/event` + `inbox.append` 注入（上游的做法）。** 否决：`agent/pre-step` 是本预设其余各行已经在用的同一条瀑布，顺序语义明确（`context-gate` 在最外层，本行在它里面，且只在晋升后发射），也不会多出 `agent/inbox/spliced` 事件。

**新增思维模式预设（react/doer 等）。** 本轮不做，按需求方要求暂缓。

## 后果

- `personal/probe/` 不在 workspace 里，不参与 `tsc -b`、lint 和任何检查，和已有的 `personal/scripts/dump-session.ts` 一样，用 `node --import tsx/esm` 跑。相位检查里的期望值（`BOOTSTRAP_TOOLS`、`COMPACTION_TOOLS` 等）是预设配置的**手抄副本**：改了预设配置却没改 `lib/phases.ts`，检查会悄悄失准。这是脱离仓库检查的代价，写在 `lib/phases.ts` 开头。
- `session-guide` 行是 `disabled: true` 挂上去的。禁用的行不会被实例化，所以常规路径永远验证不了它在真实组合里挂不挂得起来——这次是临时把它开起来，跑通 `web-agent-presets.e2e.ts` 的两段式用例确认过一遍，以后每次改动都要重复这个临时开启的验证。行为层面有 11 项检查覆盖（未晋升不注入、位置在 claimed 批次之后、tool 续接步不重复、同一条用户消息只引导一次、持久事件播种幂等、压缩边界之后停止、reject 透传、畸形输入降级）。
- 开启这一行，每个用户轮次多约 40 token，全会话累计；而且第一次开启会改变该会话之后所有请求的前缀，跟已有会话没法直接比，A/B 必须在新会话上做。
- `verify-cordis-config` 通过（141 个配置文件）。预设目录仍然自包含，`agentPresets.copy` 复制之后照样能用。
- 这次测量把预设笔记结尾"轨迹本身没有断言"的状态，从"没有证据"推到了**有本机受控证据**：观测层 751 个推理块上两组几乎完全分开，受控层的 2×2 把两项条件分开了。
- **预设头部的因果说明和本机数据对不上，这是本轮最该修的东西**：`agent.cordis.yml` 头部写的是"模型强烈依赖首轮可见的工具目录……Minimal 双工具 5/5 锚定，standard 系 schema 11/11 落败"。本机实测是 persona 主导（12/12），目录次要且按模型分化。这句话留着，下一个人就会去优化错的地方。
- **两套机制被测出不管用，这是本轮最重的结论**：三项条件里只有 persona 在所有模型上都生效（12/12）。工具目录在 Flash-0731（`agent-default-model`）上贡献为零；上下文注入在三个模型上贡献都为零，方向还相反——压掉它反而让两个 Pro 条目锚得更差。也就是说，`tool-bootstrap` + `dev-tool-search` 和 `context-gate` + `instruction-hint` + `skill-search` 这两套机制，在本机路由上都没有数据支持，而预设绝大部分复杂度和全部前缀缓存代价都出自它们。
- **长程不衰减**：486 块的锚定会话，十个位置桶 `let me` 全是 0%，两个锚定会话都持平或走高。但代词指纹不覆盖思考长度——同一会话里块中位长度从 253 涨到 2077——所以准确的说法是"代词轨迹不漂移，思考长度会"。
- **这次测量提出了一个未决问题**：预设为了控制工具面付出了实打实的代价——每次目录变化断一次前缀缓存（晋升一次、每次 `dev_tool_search` 解锁各一次），重型工具永远隔着一次调用，三个发现工具常驻目录。而在 Flash-0731（`agent-default-model`）上，这套机制买不到任何可测收益；在两个 Pro 条目上它确实管用。合理的下一步是给 `tool-bootstrap` 加一个可关的档（保留 persona 和注入压制，不裁目录），按路由选。**顺序是：先有开关才能做大样本 A/B，但改默认必须等大样本**——n=3、单任务，不足以据此翻掉预设默认。
- 结论只覆盖本地网关 `x-models` 上的这几个模型。换模型、换任务、换语言都得重跑；`replay-first-request.ts` 就是为了让重跑变便宜。
