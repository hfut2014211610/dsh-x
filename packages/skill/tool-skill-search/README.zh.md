# @deepseek-ai/dsh-tool-skill-search

[English](README.md) | 中文

## Summary

`tool-skill-search` 把 `@deepseek-ai/dsh-tool-skill` 注入提示词的技能目录，换成两个小工具：用于查找技能的 `skill_search`，用于启用技能的 `skill_load`。

技能多时该目录约 9KB，而且它的存在会扰动轨迹：上游复现实验测得，目录在场时 0/9 会话锚定，而没有目录时约 81%。本包彻底移除了这次注入。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Arguments](#arguments)
  - [Visibility](#visibility)
- [Understand the implementation](#understand-the-implementation)
  - [Search](#search)
  - [Load](#load)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [Discovery instead of a catalog](#discovery-instead-of-a-catalog)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [This row replaces the tool-skill row](#this-row-replaces-the-tool-skill-row)
  - [Search is substring matching](#search-is-substring-matching)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

这是提升后常驻的三个发现工具中的两个，所以它们要和让它们保持常驻的 tool bootstrap 在一起。

```yaml
- id: tool-skill-search
  name: '@deepseek-ai/dsh-tool-skill-search'
```

**不要再挂载 `dsh-tool-skill`。** 两者是替代关系：同时挂载会让目录注入回来，整件事的意义就没了。

agent、tools、skills 三个服务必须都存在。插件把它们声明为注入，所以组合里没有 skills 注册表时这一行不会挂载，而不是半工作状态。

### Arguments

| 工具 | 参数 | 类型 | 作用 |
| --- | --- | --- | --- |
| `skill_search` | `query` | string，必填 | 搜索关键词。每个 token 都必须出现在技能的名、描述或 when-to-use 文本里。空查询列出所有可见技能。 |
| `skill_load` | `name` | string，必填 | 来自 `skill_search` 结果的精确 kebab-case 技能名。 |

参数是模型产出的 JSON，因此非字符串值读作空：search 于是匹配所有可见技能，load 于是报告没有这个技能。

### Visibility

只有 invocation 为 model-invocable 的技能才会到达模型，这与 `dsh-tool-skill` 当初的规则相同。仅供用户使用的技能不会出现在 `skill_search` 结果里，`skill_load` 也会拒绝并说明原因。

发现过程按调用 agent 的作用域读取注册表，因此贡献到另一个 agent 作用域的技能在这里不可见。

## Understand the implementation

### Search

查询被转小写并按非字母数字字符切分；当每个 token 都出现在该技能分词后的名、描述与 when-to-use 文本的合并结果里时即算匹配。最多列出 20 个技能，每个给出名字和描述首行；匹配更多时会报告被省略的数量。

### Load

`skill_load` 通过注册表解析精确名，检查 model-invocation 规则，然后把渲染后的技能正文以共享的 `skill-invocation` source 排入 agent 的非唤醒 next-step inbox——与 `dsh-tool-skill` 产生的注入完全一致。正文由 harness 自己的 `renderSkillContent` 渲染，因此无论哪条路径加载，模型看到的都是同一个标准 `<skill_content>` 形状。

两个工具都把不可用的注册表报告为一行文本，而不是让调用失败。

## Further Exploration

- 本包替代的目录注入：`packages/skill/tool-skill`
- 这两个工具所属的常驻集合：`packages/tool/tool-bootstrap`
- 技能注册表与 provider：`packages/skill/skill`

## Model Experience

### Discovery instead of a catalog

模型被明确告知提示词里没有目录，并在任务看起来匹配某个技能时被要求优先调用 `skill_search`。它收到至多 20 个名字加一行描述，然后用精确名调用 `skill_load`；该技能的指令在下一个请求到达。

### Token effect

节省下来的是整个目录：技能多时约 9KB，此前在每一轮的首个 step 以及每次提升和压缩之后都会重复。本包把这笔开销换成两条简短的工具描述，加上模型主动索取的正文。

### KV Cache effect

移除目录改变了提示词前缀，而这正是目的：锚定的首次请求和提升后的请求都从一个稳定而短的前缀开始。加载技能会把它的正文加入下一个请求的消息，因此那次请求的前缀恰好增长模型所索取的那一个技能。

## Known Limitations and Deferred Work

### This row replaces the tool-skill row

本包无法保证同一组合里没有 `dsh-tool-skill`。同时挂载会让目录注入回来、这一行声称的收益消失，而运行时不会有任何提示。

### Search is substring matching

token 是作为整个分词文本的子串匹配的，所以英文单词会匹配到更长的词内部，而另一种文字的查询什么都匹配不到。没有词干还原、没有模糊匹配，排序也只是注册顺序。

### No published invariant

该插件注册两个工具且不持有状态。不存在能与这两次注册产生分歧的第二份观测，因此不发布 `./invariant` 源码；它接受的每一次注册的释放都由 tools 注册表负责。