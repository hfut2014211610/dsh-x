---
description: "以模型为中心的供应商编写层：声明供应商与模型、编译 pi-ai 路由、有序降级，以及 modelHub Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-hub

[English](README.md) | 中文

基于 `@deepseek-ai/dsh-llm-pi-ai` 的模型中心编写层。`dsh-x-model-hub` 设置命名空间把供应商与模型分开声明，允许每个模型选择自己的协议，把文档编译成普通 pi-ai 路由，并暴露浏览器设置页使用的 `modelHub/*` Typert Remote。命名空间保持不变，因此安装后会继续使用已有的 DSH-X 设置文档。

Web bundle 默认挂载本包。空文档保持休眠：注册设置命名空间和 RPC 网关，但不创建任何供应商路由。每次提交都会先校验，再协调本包拥有的完整路由集合；更新被拒绝时，上一组路由继续服务，并把失败原因提供给设置页。

## 概述

本包让部署按模型而不是按路由编写供应商：`dsh-x-model-hub` 命名空间分开声明供应商与模型，每个模型可选协议，编译成普通 pi-ai 路由记在包所有的 `_routes` 台账下，重试预算用完后按序降级，并为浏览器页提供 `modelHub/*` Remote。无效更新绝不替换正在服务的路由。适合模型需要在供应商、协议或降级之间流转、又不想手写路由的场景。

## 目录

- [配置](#configuration)
- [路由编译与所有权](#route-compilation-and-ownership)
- [有序降级](#ordered-failover)
- [Model Hub Remote](#model-hub-remote)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

```yaml
dsh-x-model-hub:
  providers:
    primary:
      displayName: Primary gateway
      baseURL: https://gateway.example/v1
      endpoints:
        anthropic-messages: https://gateway.example
      apiKeyEnv: PRIMARY_API_KEY
  models:
    example-large:
      provider: primary
      api: openai-completions
      contextWindow: 262144
      maxTokens: 32768
      fallbacks:
        - provider: backup
          api: anthropic-messages
```

供应商拥有 endpoint、凭据、header 与共享能力默认值。模型拥有模型 id、协议、容量、模态、推理档位映射和有序降级位置。API Key 通过凭据服务保存；该设置文档只存凭据引用。

<a id="route-compilation-and-ownership"></a>
## 路由编译与所有权

模型按 `(provider, api)` 分组。只使用一种协议的供应商保留供应商键作为路由 id；使用多种协议时生成 `<provider>~<api>` 路由 id。`endpoints[api]` 可覆盖单个协议的 `baseURL`；当 Anthropic SDK 路由需要根地址、OpenAI 兼容路由需要 `/v1` 前缀时必须使用这一能力。

`_routes` 字段是本包拥有的路由账本。协调过程只创建、更新和删除账本中的路由，不会改动手工编写的 pi-ai 路由。包含 `~` 的路由 id 保留给编译路由。修改模型协议可能因此改变后续请求记录的供应商 id。

<a id="ordered-failover"></a>
## 有序降级

普通 `llm-retry` 策略会先消耗当前路由的重试预算。该策略对符合条件的请求失败继续委派后，本包选择下一个编译位置并返回重试决策。agent loop 通过普通请求头记录供应商变化，因此同一会话的后续步骤会继续使用该降级路由。上下文窗口错误不会触发降级。保持在同一条未修改路由上的请求延续适配器原有的供应商本地 KV 缓存行为。

<a id="model-hub-remote"></a>
## Model Hub Remote

`modelHub/*` Remote 负责读取和修改编写文档、保存凭据、在不覆盖现有条目的前提下导入适合的手工 pi-ai 路由、列出基于 catalog 派生的厂商预设、探测一个模型的每条编译位置，以及修改未来会话使用的默认模型。探活会发起独立的单 token 流式请求，不写入会话事件。

<a id="model-experience"></a>
## 模型体验

无，因为路由编译只配置供应商，不增加自己拥有的提示词、工具或结果文本；模型可见的请求归适配器所有。

#### KV Cache 影响

自身没有；修改编译后的供应商路由或降级可能无法复用供应商本地的 KV Cache。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **浏览器包镜像了供应商与模型类型**：在 Remote 生成器提供客户端安全的类型入口前，编写类型变化必须同步修改 `packages/client/ui-model-hub/src/client/types.ts`。
- **降级只在 agent 请求边界开始**：不会把已经产生的部分流式输出跨供应商拼接。
- **导入刻意只增不改**：仅 catalog 路由、无法解析协议或 endpoint 的路由、供应商 endpoint 冲突和重复模型 id 会被报告并跳过。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

协调只创建、更新和删除台账 `_routes` 里的条目，绝不碰手写的 pi-ai 路由；路由 id 里带 `~` 的保留给编译路由。浏览器包在自己的 `types.ts` 里镜像编写类型，在 Remote 生成器提供客户端安全入口前，两边一起改。

</details>
