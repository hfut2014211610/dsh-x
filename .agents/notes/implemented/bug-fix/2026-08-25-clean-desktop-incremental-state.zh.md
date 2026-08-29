# Agent Note: 清理桌面输出时同步清理增量编译状态

Status: implemented

[English](2026-08-25-clean-desktop-incremental-state.md) | 中文

## 问题

`pnpm run clean` 会删除 `apps/desktop/lib`，但保留 `apps/desktop/tsconfig.tsbuildinfo`。下一次 Project Reference 构建可能信任过期增量记录，并因记录为最新的输出文件已经不存在而报告 `TS6305`。

## 决策

清理脚本把桌面应用识别为 Project Reference 输出所有者，在删除 `apps/desktop/lib` 时同步删除其 `tsconfig.tsbuildinfo`。回归测试创建这两个路径，执行仓库清理器，并要求二者都不存在。

## 备选方案

- **保留桌面构建输出。** 否决：`clean` 必须把生成的应用输出恢复为仅源码状态。
- **递归删除发现的所有 `tsconfig.tsbuildinfo`。** 否决：清理器只拥有一组封闭的构建根；不受限制的递归删除可能清掉这些输出之外的无关增量状态。
- **要求开发者清理后运行 `tsc --force`。** 否决：不一致状态由清理操作产生，应由它负责移除，而不应把恢复责任转移给每个调用者。

## 结果

- 桌面端清理重建不会复用已删除输出对应的增量记录。
- 清理器仍只作用于明确的仓库构建根，不扩大删除范围。
