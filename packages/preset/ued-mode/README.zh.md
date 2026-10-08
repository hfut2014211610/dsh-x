# @deepseek-ai/dsh-ued-mode

[English](README.md) | 中文

## Summary

`ued-mode` 向系统提示词贡献 UED 模式的策略段：迭代式 UI 设计工作的并发模型，以及并发带来的两个任何工具自身契约都覆盖不到的危险。

设计工作以许多条小修订指令的形式到来，而不是一次生成请求，因此本预设的价值在于每条修订都在自己的可续接子会话中运行，同时父会话始终可应答。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
- [Understand the implementation](#understand-the-implementation)
  - [The two hazards](#the-two-hazards)
  - [Why this is policy](#why-this-is-policy)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The policy section](#the-policy-section)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [The policy is advisory](#the-policy-is-advisory)
  - [The tool names must match the composition](#the-tool-names-must-match-the-composition)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

该段插入在 order 90：位于部署 persona 之后、工具指引之前，因此它框定的是工作方式而不是可用工具。在 UED 组合里与 persona 行一起挂载。

```yaml
- id: ued-mode
  name: '@deepseek-ai/dsh-ued-mode'
  config:
    delegationTool: subagent
    maxActiveThreads: 4
```

### Configuration

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `delegationTool` | 必填 | 本预设的 subagent 工具实例的面向模型名称。 |
| `maxActiveThreads` | 必填，至少 1 | 可同时运行的设计线程数。 |

两个字段都必填，空的工具名在挂载时报错。未知键同样在挂载时报错：`delegationTool` 里的拼写错误否则会以「让模型去调用一个找不到的工具」的形式进入提示词。

## Understand the implementation

### The two hazards

**丢失写入。** `documents` 按版本守护写入，因此失败的编辑会以 `DOCUMENT_STALE_VERSION` 报错而不是覆盖。补救方式是重新读取并在当前内容之上重新应用；把失败前读到的内容写回去，恰恰是这个守护要防止的丢失更新。

**意图冲突。** 守护对「两个线程都被要求重做同一个按钮」只字未提。两者都会成功，后写的会静默替换先写的。运行时没有任何机制能检测到这一点，因此策略在它发生之前把模型交还给用户。

### Why this is policy

两个危险都不是工具缺陷，所以任何工具契约都无法表达对应的修法。这就是它是一段提示词而不是一个包装层的原因：模型被告知恢复流程、优先级偏好，以及唯一必须问人的情况。

该段还固定了产物规则——每个屏幕一个自包含 HTML 文件、只通过文档工具编辑——以及结算规则：线程在你这一轮结束后仍在工作，因此在它的通知到达之前不得读取其产物来查看进度。

## Further Exploration

- 本段贡献给的提示词注册表：`packages/core/system-prompt`
- 策略所点名的 subagent 工具：`packages/subagent/tool-subagent`
- 带版本守护的文档工具：`packages/writing/tool-documents`
- 设计说明：`personal/docs/notes/proposed/2026-08-18-ued-mode.md`

## Model Experience

### The policy section

模型读到产物规则、带本部署自己工具名与线程上限的并发模型、结算规则，以及一个以「在两个线程改动同一视觉元素之前停下来问用户」收尾的三步冲突流程。

### Token effect

该段约五百词，位于 UED 会话每个请求的系统提示词里。它正是并发模型能产出连贯多线程产物、而不是互相覆盖的原因，因此是每个请求都付一次，而非只付一次。

### KV Cache effect

对一个部署而言文本是固定的——只有工具名和上限会变——因此它属于稳定前缀的一部分，首次之后不再有成本。改动任一值都会改变前缀一次。

## Known Limitations and Deferred Work

### The policy is advisory

冲突流程没有任何强制机制。忽略「停下来问用户」的模型依然会产出被静默覆盖的原型；该段只是让正确动作成为模型读到的那个。

### The tool names must match the composition

`delegationTool` 只校验存在与是否为空，不与已挂载的工具核对：没有任何机制验证同一组合里存在该名称的工具。指向组合未挂载实例的那一行，会得到一段告诉模型去调用它看不见的策略。

### No published invariant

该插件注册一个提示词段且不持有状态。不存在能与该注册产生分歧的第二份观测，因此不发布 `./invariant` 源码；它接受的每一段的释放都由提示词注册表负责。