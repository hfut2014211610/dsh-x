# @deepseek-ai/dsh-agent-instruction-hint

[English](README.md) | 中文

## Summary

`instruction-hint` 把 `@deepseek-ai/dsh-agent-instructions` 注入的完整 AGENTS.md/CLAUDE.md 摘要，换成一条一次性的提示，只说明哪些指令文件存在。

模型因此知道这些文件在，动手前会去读它们，而它们的内容不必进入每个请求。任务需要时，模型自己通过文件系统工具去读。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Subagents](#subagents)
- [Understand the implementation](#understand-the-implementation)
  - [Which files it names](#which-files-it-names)
  - [Once per session](#once-per-session)
  - [Failure behavior](#failure-behavior)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The hint](#the-hint)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [The project root is not the working directory](#the-project-root-is-not-the-working-directory)
  - [A failed probe costs the hint](#a-failed-probe-costs-the-hint)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

把这一行加在 `context-gate` 和 `tool-bootstrap` 之后。该插件把自己的 `agent/pre-step` 监听器 prepend，所以它在 gate 的最外层剥离之内运行——但它只在提升之后才发出，而那时剥离并不生效。

```yaml
- id: instruction-hint
  name: '@deepseek-ai/dsh-agent-instruction-hint'
```

组合必须挂载 session projection 注册表；缺少它时插件会显式失败。

### Configuration

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `promoteOn` | `either` | 在注入提示之前，哪个持久信号提升这个会话。 |
| `includeSubagents` | `false` | subagent 是否要等待自己的提升信号。 |

未知键在该行挂载时报错。

### Subagents

subagent（`delegationDepth > 0`）读作已提升，所以第一次请求就收到它的提示。设 `includeSubagents: true` 让它等待自己的首次回复或工具调用，这也会让提示不落在 context gate 被剥离的首次请求里。请让这个开关与两个配套行相等。

## Understand the implementation

### Which files it names

项目链从会话的工作目录向上走到第一个含 `.git`、`.hg` 或 `.svn` 的祖先；该目录会被探测 `AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md` 和 `CLAUDE.local.md`。`$DSH_HOME/AGENTS.md` 作为用户全局文件单独探测。

这个上溯复用 harness 自己的家目录解析，而不是自己去读 `DSH_HOME` 和 `USERPROFILE`。

探测走一个两问的接缝——这个路径存在吗、是不是常规文件——由宿主 `fs` 服务适配而来。测试直接提供该接缝，因此任何测试都不需要整个文件系统服务。

### Once per session

一个 session projection 记录提示已进入持久日志，所以进程重启不会注入第二份。进程内的 claim 集合另外阻止同一轮里两个并发 step 都去探测。

提示带自己的 `instruction-hint` source kind。更早的 fork 版本把它记在已发布的 `plugin` kind 下，而 0.2.0 已移除该 kind；折算时仍认得那种写法，因为已发布格式的迁移会拒绝它不认识的 kind，而不可读的日志比一个展示标签更糟。

### Failure behavior

缺少文件系统接缝、探测不可读、step 被中止，都退化为不给提示。claim 在探测之前取得，因此随后失败的探测会让这个会话一生都没有提示，而不是冒着两条提示的风险。其他任何失败都跳过提示并告警一次。下游监听器的错误原样传播。

## Further Exploration

- 本插件等待的提升阶段：`packages/compaction/compaction-epoch`
- 剥离首次请求的注入门控：`packages/guard/context-gate`
- 本插件所替代的完整注入：`packages/context/agent-instructions`
- waterfall 语义：`docs/cordis-primer.md`

## Model Experience

### The hint

在会话的第一个持久提升信号之后，模型收到一条简短的用户消息，列出找到的指令文件及其项目根目录，随后是一条指示：先读相关文件，不要假设它们的内容。其中不包含任何文件内容。没有指令文件的会话什么也收不到。

### Token effect

这条提示每个会话只出现一次、几十个 token，而它替代的完整摘要在工作区基线存续期间会重复出现在每个请求里。

### KV Cache effect

提示是前置到 step 的消息里，而不是追加到提示词前缀，因此不会让缓存前缀失效。它只出现一次；其后的消息不受影响。

## Known Limitations and Deferred Work

### The project root is not the working directory

提示给出的是项目根目录，不是会话的工作目录。因此指令文件比根标记更靠近 cwd 的嵌套工作区，是从根来描述的。

### A failed probe costs the hint

claim 先于探测取得，因此首个探测被拒绝的文件系统会让该会话终身没有提示。这个取舍避免了同一轮里两个并发 step 发出重复提示；替代方案是本插件在正常运行下并不需要的每会话定时器或锁。

### No published invariant

该插件拥有一个 projection 标志和一套没有持久对应物的进程内 claim。不存在能与该标志产生分歧的第二份观测，因此不发布 `./invariant` 源码；该单元的交叉校验由 projection 注册表负责。
