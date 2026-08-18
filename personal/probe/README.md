# probe — 锚定条件的本地测量工装

`anchored-standard` 预设的[设计笔记](../docs/notes/implemented/2026-08-17-anchored-standard-preset.md)在结尾留了一句：

> 轨迹上的收益属于继承来的证据，不是本地保证：锚定条件（schema、预算、注入）由新测试断言，轨迹本身没有断言，因为无密钥的测试断言不了模型行为。

这个目录就是补上那一环。四件工具，三件免费、一件付费。

## 四件工具

| 脚本 | 成本 | 回答什么 |
|---|---|---|
| `analyze-session.ts` | 免费，纯本地 | 单个会话：两段式相位契约是否成立 + 推理轨迹指纹 |
| `compare-presets.ts` | 免费，纯本地 | 全部历史会话：锚定组 vs 非锚定组的轨迹差异 |
| `drift.ts` | 免费，纯本地 | **长程**：锚定在一个会话内部会不会随位置衰减，压缩边界后能否恢复 |
| `replay-first-request.ts` | **付费** | 固定任务、逐个变量：persona / 工具面 / 上下文注入三条杠杆各自的贡献 |

全部脚本只打印计数、标签和工具名。**不打印推理原文、提示词原文、文件内容或密钥。**

## 用法

需要 Node ^22.19 || >=24，仓库根目录执行：

```sh
# 最近一个会话的完整体检
node --import tsx/esm personal/probe/analyze-session.ts --latest

# 指定会话
node --import tsx/esm personal/probe/analyze-session.ts ~/.dsh/sessions/<proj>/<sid>/session.jsonl.zstd

# 长程漂移：锚定在会话内部会不会衰减
node --import tsx/esm personal/probe/drift.ts --all --min-blocks 30

# 全量对比（默认扫最近 120 个会话）
node --import tsx/esm personal/probe/compare-presets.ts --limit 250

# 只看中文会话、最近两周、按预设名分组
node --import tsx/esm personal/probe/compare-presets.ts --days 14 --lang zh --by-preset

# 受控重放：默认 dry-run，只打印计划
node --import tsx/esm personal/probe/replay-first-request.ts
node --import tsx/esm personal/probe/replay-first-request.ts --run --n 3

# 本地网关的两个模型，跑完整 2×2（协议须与 model-hub 里该模型的 api 一致）
PROBE_BASE_URL=http://127.0.0.1:18080/v1 \
node --import tsx/esm personal/probe/replay-first-request.ts --run --n 3 \
  --session <anchored.jsonl.zstd> --wide-session <wide.jsonl.zstd> \
  --model deepseek-v4-flash-0731,deepseek-v4-pro-0813 \
  --provider x-models --protocol openai
```

各脚本的完整参数写在文件头注释里。

## 相位契约（`analyze-session.ts` 断言什么）

预设的**机制**在持久日志里完全可观测：loop 只在请求头**变化时**追加一条 `request/header`（见 `packages/core/session/src/request-header.ts`），所以 header 事件序列 = 模型实际看到的工具目录序列。五条检查：

| 检查 | 含义 |
|---|---|
| `bootstrap-catalog` | 请求 #1 的目录恰好是 `bash` + `str_replace_editor` |
| `minimal-system` | 请求 #1 的 system 与 Minimal 原句逐字相同 |
| `clean-first-request` | 晋升前没有任何自动注入的上下文消息 |
| `resident-promotion` | 晋升后是 resident 集，不是完整目录倾倒 |
| `compaction-reanchor` | 每个压缩边界之后目录重新收窄 |

`skip` 表示"这个会话没出现该情形"，**不等于通过**。

契约只适用于锚定会话。`compare-presets.ts` 按**观测到的首轮条件**（header#0 是否为双工具对）分组，而不是按预设标签——`agent-preset/selected` 只在显式选预设时才落库，所以会有会话实际跑在锚定条件下、标签却是 `(unrecorded)`。header 才是模型真正看到了什么的唯一真相。

## 已测结果（2026-08-18，本机）

`compare-presets.ts --limit 250`，89 个日志中 8 个有效（其余推理块 < 3）：

| 组 | n | 语言 | 推理块 | we-only% | letMe% | we/块 | letMe/块 | 块中位长度 |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| wide（完整首轮目录） | 6 | zh | 155 | 1.4% | 76.6% | 0.1 | 3.5 | 1859 |
| anchored（双工具首轮） | 2 | zh | 596 | **69.0%** | **0.5%** | 2.3 | 0.0 | 265 |

751 个推理块上近乎完全分离。单个 anchored-standard 会话（`deepseek-v4-pro`，110 块）五条契约检查全过，指纹 we 2.7 / let's 1.0 / **let me 0.0**。

三点要说清楚：

- **这是观测数据，不是受控实验。** 两组的任务、模型、长度都不同，预设也是当时人工选的。差异是待验证的假设，受控结论要跑 `replay-first-request.ts`。
- **指纹不等于能力。** `we` / `let me` 只说明轨迹形态变了，不说明结果更好。
- **中文题面也复现了。** 上游（`xiaobright/dsh-anchored-standard` issue #6/#11）报告中文题面不能稳定产生英文 `we` 指纹；本机数据与之不符。样本量很小，但这条差异值得单独注意。

另一处形态差异同样明显：锚定组推理块中位长度 265 字符、会话平均 322 步，非锚定组 1859 字符、30 步——即"想一段做一段"对"一条长链"。这与 `dsh-router-standard` README 描述的 standard/spec 两种思考形态一致。

## 付费重放的设计

`replay-first-request.ts` 消除 `compare-presets.ts` 的混杂因素：固定任务，逐个变量，且 system 与 tool schema **逐字取自真实会话的 `request/header`**，不是手写近似。

2×2 单元：

| | bootstrap 双工具 | wide 完整目录 |
|---|---|---|
| **Minimal system** | A | B |
| **wide system** | C | D |

A vs B 隔离**工具面**杠杆，A vs C 隔离 **persona** 杠杆，D 是普通 standard 条件。`--model a,b` 让每个模型跑完整 2×2，因此同一单元的跨模型差异可直接对比。

这比上游的做法严格：所有上游复现都用手写的 schema 近似，并且在同一次改动里带上 1024 输出帽，因此它们的"工具 schema"杠杆从未被干净分离。这里 schema 是逐字真实的，输出帽是独立的 `--max-tokens` 参数。

凭证按 harness 自身的优先级解析：先环境变量，再 `$DSH_HOME/.credentials.yaml`。

**协议必须显式指定**（`--protocol` 或 `PROBE_PROTOCOL`），只支持两种方言：`openai`（`/chat/completions` + DeepSeek 思考字段）与 `anthropic`（`/v1/messages` + `input_schema` + `thinking.budget_tokens`）。本 fork 的 model-hub 按**模型**选协议（`dsh-x-model-hub.models.<id>.api`），用 harness 不会用的协议重放会改变被测对象本身的线上形状。两者之外直接报错而不是近似——一个悄悄说错协议的探针比不能跑的探针更糟。

## 受控 2×2 结果（2026-08-18，本地网关 `x-models`）

任务固定为某真实会话的首条中文提示（278 字符）；锚定臂取自 `anchored-standard` 会话的 header#0（2 工具 / 46 字符 system），wide 臂取自 `standard` 会话的 header#0（25 工具 / 6200 字符 system）。三个模型 × 两个协议 × 4 单元，每单元 n=3，共 **72 次请求，零失败**。

表内为 **we-only%**（同单元 letMe% 基本是其补数）：

| 模型 / 协议 | A `Min+2` | B `Min+25` | C `wide+2` | D `wide+25` |
|---|---|---|---|---|
| Flash-0731 / openai | **100** | **100** | 0 | 0 |
| Flash-0731 / anthropic | **100** | **100** | 0 | 0 |
| Pro-0813 / openai | **100** | 0 | 0 | 0 |
| Pro-0813 / anthropic | 33 | 0 | 0 | 0 |
| Pro / openai | 33 | 0 | 0 | 0 |
| Pro / anthropic | 67 | 0 | 0 | 0 |

三条结论：

1. **persona 是主导杠杆，三个模型、两个协议全部一致。** A→C 与 B→D 共 **12 组对照**，每一组换掉 Minimal 那一句都把轨迹翻过去，无一例外。
2. **工具面在 Flash-0731 上完全不是杠杆。** 单元 B——Minimal persona 加**完整 25 工具目录**——两个协议下都保持 100% 锚定。模型确实看见并使用了宽目录（请求了 `pwsh` / `glob` / `grep` / `todo_write`），不是目录没生效。
3. **工具面在两个 Pro 条目上都是杠杆。** A→B 一律掉到 0%，即 persona 与目录必须同时收窄。
4. **两个 Pro 条目连最优格都锚不稳。** A 单元只有 33–67%，而 Flash-0731 是铁板 100%。预设是照着 Pro 级模型设计的，实测反过来：Flash 确定性锚定，Pro 抛硬币。

**这与本预设的血统相反。** `dsh-anchored-standard` / `dsh-minimal-anchored` 把首轮工具 schema 当作关键杠杆、persona 当作次要条件（其 5/5 对 8/8 的对照表）。本机数据反过来：persona 主导，schema 只在 Pro 上有效。反倒与 `dsh-router-standard` 的说法一致——"Persona is the dominant trigger…tool-schema surface is a secondary condition"。

推理量同向变化：A 单元最短（1476–2369 字符），D 最长（6657–21583），与"想一段做一段"对"一条长链"的形态差异一致。

限定条件，逐条：n=3，单元内仍有方差（33% 即 3 次中 1 次）；单一任务、单一语言；指纹不等于能力；wide 臂的 system 取自另一个项目的会话（是真实 standard system，但不是本仓库的）。

**注意 `deepseek-v4-pro` 与 `deepseek-v4-pro-0813` 是 model-hub 里两个不同的目录条目**（显示名还互相交叉），两个都测了，行为一致但不完全相同——引用结论时要写清是哪一个。

原始结果落在 `results/`，**入版本库**：它们是本目录全部结论的原始凭据，单个约 5 KB，不含密钥、提示词原文或推理原文。删掉它们等于把结论降级成传闻。

## 三条杠杆的分离（单元 E/F，两个协议）

A–D 只分开了 system 与目录两条杠杆。预设其实有**三条**——第三条是 `context-gate` 抑制的自动注入上下文。单元 E 把 system 与目录都固定在锚定值，只加上从真实 wide 会话取出的注入内容（4 条消息、9569 字符：AGENTS.md 摘要 + 技能目录 + 2 条 plugin）；单元 F 是三样都放开，即**完整的普通 standard 首请求**（D 少了注入，所以 D 本身并不是那个基线）。

| 模型 / 协议 | A（无注入） | **E（+9569 字符注入）** | F（全放开） |
|---|---|---|---|
| Flash-0731 / openai | 100 | **100** | 0 |
| Flash-0731 / anthropic | 100 | **100** | 0 |
| Pro-0813 / openai | 100 | **100** | 0 |
| Pro-0813 / anthropic | 33 | **100** | 0 |
| Pro / openai | 33 | **100** | 0 |
| Pro / anthropic | 67 | **100** | 0 |

**注入不但没打断锚定，还把两个 Pro 条目从"部分锚定"抬成了"完全锚定"。** E 在六格里全部 100%，A 只有三格 100%。只看有活动空间的那三格（A 未满分的），A 是 9 次里锚住 4 次，E 是 9 次里锚住 9 次。

这**与 `context-gate` 的立论直接冲突**。上游的说法是"技能目录在场时 0/9 锚定"，本机数据反过来，而且在四个有空间的模型×协议组合里一次也没往反方向走。

一个必须点明的混杂：E 比 A 多了 9569 字符输入，所以"更多上下文让模型更有据可依"也能解释这个方向，未必是注入内容本身。但无论哪种解释，"抑制注入有助于锚定"都不被支持。

于是三条杠杆的账是这样的：

| 杠杆 | 对应预设机制 | 首请求上的贡献 |
|---|---|---|
| **persona** | `persona` 行（`complete: true`） | **承重，12/12 翻转** |
| 工具目录 | `tool-bootstrap` + `dev-tool-search` | Flash 上为零；两个 Pro 上有效 |
| 上下文注入 | `context-gate` + `instruction-hint` + `skill-search` | **为零，且方向相反**——抑制它反而让 Pro 锚得更差 |

限定：n=3，单任务。注入内容取自另一个项目的会话，长度真实但内容不是本仓库的。

## 长程：锚定会不会漂移

上面全部是**单个请求**的实验。预设控制的确实是首请求，但它**声称**的是首请求条件锚定整个会话——单请求重放无论跑多少单元都测不到这一点。而存下来的会话本身就是长程的，所以漂移可以免费测：`drift.ts` 按位置分桶走一遍推理块。

| 会话 | 预设 / 模型 | 推理块 | 首桶 → 末桶 we-only | letMe |
|---|---|---|---|---|
| a69c76e8 | anchored-standard / Pro | 110 | 64% → 73% **STABLE** | 全程 0%（首桶 9%） |
| 5fe2b4df | 锚定（未记标签）/ Flash | **486** | 63% → 87% **RISE** | **十个桶全部 0%** |
| 146bc746 | code / Pro（wide） | 66 | 0% → 0% | 全程 ~100% |
| 9ff33cf3 | code / Pro（wide） | 36 | 0% → 25% | 100% → 25% |

**锚定不衰减。** 486 个推理块、十个位置桶，`let me` 一次都没出现。两个锚定会话都是持平或走高，没有任何单调下滑。

这对 `session-guide` 是个反证：那一行的前提是"长会话中锚定条件被稀释"，而本机数据里稀释找不到。**但别过度解读**——指纹测的是行文风格，不是目标遵从度；`session-guide` 的三锚（回顾/收敛/反跑题）是另一根轴，这里没测到。

另一处漂移指纹**没**捕捉到：锚定 Pro 会话的推理块中位长度从 253 涨到 2077 字符（70–80% 桶）。代词形态守住了，思考长度却在膨胀。说"没有漂移"不准确，准确说法是"**代词轨迹不漂移，思考长度会**"。

还有一个空白：语料里**没有任何会话触发过压缩**，所以预设的压缩边界重锚设计至今未被验证——相位契约里 `compaction-reanchor` 那一条永远是 `skip`。


## 与 `session-guide` 的关系

`apps/cli/config/agent-presets/anchored-standard/session-guide.mjs` 默认关闭。它的引导文本是从上游数据搬来的起点，不是本机测量结果。开启它之前，先用这里的工具建立基线；开启之后，再跑一次对比。上游数据显示这类锚点对 Flash 有效、对 Pro 反而有害，所以"默认关闭 + 先测量"不是谨慎，是必要条件。


## `tasks/` — 把两条条件跑成脚本

产出级测量要在两个条件下跑同一个任务，条件之外的一切都得一样。`dsh --profile headless "<任务>"` 答完就退出，适合脚本；缺的是选预设的能力，它直接组合 agent，没有 `agentPresets` 那一层。

```sh
node personal/probe/tasks/run-condition.mjs --condition anchored --task "<任务>"
node personal/probe/tasks/run-condition.mjs --condition wide     --task "<任务>"
```

跑完打印会话路径，喂给 `analyze-session.ts` 验。**锚定臂每轮都要验**：`bootstrap-catalog` 不过就说明这一轮的首个请求不是锚定条件，分数作废。

| 文件 | 作用 |
|---|---|
| `run-condition.mjs` | 生成覆盖层、起进程、报出这一轮产生的会话 |
| `anchored.patch.template.yml` | 锚定臂的覆盖层模板，`%REPO%` 由上面那个脚本填 |
| `preset-setup.mjs` | 包住 `agents.create`，在 `setup` 里挂预设。**这是唯一能赶在首个请求前面的时机** |
| `mount-preset.mjs` | 走不通的做法，留作记录 |

wide 臂就是原样的 headless，不需要覆盖层：它本来就带完整目录、`agent-instructions` 和 `tool-skill`。

三条路径规则是踩出来的，写在模板头部：`--patch` 里的相对插件名按 **profile 目录**解析而不是按 patch 文件所在目录；`!!js` 只对 config 值求值、不对 `name` 求值；裸的 win32 绝对路径会被当成 `d:` 协议拒掉，要写成 `file://`。

## 归属

`lib/classifier.ts` 的词表与打分权重移植自 [`yjh051108/dsh-router-standard`](https://github.com/yjh051108/dsh-router-standard) 的 `probe/classifier.mjs`（MIT），其本身镜像 [`xiaobright/modeltest`](https://github.com/xiaobright/modeltest) 的 trigger-probe 分类器。**权重刻意保持不变**——相同权重才使这里的数字与那两个项目发布的数字可比。

其余部分为本 fork 自写：相位契约、会话日志读取（复用 harness 自身的 zstd 帧扫描）、按观测条件分组、以及从真实 header 提取 schema 的重放设计。详见 [`NOTICE`](./NOTICE)。
