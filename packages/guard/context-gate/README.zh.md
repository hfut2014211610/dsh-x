# @deepseek-ai/dsh-context-gate

[English](README.md) | 中文

## Summary

`context-gate` 让会话在每个压缩轮次里的第一次模型请求不含自动注入的上下文。它的做法是拦截 harness 的两条统一注入路径，而不是逐个拒绝已知来源，因此也能覆盖尚不存在的来源。

把它作为组合里的**第一行**挂载。waterfall 变换按注册顺序的逆序生效，所以先注册就让它成为最外层变换，之后挂载的任何东西都无法绕过它重新注入。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Understand the implementation](#understand-the-implementation)
  - [Two interception paths](#two-interception-paths)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [First request of an epoch](#first-request-of-an-epoch)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Skill invocations survive by default](#skill-invocations-survive-by-default)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

把这一行加在组合的第一位。该插件不声明任何服务注入，因此它的 apply 早于注入上下文的插件，而它的 pre-step 监听器 prepend 到 waterfall 前面。

```yaml
- id: context-gate
  name: '@deepseek-ai/dsh-context-gate'
```

组合必须挂载 session projection 注册表；缺少它时插件会显式失败，因为没有它就无从门控。

### Configuration

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `promoteOn` | `either` | 哪个持久信号打开门控：`tool-call`、`assistant-message` 或 `either`。 |
| `includeSubagents` | `false` | subagent 是否也走门控，而不是一上来就拿到完整注入。 |
| `enabled` | `true` | 两条拦截路径是否运行。`false` 在不改动行集合的前提下关闭门控。 |
| `allowKinds` | `['skill-invocation']` | 在声称批次之外允许通过的消息 `source.kind` 名。显式空数组表示只保留声称批次。 |

未知键在该行挂载时报错。schemastery 会放行未知键，所以插件自己检查它们，避免一个拼写错误静默地关掉本想启用的设置。

### Subagents

subagent（`delegationDepth > 0`）默认读作已提升：它的第一次请求已经能看到完整上下文。设 `includeSubagents: true` 可让它也走门控，这样它的第一次请求是干净的，由它自己的首次回复或工具调用打开门控。请让这个开关与配套的 tool-bootstrap 行保持一致。

## Understand the implementation

### Two interception paths

**运行时上下文**（`system-prompt/assemble`）：未提升时把组装出的 `contexts` 清空。这覆盖了整个 `SystemPrompt.context()` 家族——沙箱与审批策略快照、任何第三方上下文提供者——而不需要逐个枚举。于是 loop 自己的快照 projection 在门控期间不发消息，而在第一次提升后的请求上恰好发出一条全新快照，因为它比对的是一份从未存在过的快照。

**step 消息**（`agent/pre-step`）：payload 的 `messages` 是本 step 从 inbox **声称**的批次，也就是每个注入都会追加的那个基线。未提升时门控只保留该基线加上 kind 白名单，并剥掉所有追加内容，无论其来源。同一性按对象或按 id 判断，因为监听器可能用副本替换被声称的消息。

持久历史（含压缩摘要）不经过这条门控：它通过 session surface 进入请求，而不是通过 pre-step waterfall。

### Failure behavior

两条过滤器在自身失败时都退化为「全部保留」，因为门控的 bug 绝不能吃掉用户的上下文。下游监听器的错误原样传播：只有各自过滤器自身的逻辑被保护。失败只告警一次。

## Further Exploration

- 共享的提升状态：`packages/compaction/compaction-epoch`
- 一个自己折算 projection 的插件：`packages/context/tmux-context/src/index.ts`
- waterfall 语义：`docs/cordis-primer.md`

## Model Experience

### First request of an epoch

被门控的请求到达模型时不带自动注入的运行时上下文，也没有追加的 step 消息。在第一次提升后的请求上，模型收到一条全新的运行时上下文快照，此后每次注入都会到达。

### Token effect

被门控的请求携带更短的提示词。节省量上界是运行时上下文家族与追加 step 消息本会贡献的部分，随部署的策略快照与第三方提供者增长。

### KV Cache effect

被门控的请求所呈现的前缀与随后的请求不同，因此它的前缀缓存是冷的。从第一次提升后的请求开始，前缀重新稳定——这也是门控由持久信号而非固定步数打开的原因。

## Known Limitations and Deferred Work

### Skill invocations survive by default

`skill-invocation` 默认允许通过门控，因为用户主动发起的操作不算自动注入，而按 step 声称会丢失技能内容。设 `allowKinds: []` 可将其一并剥掉。

### No published invariant

该插件注册两个 waterfall 监听器、自身不持有状态；它读取的提升阶段属于共享 projection。两者都不存在能产生分歧的第二份观测，因此不发布 `./invariant` 源码。
