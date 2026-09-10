# Agent Note: 合并上游到 0.1.5-rc.1

Status: implemented

[English](2026-09-10-upstream-merge-0.1.5-rc.1.md) | 中文

## Problem

fork 停在上游 0.1.2-alpha.5，而上游已发到 0.1.5-rc.1：171 个 fork 独有提交对 1459 个上游提交。上游三处演进与 fork 自有表面正面相撞：双方各自独立创建了 `apps/desktop/`；上游把 `native/landlock-run` 改名为 `native/system`；会话格式管道把逐行事件数组换成单遍 `SessionFormatRestore`，并彻底移除了 `assistant/chunk` 事件。

## Decision

把 `upstream/master`（0.1.5-rc.1）合并进 fork，切出 `0.1.5-rc.1-x.0.10`，再把桌面产品整体切到上游 Electron 壳（见下），并从它发布 `0.1.5-rc.1-x.0.11`：

- 完整采用 `apps/desktop` 与 `apps/desktop-host`；fork 的 Stage A 侧车壳删除。fork 的 `desktop-release.yml` 流程围绕上游 `package-target.ts` 管道重写（packed family closure，fork 包随 runtime 走）。
- 更新通道改成本仓库的 GitHub Releases，而不是上游的腾讯 COS 部署（fork 没有 COS 凭证）；代码签名保持"无签名但有效"的回退，只在相关环境齐备时启用。
- fork 各 manifest 继续原样携带上游版本号（`0.1.5-rc.1`）；fork 序号经 `extraMetadata`（`DSH_DESKTOP_VERSION`）进打包后的 manifest，绝不进源码树。
- 把双写者 overlap 恢复重接到 restore 管道上：scanner 保留已喂行，遇到回退的 seq 就在保留前缀上重建 restore，后来者的编号仍然获胜。`overlaps`/`overlapFloor` 语义不变。
- 把 `usage-stats` 与飞书 renderer 迁出 `assistant/chunk`：用量随 `assistant/message` 到达，没有消息的 attempt 不留记录，卡片渲染整条消息。
- 合并 web-app/CLI 组合（上游的 `open-in-app`、`file-uploads`、frontend-static 行加上 fork 的飞书/写作/model-hub 行）。

## Alternatives considered

保留 fork 侧车壳是合并时的第一版决议，随后被推翻：留一个平行壳等于在每次上游同步时重付这次合并的桌面冲突成本，而侧车壳的真正资产（自动化发布流与 GitHub 更新通道）可以搬到上游壳上。rebase 代替 merge 被否决：171 个提交的评审历史比线性日志值钱。把 overlap 测试降级为断言拒绝的方案被否决——后来也不需要了：感知 restore 的重接保留了桌面加 CLI 共享场景依赖的恢复能力。

## Verification

合并点上 `release:verify --family dsh`（281 个成员，`0.1.5-rc.1`）、`typecheck`（host 与 client 两面）、`lint`、`usage-stats`/飞书/session-persistence/ui-conversation/subprocess 各套件（含搬到 v3 的 overlap 测试）与 `test:docs` 全部通过。

## Consequences

失败的 attempt 不再落定用量记录：没有 `assistant/message` 的 step 按设计不计账，而旧管道会对流出的 chunk 采样计账。fork 的 `minimal` 预设保留了自己的编辑器与 Git-Bash 行，与上游的纯 shell minimal 并存。浏览器快照 golden 未在本地重录；以 CI 的 web replay 通道信号为准。
