# Agent Note: 桌面图标统一为 favicon 鲸鱼标志，托盘 Quit 不再卡死

Status: implemented

## 问题

1. **托盘图标是个蓝底白 X 的占位图**。`apps/desktop/scripts/generate-icons.mjs` 用 SDF 手绘的就是这个 X，应用图标（`build/icon.png`）同理。用户要求应用图标与托盘图标统一使用 `website/public/favicon.svg` 的鲸鱼标志。
2. **从托盘 Quit 之后应用卡死不退出**。

## 决策

**图标从 favicon 的路径直接栅格化，仍然零二进制工具依赖**。脚本读 `website/public/favicon.svg` 的唯一一条 `<path>`（只有 M/C/Z 三种命令，nonzero 填充），把贝塞尔曲线固定 32 段拍平成折线，超采样扫描线填充，输出 `build/icon.png`（1024）与 `assets/tray.png`（32），背景全透明。脚本对路径命令集有断言：favicon 将来若长出 `A`（圆弧）等命令，重新生成会失败报错而不是悄悄画错。electron-builder 在 Windows 侧继续从 `icon.png` 推导安装器图标。

**Quit 卡死按两道防线修**：

- `quit()` 同时服务托盘菜单项和 `before-quit` 事件，而它自己结尾的 `app.quit()` 又会触发 `before-quit` 重入自己——无保护的重入会再跑一遍进程树击杀与 runtime 注记删除，并可能形成退出循环。入口加 `if (quitting) return`，击杀 sidecar 前先清引用。
- 兜底：优雅退出发出 3 秒后仍未退出就 `process.exit(0)`。此时 runtime 已杀、注记已删，没有任何正当理由还在等；托盘的 Quit 承诺的是「应用没了」。菜单路径里那句冗余的 `quit(); app.quit()` 一并简化为 `quit()`。

## 代价

| 事项 | 状态 |
|---|---|
| 卡死的原始复现 | 无法在本机稳定无头复现；重入缺陷是真实的代码路径，兜底保证最坏情况 3 秒内退出，验收时以实际表现为准 |
| 图标风格 | 不再有圆角底板，鲸鱼直接立在透明底上，与网站一致 |
