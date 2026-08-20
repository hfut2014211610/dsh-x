# personal/docs — fork 文档统一归口

本目录是 DSH-X fork 的**唯一文档落地点**。除上游原样跟踪的文档外，所有本 fork 产生的设计笔记、指南、复盘与规划一律放这里。

## 为什么统一放这里

`personal/` 是上游永远不会新增的顶层目录，这是 fork 保持 `git merge upstream/master` 快进合并、零冲突的根据（见 [personal/README.md](../README.md)）。文档写进 `.agents/notes/`、`docs/` 等上游跟踪路径，会让 fork 的文档与上游文档在同一命名空间下持续累积，既违反 fork 自己的隔离原则，也把本地笔记暴露给上游的整套文档门禁（双语配对、格式分类、字数预算）。

2026-08-18 的迁移已把 8 篇 fork 自撰的 Agent Note 从 `.agents/notes/` 移入 `notes/`，并合并双语三件套为单份中文。上游的 2057 篇笔记与 11 个 skills 原地不动。

## 目录结构

| 目录 | 放什么 |
|---|---|
| `notes/implemented/` | 已落地的设计笔记（Agent Note），记录决策与后果 |
| `notes/proposed/` | 已提出、未落地的设计笔记，含验收标准与风险 |
| `notes/rejected/` | 已废弃的设计笔记，保留原文供追溯 |
| `guides/` | 长期有效的操作指南，如 [插件开发指南](guides/plugin-guide.md) |
| `archive/` | 复盘与事后分析，如 [模型中心探活复盘](archive/postmortem-2026-08-15-model-hub-probe.md) |
| `design/` | 本地草稿，**已 gitignore**，不提交 |
| `roadmap.md` | 总体计划：已完成需求与待安排设计的单一视图 |
| `产品说明书.md` | 面向使用者的产品说明，`.md` 是唯一来源；导出的 `.rtf`/`.doc` **已 gitignore** |

笔记按 `notes/<状态>/` 归类，不再保留上游的 `<类型>/`（architecture / feature / bug-fix / process）子层——本 fork 的笔记量不需要二维分类，类型从标题即可辨识。

## 新增文档的规则

- **语言**：单份中文。不做双语配对，不写 `.zh.md`，不写 `.i18n.yaml`。上游的双语义务只约束上游文档。
- **命名**：笔记用 `YYYY-MM-DD-kebab-title.md`；指南与复盘用描述性 kebab 名。
- **笔记正文**：沿用 Agent Note 结构——首行 `# Agent Note: <标题>`，次行 `Status: implemented` / `Status: proposed` / `Status: rejected — <原因>`，其后 `## 问题`、`## 提案`/`## 决策`、`## 备选方案`、`## 验收标准`/`## 后果`、`## 风险`。
- **状态流转**：笔记落地后，把 `Status:` 改为 `implemented` 并从 `notes/proposed/` 移到 `notes/implemented/`，同时更新 `roadmap.md`。
- **废弃**：移到 `notes/rejected/`，`Status:` 改为 `rejected — <原因>`，在正文顶部加一节说明废弃原因与取代它的笔记，原文保留在分隔线之下供追溯。取代它的新笔记要反向链接回来。
- **引用上游笔记**：从 `notes/<状态>/` 出发是 `../../../../.agents/notes/<状态>/<类型>/<名>.md`（两侧同为 4 层深度，指向仓库根的相对路径可原样保留）。
- **入站引用**：上游跟踪文件不得引用本目录。只有 fork 已拥有或已改动的文件（`README.md`、`apps/desktop/*`、`personal/*` 等）可以链接过来。

## 门禁覆盖差异（迁移的代价）

`personal/` 不在仓库文档门禁的扫描范围内，这是迁出 `.agents/notes/` 的直接后果，新增文档时需自行留意：

| 门禁 | 覆盖 `personal/docs/` | 影响 |
|---|---|---|
| `verify-md-links` | 否 | 相对链接失效不会被发现，改动路径后需手工核对 |
| `verify-md-wrap` | 否 | 段落单物理行约定不再强制 |
| `verify-agent-note-format` / `-classification` | 否 | 笔记的 Status 行与必需章节不再校验 |
| `verify-doc-refs` | 否 | TypeScript 注释引用本目录的路径不被校验 |
| `verify-translation-pairing` | 是（全仓 `**/*.md`） | 单份中文文档无配对即通过；**新增 `README.md` 需登记到 [排除清单](../../scripts/translation-pairing.manifest.json)** |

## 不迁到这里的内容

- `.agents/notes/` 下 2057 篇**上游**笔记——迁移会破坏 502 个文件的链接、3 个专用门禁和 20 余个引用脚本，并使快进合并永久失效。
- `.agents/skills/` 下 11 个**上游** skill——`AGENTS.md` 自身引用 `dsh-pre-push-checks`、`dsh-prose-standard`、`dsh-translate-docs`，而 `AGENTS.md` 是不可编辑的上游文件。
- `docs/` 下的上游文档与生成产物（`config-catalog.md`、`tool-catalog.md` 等由 `scripts/gen-*.ts` 生成，手改会被 `doc-sync` 打回）。
