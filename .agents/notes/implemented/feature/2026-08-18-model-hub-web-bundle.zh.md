# Agent Note: Model Hub ships in the Web bundle

Status: implemented

[English](2026-08-18-model-hub-web-bundle.md) | 中文

## 问题

Model Hub 原本是 `personal/plugins` 下两个需要安装到 profile 的包：宿主侧编写与降级逻辑，以及浏览器设置页。这种拓扑依赖绝对本地路径、源码执行和单独构建的客户端 bundle，因此仓库虽然有源码，打包后的桌面安装仍会缺少该功能。

## 决策

Model Hub 由两个发布成员 workspace 包组成：`packages/llm/model-hub` 下的 `@deepseek-ai/dsh-model-hub`，以及 `packages/client/ui-model-hub` 下的 `@deepseek-ai/dsh-client-ui-model-hub`。Web bundle 声明这两个包并默认挂载两条记录；空编写文档保持休眠且安全。

宿主包保留 `dsh-x-model-hub` 设置命名空间和 `modelHub/*` Remote 名称，使已有 DSH-X 设置与客户端协议继续使用原有标识。它通过 `@deepseek-ai/dsh-llm-pi-ai` 的公开 API 编译，pi-ai 包公开厂商预设需要的 catalog 具化函数。客户端包进入普通客户端 aggregate、`dsh.client` manifest、slot 注入、构建、invariant 与发布打包路径。

发布依赖闭包从 `@deepseek-ai/dsh-web-app` 开始；其 package manifest 点名两个 Model Hub 包，因此 profile 修复与桌面打包暂存无需 profile 本地安装或联网获取即可解析它们。

## 验证

包测试覆盖编写 schema 与编译、协调所有权、降级选择、探活、预设、导入计划、浏览器 store、构建后客户端注册和两个 invariant companion。无密钥浏览器场景启动已发布 Web 组合，打开“设置 → 模型中心”，以空文档访问宿主 Remote，并快照记录可编辑的供应商与模型列表。发布验证和 packed runtime 检查覆盖依赖闭包与普通 Node 加载。

## 考虑过的替代方案

**保留安装到 profile 的个人包。** 打包应用不能依赖某位开发者的绝对路径，浏览器模块也仍然需要单独构建产物和手工安装 profile。

**把个人源码复制进桌面资源。** 宿主入口指向 TypeScript 源码，无法由打包后的普通 Node 运行时加载；复制还会绕过 workspace 约束、invariant、文档和发布打包。

**把 Model Hub 合并到既有“模型”设置包。** 既有页面编辑适配器拥有的供应商 profile，而 Model Hub 拥有独立的以模型为中心的编写文档和跨供应商有序降级。把宿主编译器及其浏览器投影保留为独立插件，既能维持这些职责，也允许部署把额外编写平面作为一对插件停用。

## 结果

每个 Web 与桌面安装都会增加一个“模型中心”设置分区和两个发布包。空安装会承担客户端 bundle 与注册成本，但不会创建路由或模型请求。在 Remote 生成器提供浏览器安全的声明入口前，维护者必须保持浏览器编写类型镜像与宿主类型同步。
