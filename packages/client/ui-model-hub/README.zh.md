---
description: "模型中心设置页：通过宿主 modelHub Remote 编辑供应商与模型、预览编译路由、探活位置并选择默认模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-hub

[English](README.md) | 中文

Model Hub 的浏览器设置插件。随 Web bundle 注册为“设置 → 模型中心”，与“模型”“Agent 预设”“用量”并列。页面调用宿主包的 `modelHub/*` Remote 并监听设置失效通知，不导入宿主实现代码。

## 概述

本包是浏览器里的模型中心设置页。通过宿主包的 `modelHub/*` Remote 分别编辑供应商与模型，预览编译路由与降级链，探活模型位置，导入适合的 pi-ai 路由，并为未来会话设置默认模型。Node 入口无行为；client bundle 通过 slot 注入注册设置分区。适合需要界面化管理模型路由的部署。本包不增加任何模型请求内容。

## 目录

- [页面行为](#page-behavior)
- [运行时注册](#runtime-registration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="page-behavior"></a>
## 页面行为

页面分别编辑供应商与模型。供应商表单覆盖厂商预设、显示名称、基础与 Anthropic 专用 endpoint、凭据引用和只写的 API Key 保存。模型表单覆盖 catalog 派生预设、供应商位置、协议、容量、模态、推理档位和有序降级位置。列表会预览编译路由与降级链，显示凭据及协调状态，探测模型位置，导入适合的既有 pi-ai 路由，并可为未来会话设置默认模型。

宿主文档为空时，页面显示两组可编辑的空列表。设置部署只读时，页面保持可见但禁用修改。RPC 或校验失败会留在页面中显示；凭据保存后绝不会返回浏览器。

<a id="runtime-registration"></a>
## 运行时注册

Node 入口是无行为的 Loader 标记。`./client` bundle 通过 `ctx.slots.inject` 注册 `settings.section` 条目 `model-hub`，因此能适应独立的激活顺序，并随插件 fiber 一起移除。Web bundle 同时声明本包与 `@deepseek-ai/dsh-model-hub`，无需安装 profile 本地插件。

<a id="model-experience"></a>
## 模型体验

无，因为本页只改宿主已有的设置；它不注册工具、提示段或结果投影。

#### KV Cache 影响

无；本包不组装也不发送供应商请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **高级供应商字段仍由 YAML 管理**：宿主修改会保留 header 和兼容性标志，但本页尚不能编辑这些字段。
- **尚未提供模型发现入口**：页面提供 catalog 预设和模型探活，但还没有调用适配器的模型列表发现操作。
- **宿主编写类型仍在本地镜像**：在 Remote 生成器提供浏览器安全的声明入口前，必须让 `src/client/types.ts` 与 `@deepseek-ai/dsh-model-hub` 同步变化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

宿主编写类型在 `src/client/types.ts` 里镜像；在 Remote 生成器提供浏览器安全的声明入口前，保持它与 `@deepseek-ai/dsh-model-hub` 同步。

</details>
