# @deepseek-ai/dsh-host-plugin-control

[English](README.md) | 中文

插件面的写入一半。`PluginControlGateway` 注册 `pluginControl` 服务，并发布一个由 Typert 生成的直接 Remote：`pluginControl/setEnabled`，用于启用或停用一个**已配置**的 Loader 条目。[`plugin-inventory`](../plugin-inventory/README.md) 负责读这棵树，本包负责改它。

一次 `ctx.loader.update` 就是全部操作。Loader 同时持有运行中的树和它读自的 profile，所以这一次调用既启停 fiber 又把改动写回去——这正是它能在重启后依然生效的原因。本包若在此之外自己再存一份状态，那就是第二个需要同步的真相。树上已不存在的条目返回 `found: false` 而不是抛错：调用方依据的是片刻之前读到的快照，期间条目被移除属于普通竞态。

与清单包分开有两层理由。读树和改树是两种不同的权限，因此部署可以只挂投影而不挂变更面。另外本 fork 把对上游文件的改动压到「只有那里能放」的程度，而新包正好能放。

该服务仅供 Remote 使用，不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的控制面不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **只作用于已配置条目** —— 服务只启用或停用 profile 中已经声明的东西，既不能为 profile 从未提及的插件新增条目，也不能移除条目。
- **不做解析检查** —— 启用一个模块无法导入的条目会报告成功，因为 Loader 接受了这次配置变更，导入失败随后体现为该条目自己的 Fiber 阶段。
