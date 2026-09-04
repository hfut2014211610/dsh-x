# DSH-X

[English](README.md) | 中文

DSH-X 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，一切皆插件的 agent harness，基于 Cordis）的个人分支。分支跟随上游 `master` 演进，并在其上承载自己的产品面。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 本分支的特点

- **桌面壳**——`dsh --profile web` 运行时之上的 Electron 窗口，带运行时发现、托盘驻留、首启内嵌 runtime 解压，以及 Windows（NSIS + 便携版）与 macOS（dmg，arm64 + x64）安装包。每个 Release 的安装包内嵌的 runtime 直接由该 release tag 构建，而非取自 npm registry（[apps/desktop](apps/desktop/README.zh.md)；[设计笔记](personal/docs/notes/proposed/2026-08-15-desktop-runtime-surface.md)）。
- **锚定标准模式**——[`anchored-standard`](packages/preset/agent-presets/presets/anchored-standard/)，移植自社区项目 [`dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard)：请求 #1 锚定在 Minimal 双工具、零注入条件上；会话落库首个持久回复或工具调用后，目录晋升为按需解锁的 resident 集（`dev_tool_search` / `skill_search` / `skill_load`）。相位状态从持久会话事件推导，压缩边界重新进入受控相位。
- **用量面板**——逐请求的模型 token 用量作为会话投影、`/usage` 报告命令，以及 Web UI 中的"模型用量"设置分区。
- **个人层**——[personal/](personal/README.md) 下的本地 model-hub 预设与插件，以及本部署默认 web 端口 13080。

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

## 安装

桌面安装包发布在 [Releases 页面](https://github.com/hfut2014211610/dsh-x/releases)（`dsh-v0.2.0` 是首个携带安装包的 Release）。仅在发布密钥配置时进行代码签名，否则安装包有效但未签名。

<a id="run-from-source"></a>

## 从源码运行

```sh
git clone https://github.com/hfut2014211610/dsh-x.git
cd dsh-x
pnpm install
pnpm run build
pnpm dsh web
```

本部署的 Web UI 地址为 `http://127.0.0.1:13080`。开发桌面壳：`pnpm run dev:desktop`。

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

未列于上述特点之外的一切随上游演进：从 `upstream` 远程合并即可吸收上游变更。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
