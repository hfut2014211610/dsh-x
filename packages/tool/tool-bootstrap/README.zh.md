# @deepseek-ai/dsh-tool-bootstrap

[English](README.md) | 中文

## Summary

`tool-bootstrap` 让会话在每个压缩轮次里的第一次模型请求保持在 Minimal 预设的**真实**工具 schema 上——持久 shell `bash` 加 `str_replace_editor`——然后在会话产生第一个持久提升信号后把目录收窄到最小的常驻集合。

注入上下文**不**归本插件管。配套的 `@deepseek-ai/dsh-context-gate` 插件负责，用的是同一个提升阶段。

把它挂在 context-gate 行的**紧后面**。waterfall 的 after-next 变换按注册顺序逆序生效，所以这一行必须早于任何触碰同一 assembly 的插件注册。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Understand the implementation](#understand-the-implementation)
  - [The three phases](#the-three-phases)
  - [The resident set](#the-resident-set)
  - [The optional output cap](#the-optional-output-cap)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [Tool catalog across a session](#tool-catalog-across-a-session)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [file tools are not resident](#file-tools-are-not-resident)
  - [The unlock set is per session](#the-unlock-set-is-per-session)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

把这一行加在 context-gate 行之后：

```yaml
- id: tool-bootstrap
  name: '@deepseek-ai/dsh-tool-bootstrap'
  config:
    bootstrapTools: [bash, str_replace_editor]
```

该插件不声明服务注入，因此它的 apply 早于填充目录的工具。组合必须挂载 session projection 注册表；缺少它时插件会显式失败，因为没有它就无从判断阶段。

### Configuration

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `bootstrapTools` | 必填 | 每个轮次受控首次请求上暴露的工具名。空列表在挂载时报错。 |
| `promoteOn` | `either` | 哪个持久信号提升：`tool-call`、`assistant-message` 或 `either`。 |
| `bootstrapMaxTokens` | 省略 | 首次请求的输出上限。省略则让适配器默认值流过。 |
| `compactionTools` | 无 | 压缩之后、重新提升之前，加进受控阶段的工具。 |
| `includeSubagents` | `false` | subagent 是否也走受控阶段，而不是一上来就是常驻目录。 |

未知键、空的 `bootstrapTools`、非正的 `bootstrapMaxTokens` 都在该行挂载时报错。

### Subagents

subagent（`delegationDepth > 0`）从常驻集合开始：它的第一次请求已经能看到完整目录。设 `includeSubagents: true` 可让它也走受控阶段。请让这个开关与配套 context-gate 行的开关相等——不一致会让一次委派重新引入不受控的首次请求。

## Understand the implementation

### The three phases

**受控**（任何提升信号之前）：目录恰好是 `bootstrapTools`。

**常驻**（出现提升信号之后）：bootstrap 对 + 三个发现工具 + 模型已解锁的一切。

**压缩后**（`compaction/end` 之后、新的提升信号之前）：bootstrap 对 + `compactionTools`。模型正在任务中途需要继续工作，但仍然面对一个小目录。

### The resident set

提升**不会**一次性倾倒整个 Standard 目录——那样倾倒会把轨迹拉回 standard-like 行为。常驻集合是 bootstrap 对加 `dev_tool_search`、`skill_search`、`skill_load`，再加模型传给 `dev_tool_search` 的每个名字。更重的 Standard 工具只需一次 `dev_tool_search` 调用即可拿到。

已解锁的名字是一个由持久 `tool/call` 事件折算出的 session projection，因此恢复与重载都会保留。`tool/call` 记录的是模型产出的原始 JSON 字符串，所以读不出的参数——JSON 格式错误、不是对象、`toolNames` 不是非空字符串数组——贡献为空，而不是让请求失败。

### The optional output cap

在官方 endpoint 上，首次请求的 `max_tokens` 也主导了轨迹锚定（1024 时如此），而 Minimal 工具 schema 在 256000 且**不加**上限时就能锚定。因此这个上限是可选启用的。设置后该监听器 prepend，使后续监听器无法覆盖首轮预算；提升之后上限被显式撤掉——下一次请求的种子提案会把上一个 header 的 `maxTokens` 继续带下去，所以释放必须显式进行。不是本插件设置的那个预算会被原样保留。

### Failure behavior

受控阶段缺少工具时退化为完整目录并告警一次，因为组合漂移绝不能让一个会话的每次请求都失效。常驻阶段缺少工具时告警并照常过滤。该过滤器其他任何失败都暴露完整目录。下游监听器的错误原样传播。

## Further Exploration

- 共享的提升状态：`packages/compaction/compaction-epoch`
- 配套的注入门控：`packages/guard/context-gate`
- waterfall 语义：`docs/cordis-primer.md`

## Model Experience

### Tool catalog across a session

每个压缩轮次的第一次请求只向模型提供两个工具：一个持久 shell 和一个 str_replace_editor。在第一个提升信号处，目录扩展为那两个加上 `dev_tool_search`、`skill_search`、`skill_load`，以及模型已经解锁的任何工具。压缩之后它收窄回两个，部署配置了 `compactionTools` 时再加上它们。

### Token effect

两个工具的 schema 发送的工具定义少于 Standard 家族的 schema，这就是首次请求所节省的部分。工具 schema 缓存在提示词前缀里，所以这个影响在首次请求以及压缩后的那次请求上最大。

### KV Cache effect

受控阶段的两个工具前缀与常驻阶段的更宽前缀不同，因此收窄或扩展之后的第一次提升请求会开启一个新前缀。`bootstrapMaxTokens` 改变的是请求的输出预算，不是前缀。

## Known Limitations and Deferred Work

### file tools are not resident

`read`、`write`、`edit`、`glob`、`grep`、`todo` 和 `ask` 有意不进入常驻集合：bash 加 str_replace_editor 已覆盖文件工作。更希望它们存在的部署可以把它们列进 `compactionTools` 或显式放进 bootstrap。

### The unlock set is per session

已解锁名字按会话折算，所以新会话又从发现工具开始。折算只读 `tool/call` 事件；模型执行过但从未调用过的解锁不会留下可恢复的痕迹。

### No published invariant

该插件注册一个目录过滤器、一个可选的请求过滤器，以及两个除注册之外并不拥有的 projection 状态。它们都不存在能产生分歧的第二份观测，因此不发布 `./invariant` 源码；这两个单元的交叉校验由 projection 注册表负责。
