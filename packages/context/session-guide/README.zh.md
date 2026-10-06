# @deepseek-ai/dsh-session-guide

[English](README.md) | 中文

## Summary

`session-guide` 在会话被提升之后，紧跟每条真实用户消息追加一行简短引导。

**默认禁用。** 组合用 `disabled: true` 挂载这一行。开启前请读完 [Why it is off](#why-it-is-off)——这一行文本背后的证据比本预设其余部分背后的证据要弱。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Why it is off](#why-it-is-off)
- [Understand the implementation](#understand-the-implementation)
  - [Placement](#placement)
  - [One guidance per user turn](#one-guidance-per-user-turn)
  - [The complex-message dispatch](#the-complex-message-dispatch)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The guidance line](#the-guidance-line)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [The text is a starting point](#the-text-is-a-starting-point)
  - [The complex heuristic is crude](#the-complex-heuristic-is-crude)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

该插件把自己的 `agent/pre-step` 监听器 prepend，因此它在 context gate 与 tool bootstrap 之后注册，运行在它们的变换之内。

```yaml
- id: session-guide
  name: '@deepseek-ai/dsh-session-guide'
  disabled: true
```

组合必须挂载 session projection 注册表；缺少它时插件会显式失败。

### Configuration

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `text` | 三锚点文本 | 引导行。 |
| `complexText` | 缺省 | 用户消息看起来复杂时使用的第二行。缺省时每条消息都用同一行。 |
| `complexPattern` | 缺省 | 标记消息复杂的正则源码。在挂载时编译。 |
| `complexLengthThreshold` | `120` | 超过该字符数即视为复杂。仅在设置 `complexText` 时参考。 |
| `promoteOn` | `either` | 哪个持久信号先提升会话。 |
| `includeSubagents` | `false` | subagent 是否遵循同一阶段。 |
| `enabled` | `true` | `false` 让该行保持挂载但不起作用，便于不改行集合就做 A/B。 |

未知键、空的 `text` 或 `complexText`、无法编译的 `complexPattern`、非正的阈值，都在该行挂载时报错。

### Subagents

subagent（`delegationDepth > 0`）读作已提升，所以从它的第一轮就收到引导。设 `includeSubagents: true` 让它等待自己的提升信号。

## Why it is off

三个理由，按分量排序。

**这个机制在本 fork 未经验证。** 本 fork 没有任何东西测过这一行要抵消的上下文稀释，更没有测过这个补救措施。`personal/probe/` 的存在就是为了先建立那个基线；在测出来之前开启，等于用一个未验证的假设替换另一个。

**上游自己的数据显示这个效果随模型反转。** 回忆与收敛两个锚点提升了 Flash，而同样的锚点让某个 Pro 测试集低于裸配置。默认开启的一行会把有害的那一半悄悄施加到一半的路由上。

**这个想法的已发布实现跑不起来。** 在 `dsh-router-standard` v0.3.0 中，`preset/router-standard/router-bootstrap.mjs` 的 `session/event` 处理器调用了 `bandOf` 和 `extractText` 却两者都没导入，因此处理器在注入任何东西之前就抛错。本机制是照着那份描述写的，不是从那份代码移植的，而它的数字从未被任何人观测过。

所以：用 `personal/probe/compare-presets.ts` 测量，开启这一行，再测一次。

## Understand the implementation

### Placement

引导经 `agent/pre-step` waterfall 进入，紧接在该 step 声称的消息批次之后插入，位置与理由都和 `@deepseek-ai/dsh-agent-instructions` 相同：用户自己的提示在前，驱动方追加的运行时上下文在后。

这正是它是后缀而不是改系统提示词的原因。pre-step 消息是持久的，所以第 N 轮的引导在第 N+1 轮时仍在历史里，共享前缀只会增长。

### One guidance per user turn

没有声称用户消息的 step 是工具续跑：该轮的引导已在历史里，因此插件不注入任何东西。

对声称了用户消息的 step，引导会记录它跟在哪个消息之后。一个 session projection 保存已获引导的消息 id 集合，因此恢复或重载能认出自己已有的引导；一个很小的进程内增量覆盖 loop 的 `session/event` 折算到达该单元之前的空档。

提升之前不注入任何东西，`compaction/end` 边界会让会话降级，所以压缩后的第一次请求同样是干净的。

### The complex-message dispatch

只有配置了 `complexText` 时才参考深度分派。这个启发式故意做得很粗——长度加一个调用方提供的关键词模式。上游提供的是按自己路由调优过的双语关键词表；把那份表嵌进来等于把他们的调优当成一个发现导入，所以模式留给运维决定。

### Failure behavior

任何失败都让该轮不注入任何东西，并告警一次。下游监听器的错误原样传播。

## Further Exploration

- 本插件等待的提升阶段：`packages/compaction/compaction-epoch`
- 提升期间会剥掉引导的门控：`packages/guard/context-gate`
- 它所遵循的放置规则：`packages/context/agent-instructions`
- waterfall 语义：`docs/cordis-primer.md`

## Model Experience

### The guidance line

会话被提升之后，紧跟每条真实用户消息，模型会收到一行：回顾本次会话已经做过什么、不要重复已完成的步骤、不要把推理花在环境检查上、信息齐了就产出。运维标记为复杂的消息会由配置 `complexText` 替换这一行。

### Token effect

这一行大约四十个 token，在整个会话里每个用户轮次付一次。它是后缀，所以不会挤掉缓存前缀里的任何东西；成本是每轮叠加。

### KV Cache effect

无。引导被拼接进 step 的消息，位置在已被缓存的声称批次之后，因此共享前缀不受影响，只增长引导本身。

## Known Limitations and Deferred Work

### The text is a starting point

默认文本复现的是 `dsh-router-standard` 描述的三个锚点，而那份已发布实现跑不起来、其效果还随模型反转。请把它当作待测量的假设，而不是调好的字符串。

### The complex heuristic is crude

这一行只能提供长度加关键词模式。消息可能又短又复杂，也可能又长又简单；插件没有别的信号，也还没有测量说明哪一种错误更要紧。

### No published invariant

该插件拥有一个 projection 单元和一套没有持久对应物的进程内增量。不存在能与它产生分歧的第二份观测，因此不发布 `./invariant` 源码；该单元的交叉校验由 projection 注册表负责。
