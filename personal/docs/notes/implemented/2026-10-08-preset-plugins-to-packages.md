# Agent Note: 九个预设插件从 .mjs 迁成包

Status: implemented

## 问题

anchored-standard 预设的差异化全在九个 `.mjs` 文件里，它们住在 `packages/preset/agent-presets/presets/anchored-standard/` 目录下，靠预设加载器**按预设目录解析相对行**来找到彼此。

这个机制与「预设定义也放在包里」的计划冲突：一旦把预设定义搬到 bundle patch 里，相对行就会按 profile 的 `ctx.baseUrl` 解析，而不是 patch 所在目录，于是 `./context-gate.mjs` 之类全部失效。

## 决策

**T：把这九个 `.mjs` 全部改写成合规的 TypeScript 包**，而不是保留为纯 JS 包。

`scripts/check-workspace-constraints.ts:246` 的 `expectedDshPackageFiles` 把 `files` 写死为 `lib/index.js` + `lib/types/**/*.d.ts`，330 个包无一例外以 `lib/index.js` 为 `main`。保留纯 JS 主入口就得给上游脚本开口子，那比改一行 `tsdown.config.ts` 更破边界。

九个包：

| 包 | 角色 |
| --- | --- |
| `@deepseek-ai/dsh-compaction-epoch` | 共享的提升状态（被四个插件读） |
| `@deepseek-ai/dsh-context-gate` | 注入门控 |
| `@deepseek-ai/dsh-tool-bootstrap` | 工具目录两阶段 |
| `@deepseek-ai/dsh-agent-instruction-hint` | 指令文件一次性提示 |
| `@deepseek-ai/dsh-session-guide` | 近场引导（默认禁用） |
| `@deepseek-ai/dsh-tool-dev-search` | 工具发现与解锁 |
| `@deepseek-ai/dsh-tool-skill-search` | 技能发现与加载 |
| `@deepseek-ai/dsh-tool-bash-windows` | Windows bash |
| `@deepseek-ai/dsh-ued-mode` | UED 策略段 |

## 这不是搬文件，是重写

四处「同步历史读取」必须改掉：`.mjs` 用 `Session.snapshotEvents()` 扫持久日志并按 session id 在进程内记忆，而 0.2.0 明确禁止新代码调用这三个同步读取器（`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`），替代机制是 session projection。

改用 projection 后代码反而更简单：折算按日志顺序进行，`compaction/end` 只要清掉标记，旧代码里「比较 seq 是否晚于 boundary」整个消失了。

`boundary` 必须留在状态里，因为 `tool-bootstrap` 用它区分「压缩过的会话」和「全新会话」。

## 迁移中确认的上游事实

- **0.2.0 删掉了通用的 `plugin` source kind。** `packages/llm/llm/src/message.ts` 的注释写明「there is no shared catch-all `plugin` kind」。生产者各自通过 `MessageSourceMap` 声明合并声明自己的 kind，`dsh-agent-instructions`、`tmux-context` 都是这个写法。`instruction-hint` 因此改用插件自带 kind。
- **`createUserMessage` 禁止调用方指定 id**（`input: T & { readonly id?: never }`）。预设的确定性 `session-guide-<userId>`、`instruction-hint-<sessionId>`、`skill-load-<name>-<timestamp>` 全部消失，去重改由 projection 承担。
- **上游已有维护版实现**：skill 正文用 `renderSkillContent`，可见性用 `isModelInvocable`，`skill-invocation` source 复用 `dsh-tool-skill` 的声明。换掉本地副本还删掉一条死代码——预设手写的 `extractSkillBody` 能对空正文返回空串，所以有「无可加载正文」分支；`renderSkillContent` 永远输出包装块，该分支不可能触发。
- **schemastery 不拒绝未知键。** 手写的 `ALLOWED_KEYS` 检查必须保留成显式代码，否则预设行里的拼写错误会静默关掉本想启用的设置。仓库里 `llm-retry`、`token-meter`、`plan-mode` 都这么做。
- **schemastery 的 `z.array()` 在键缺失时产出 `[]`。** 所以「省略」与「显式空」在 loader 已套用 schema 后无法区分；`compactionTools` 两者都按「无压缩恢复目录」处理，去掉了原 `.mjs` 里那个无价值的报错。
- **`Session.record` 之类品牌类型**：`ToolCallId` 在 `dsh-llm` 而非 `dsh-session`。

## 后果

- 三个 fork 预设以 bundle patch 形式回到 web surface（`anchored-standard` order 1.5、`writing` 5、`ued` 6），七行插件引用换成裸包名，九个包声明进 bundle manifest。
- `context-gate` 补了 `packages/AGENTS.md` 要求的真实组合测试：走 Loader 起真实 `cordis.yml`，用 `sandbox-policy` 和 `time-context` 两个真实注入源断言提升前后的模型可见面。
- 全部 118 项测试、host tsc、oxlint、约束门禁通过；打包与发布链仍受 [上游 0.2.0-rc.2 冷树构建失败](../archive/postmortem-2026-10-08-upstream-020rc2-build.md) 阻塞。
- 九个包里，`tool-bash-windows` 故意不同于其他八个：它挂载时做真实的可执行文件解析，所以缺少 subprocess 服务时在挂载期显式失败并点名，而不是因声明注入而静默不挂载。