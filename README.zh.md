# DSH-X

[English](README.md) | 中文

DSH-X 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，一切皆插件的 agent harness，基于 Cordis）的个人分支。分支跟随上游 `master` 演进，并在其上承载自己的产品面。

## 本分支的特点

- **桌面壳**——`dsh --profile web` 运行时之上的 Electron 窗口，带运行时发现、托盘驻留、首启内嵌 runtime 解压，以及 Windows（NSIS + 便携版）与 macOS（dmg，arm64 + x64）安装包。每个 Release 的安装包内嵌的 runtime 直接由该 release tag 构建，而非取自 npm registry（[apps/desktop](apps/desktop/README.md)；[设计笔记](.agents/notes/proposed/architecture/2026-08-15-desktop-runtime-surface.md)）。
- **锚定标准模式**——[`anchored-standard`](apps/cli/config/agent-presets/anchored-standard/)，移植自社区项目 [`dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)：请求 #1 锚定在 Minimal 双工具、零注入条件上；会话落库首个持久回复或工具调用后，目录晋升为按需解锁的 resident 集（`dev_tool_search` / `skill_search` / `skill_load`）。相位状态从持久会话事件推导，压缩边界重新进入受控相位。
- **用量面板**——逐请求的模型 token 用量作为会话投影、`/usage` 报告命令，以及 Web UI 中的"模型用量"设置分区。
- **个人层**——[personal/](personal/README.md) 下的本地 model-hub 预设与插件，以及本部署默认 web 端口 13080。

## 安装

桌面安装包发布在 [Releases 页面](https://github.com/hfut2014211610/dsh-x/releases)（`dsh-v0.2.0` 是首个携带安装包的 Release）。仅在发布密钥配置时进行代码签名，否则安装包有效但未签名。

## 从源码运行

```sh
git clone https://github.com/hfut2014211610/dsh-x.git
cd dsh-x
pnpm install
pnpm run build
pnpm dsh web
```

本部署的 Web UI 地址为 `http://127.0.0.1:13080`。开发桌面壳：`pnpm run dev:desktop`。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

未列于上述特点之外的一切随上游演进：从 `upstream` 远程合并即可吸收上游变更。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
