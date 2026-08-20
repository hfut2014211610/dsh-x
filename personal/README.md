# personal/ — 个人定制层

本目录是 fork 里的**个人区**：所有个性化代码集中在此，与上游跟踪文件完全隔离。

## 原则

- **fork 的其余部分只跟踪上游**（`git fetch upstream && git merge upstream/master`，永远 fast-forward）。上游不会新增 `personal/` 顶层目录，因此合并零冲突。
- 个性化优先走插件与配置，不打上游补丁。官方扩展点足够覆盖绝大多数需求（见仓库根的 [`docs/architecture.md`](../docs/architecture.md) 的 "Where new behavior goes"）。
  **已知例外一处**：`packages/client/ui-primitives` 的 Markdown 渲染器加了一个默认关闭的 `sourcePositions` 开关，因为预览里直接编辑需要知道点到的块对应源文哪几个字符，而没有任何扩展点能给出这个。取舍与代价见[笔记](docs/notes/implemented/2026-08-20-markdown-source-positions.md)。
- 本目录不进 pnpm workspace、不改根 `package.json` / `pnpm-workspace.yaml` / `AGENTS.md` 等上游文件。插件经仓库根 tsconfig paths 解析 `@deepseek-ai/*` 导入，与源码启动（`pnpm dsh`，tsx）共享模块实例，无需安装步骤。

## 内容

- `plugins/dsh-x-feishu/` — **飞书通道**：单聊发一句就干活，群里 @ 一下就接活，过程落在卡片上。宿主半边加一张连接器设置卡（`packages/client/ui-settings-connectors/`），桥接进程在 `bridge/`。
- 模型中心与每模型采样默认值已经进入正式 workspace：宿主包见 [`packages/llm/model-hub/`](../packages/llm/model-hub/README.zh.md)，采样默认值见 [`packages/llm/model-tuning/`](../packages/llm/model-tuning/README.zh.md)，设置页见 [`packages/client/ui-model-hub/`](../packages/client/ui-model-hub/README.zh.md)，Web bundle 默认注册，无需从本目录安装。
  毕业前的两份旧副本已于 2026-08-20 删除，`headless` profile 也改指毕业后的包。
- `scripts/dump-session.ts` — 会话日志查看工具（`.jsonl.zstd` 分帧解压，可按事件类型过滤）。
- `probe/` — 锚定条件的本地测量工装：`anchored-standard` 的轨迹收益在这里从"继承来的证据"变成本机数字，结果落在 `probe/results/`。
- `docs/guides/plugin-guide.md` — **插件开发指南**：两类插件的创建/注册/页面新增全流程、schemastery 与加载机制的坑、调试工具箱。写新插件前必读。
- `docs/archive/postmortem-2026-08-15-model-hub-probe.md` — **探活连环报错复盘**：compat 透传致编译整段被拒、Anthropic SDK 双 /v1、网关流式崩溃分类学，及"curl 对照/抓包/最小复现/文档-注册表比对"调试方法论与探活结果速查表。
- `model-config.example.yaml` — `settings.yaml` 片段模板：官方段（协议/上下文/思考）、hub 段（供应商+模型分离）、tuning 段（采样默认值）。

## 加载方式

`dsh-x-model-tuning` 仍以 file:// 绝对路径挂载，零构建，改完重启即生效。模型中心属于正式 Web 组合，由 workspace 构建和发布流程负责。

## 环境

需要 Node `^22.19 || >=24`（仓库 engines；22.14 在这台机器上还有 `lstatSync` dev 恒为 0 的 bug，会导致 postinstall 的 lefthook 安装器失败）。系统 Node 未升级前，命令前加：

```sh
export PATH="/c/Users/60410/AppData/Local/Temp/node-v22.19.0-win-x64:$PATH"
```

（Temp 下的便携版若被清理，从 https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip 重新下载解压即可；长期建议升级系统 Node。）

## 同步上游后的动作

```sh
git fetch upstream && git merge upstream/master   # fast-forward
pnpm install && pnpm run build                    # 若依赖或 API 有变
pnpm exec vitest run --config personal/plugins/dsh-x-model-tuning/vitest.config.ts
```

preview 期上游可能有破坏性变更；若插件失效，先看 `docs/user/develop/` 与相关包 README 的变更，再调整插件。
