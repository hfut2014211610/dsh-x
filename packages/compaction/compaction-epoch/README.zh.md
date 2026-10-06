# @deepseek-ai/dsh-compaction-epoch

[English](README.md) | 中文

## Summary

`compaction-epoch` 只负责 Session 的一个事实：它在当前压缩轮次里是否已经离开 bootstrap 阶段。压缩会重写模型可见的表面——对话塌缩成一条摘要、工作区指令基线重新注入——所以压缩后的第一次请求就是「第二次第一次请求」。因此这个状态是轮次感知的：每个 `compaction/end` 都会再次降级。

该状态是 session projection，而不是进程内的临时记账，所以被恢复的会话会从自己的持久日志折算出同一阶段，而不是重新走一遍 bootstrap 阶段。

本包只提供折算与读取。依赖它做门控的插件行——context gate、tool bootstrap、instruction hint 和 session guide——各自应用自己的提升信号，因此四者共用同一份折算。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Registering the unit](#registering-the-unit)
  - [Reading the phase](#reading-the-phase)
- [Understand the implementation](#understand-the-implementation)
  - [Why a projection](#why-a-projection)
  - [Why one unit serves four plugins](#why-one-unit-serves-four-plugins)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [Indirect effect on the first request](#indirect-effect-on-the-first-request)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Promotion signals are fixed to two event types](#promotion-signals-are-fixed-to-two-event-types)
  - [No published invariant](#no-published-invariant)

## Use this package

### Registering the unit

每个消费行调用一次 `registerPromotionEpoch`，传入 `ctx.get('sessionProjections')`。注册表会对该 key 引用计数，所以独立挂载和卸载的行是安全的。

```ts
import { registerPromotionEpoch } from '@deepseek-ai/dsh-compaction-epoch'

const projections = ctx.get('sessionProjections')
if (projections === undefined) throw new Error('session projection registry is required')
const dispose = registerPromotionEpoch(projections)
ctx.effect(() => dispose)
```

通过 `ctx.get` 传入服务而不是把它写进 `inject`，可以让该行早于注册表挂载，并保留门控插件依赖的行顺序。

### Reading the phase

`promotionStatus` 接受读取阶段所针对的 agent、提升模式，以及 subagent 是否遵循同一阶段。

```ts
const status = promotionStatus(projections, agent, 'either', false)
if (status.promoted) return decision
```

`status.boundary` 携带开启当前轮次的 `compaction/end` 序列号，在会话首次压缩之前为 `null`。需要把「压缩过的会话」与「全新会话」区别对待的消费方读它。

subagent（`delegationDepth > 0`）默认读作已提升，除非传入 `includeSubagents`，这样它的第一次请求仍保留完整目录与工具集。

## Understand the implementation

### Why a projection

状态由持久事件重建，而不是放在进程内的 map 里，所以被恢复或重新加载的会话不会重新走 bootstrap 阶段。历史读取与恢复由注册表负责；本包只贡献 `init`、`apply` 和状态 schema。

折算按日志顺序进行，所以排在 `compaction/end` 之后的提升信号只要重置标记即可，不需要比较序列号：在该边界到达时，排在前面的信号已经被清掉了。

### Why one unit serves four plugins

四个消费行各自选择提升模式，但模式只是在 `tool/call` 与 `assistant/message` 之间做选择。折算同时记录两个标记，就让每个模式只是一次读取而不是第二份 projection，也让整个会话只有一份权威轮次状态。

## Further Exploration

- session projection 的 Service Definition：`packages/session/session-projection/src/index.ts`
- 同步读取 Session 历史被废弃以及由此要求的 projection 路线：`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`
- 一个自己折算 projection 的插件：`packages/context/tmux-context/src/index.ts`

## Model Experience

### Indirect effect on the first request

本包不产生任何模型可见内容。它的作用是让周围的消费行能把每个压缩轮次里的第一次请求保持为不含自动注入上下文的状态，这是这些插件所发送内容的改变，而不是本包发送的任何内容。

### Token effect

直接为无。被门控的第一次请求到达模型时不带自动注入的运行时上下文，也没有追加的 step 消息，因此该次请求的提示词更短。

### KV Cache effect

直接为无。被门控的第一次请求所呈现的前缀与第二次请求不同，所以它的前缀缓存是冷的。会话一旦提升，后续请求保持稳定前缀。

## Known Limitations and Deferred Work

### Promotion signals are fixed to two event types

只记录 `tool/call` 与 `assistant/message` 两种信号。需要第三种信号的消费方要扩展 `PromotionEpoch` 及其 `apply`，这对该持久单元是一次 `stateVersion` 变更。

### No published invariant

本包折算一个单元、导出两个函数。不存在能与它产生分歧的第二份观测，因此不发布 `./invariant` 源码；该 key 的交叉校验由 projection 注册表负责。
