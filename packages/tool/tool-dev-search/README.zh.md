# @deepseek-ai/dsh-tool-dev-search

[English](README.md) | 中文

## Summary

`tool-dev-search` 注册一个面向模型的工具 `dev_tool_search`：它按关键词搜索完整的已组装目录并返回匹配的���具名，也能按精确名解锁工具。

它存在的原因是：anchored 预设的提升阶段只保留一个最小的常驻集合，而不是一次性倾倒整个 Standard 目录。这个工具就是模型触达其余一切的方式。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Arguments](#arguments)
- [Understand the implementation](#understand-the-implementation)
  - [What the model sees first](#what-the-model-sees-first)
  - [Search](#search)
  - [Unlock](#unlock)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The discovery round trip](#the-discovery-round-trip)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Unlock takes effect on the next request](#unlock-takes-effect-on-the-next-request)
  - [Search sees one scope](#search-sees-one-scope)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

这是提升后常驻的三个发现工具之一，所以它要和让它保持常驻的 tool bootstrap 在同一个组合里。

```yaml
- id: tool-dev-search
  name: '@deepseek-ai/dsh-tool-dev-search'
```

该工具注册前 tools 注册表必须存在；插件把它声明为注入，所以在没有注册表的情况下挂载会让这一行保持惰性而不是失败。

### Arguments

| 参数 | 类型 | 作用 |
| --- | --- | --- |
| `query` | string | 搜索关键词。每个 token 都必须出现在某个工具的名或描述里。 |
| `toolNames` | string 数组 | 要解锁的精确工具名。 |

两者都可选。两者都缺省时返回用法提示。只有 `toolNames` 时确认解锁并跳过搜索。参数是模型产出的 JSON，因此非字符串的 `query` 和非数组的 `toolNames` 贡献为空，而不是让调用失败。

## Understand the implementation

### What the model sees first

工具描述是一份**索引**而不是目录：它列出最小常驻集合覆盖不了的能力领域——联网搜索、委派、工作流、迭代循环、目标、图片、后台作业、多智能体控制、任务跟踪、询问用户——并告诉模型优先调用这个工具，而不是用 bash 绕过去。

这样模型无需完整目录倾倒就知道有什么存在。

### Search

搜索把查询转小写、按非字母数字字符切分，保留名字加描述包含全部 token 的 schema。最多返回 25 条匹配；被截断时会说明并建议缩小范围。

执行中的 agent **就是**视图作用域。预设工具注册进注册表的 agent-scope 层，无作用域的读取只看得到全局层——每个预设提供的工具都会不可见。每条匹配贡献它的名字，以及其描述首行的前 90 个字符。

抛出异常的搜索会报告一行说明失败原因，而不是让调用失败。

### Unlock

解锁不是对注册表的改动。它被记录为这次调用自身的持久 `tool/call` 参数，配套的 tool-bootstrap 过滤器从日志里折算出这些名字——这让解锁具备恢复安全性：重新加载的会话仍然拥有它们。

## Further Exploration

- 消费解锁结果的目录过滤器：`packages/tool/tool-bootstrap`
- 本工具所属的常驻集合：`packages/guard/context-gate`
- 工具注册与执行：`packages/core/tools`

## Model Experience

### The discovery round trip

模型用关键词调用 `dev_tool_search`，收到至多 25 条匹配工具名加一行描述，再用它想要的精确名调用一次。从下一次请求起，这些工具在整个会话的目录里出现。

### Token effect

索引写在工具描述里，因此每个请求都要付这份成本。一次搜索至多返回 25 条一行匹配，这为往返成本设了上界；没有索引的话模型只能猜测某个能力是否存在。

### KV Cache effect

该工具在整个会话里常驻，所以它的 schema 从第二次请求起就在缓存前缀里，随着更多工具被解锁也不会让前缀失效。解锁本身会改变工具列表，因此确实会开启一个新前缀——每次解锁调用一次。

## Known Limitations and Deferred Work

### Unlock takes effect on the next request

执行解锁的那次调用仍然使用请求开始时的目录。部署只能为后续请求拓宽目录。

### Search sees one scope

搜索读取执行 agent 的作用域，因此注册在该作用域之外的工具对它不可见。对预设工具而言这是正确的分层，也意味着全局挂载的工具可被搜索到，而挂载进另一个 agent 作用域的工具则不能。

### No published invariant

该插件注册一个工具且不持有状态。不存在能与该注册产生分歧的第二份观测，因此不发布 `./invariant` 源码；它接受的每一次注册的释放都由 tools 注册表负责。