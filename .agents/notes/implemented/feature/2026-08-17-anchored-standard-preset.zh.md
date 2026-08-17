# Agent Note: 锚定标准内置预设

Status: implemented

[English](2026-08-17-anchored-standard-preset.md) | 中文

## Problem

DeepSeek V4 级模型的首条思维链轨迹强烈依赖首次模型请求在 API 上可见的条件。上游社区复现项目（`dsh-anchored-standard`，MIT）量化了三个杠杆：工具 schema（官方 Minimal 双工具对 5/5 锚定；所有 standard 系 schema 11/11 落入 standard-like）、首请求输出预算、自动注入上下文（技能目录在场时 0/9 锚定）。内置预设此前只能二选一：`standard` 从请求 #1 起暴露完整目录与全部注入，放弃 Minimal 条件的轨迹；`minimal` 永久保持轨迹但放弃全部重型工具。在上游的 Project2 级评测中，该预设家族三轮 V4 Pro 得分为 98/99/99，而 Standard 为 91——两段式组合正是同时收回两者的机制。

## Decision

新增第五个内置预设 `apps/cli/config/agent-presets/anchored-standard/`（选择器名"锚定标准模式"，order 1.5，可选——`standard` 仍为默认）。它在 Standard 行集前挂两个相位控制行，并替换两处注入：

- **`context-gate`**（必须挂 FIRST 行）在会话未晋升时关闭两条统一注入路径：装配的 `contexts` 被清空（覆盖整个 `SystemPrompt.context()` 家族，而非按来源枚举黑名单），pre-step 瀑布只保留本轮 CLAIMED 消息批次加 `allowKinds`（`skill-invocation` 作为用户手势放行）。瀑布 after-next 变换按注册逆序生效，因此最先注册加 `prepend` 监听使门成为最外层变换。
- **`tool-bootstrap`** 把请求 #1 收窄到 Minimal 预设的真双工具对——持久 `bash`（沙箱 `tool-bash` 全平台禁用；持久 shell 独占该名）加 `str_replace_editor`——待会话落库首个持久 `tool/call` 或 `assistant/message`（`promoteOn: either`）后，收窄到 resident 集：双工具对、三个发现工具、以及模型已显式解锁的工具。晋升时一次性倒出完整目录会把轨迹拉回 standard-like（上游修复的晋升后回退问题）。
- **`instruction-hint`** 替换 `dsh-agent-instructions` 摘要行：晋升后注入一条由持久事件守护的一次性提示，告知指令文件存在；内容由模型自行读取。
- **`skill-search`** 替换 `dsh-tool-skill` 行：按需的 `skill_search`/`skill_load` 取代约 9KB 的 `<available_skills>` 目录注入，并保留 tool-skill 的可见性规则（`invocation.modelInvocable`）。
- **`dev-tool-search`** 注册 `dev_tool_search`：对 agent 作用域目录做关键词搜索并按精确名解锁；已解锁名从持久 `tool/call` 参数推导，resume 后保留。

全部相位状态由同一个 epoch-aware 追踪器（`compaction-epoch.mjs`）从持久会话事件推导：`compaction/end` 边界将会话降级回双工具对加 `compactionTools` 工作集，直到边界之后出现新的晋升信号，因此压缩后的首个请求也是受控的"第二次首请求"。相位行的 `includeSubagents: true` 让委派子 agent 的首个请求同样被锚定。bootstrap 工具缺失时带一次性告警降级为完整目录；非法配置在挂载时报错；门的过滤器出错时降级为保留上下文而非吞掉。

## Adaptations from the upstream preset

上游组合面向 harness `0.1.0-rc.5`，在 Windows 上通过 `custom-bash` 行补位（其 PTY 后端仅支持 linux/darwin）。本 harness 的 `spawnTerminal` 直接运行 node-pty，看起来跨平台——但 `subprocess-local` 的进程检查器在 spawn 时仍拒绝 win32（"terminal inspection is unsupported on platform win32"），PTY 接缝实际仍是 linux/darwin。因此移植保留上游的平台切分：linux/darwin 由持久 shell 持有 `bash`，win32 由移植的 `custom-bash`（适配本 harness 必填 `cwd` 的 spawn 规格）持有同名工具，经普通 subprocess 接缝执行 Git Bash。内置 `minimal` 预设带着同样的 win32 缺陷（无门控的持久 shell 能挂载但无法执行）；本次一并为其加门控并挂载同一个 `custom-bash`。

上游 `dev-tool-search` 的 schema 编译器还会丢弃 `toolNames` 的 `items` 字段；移植版将其透传。技能可见性遵循本 harness 的调用策略（上游早于该机制）。

## Alternatives considered

**同时移植上游的变体家族（zero-anchored、whoami、prefab、eternal-minimal、wire-think、combo）。** 否决：它们是上游评测循环的对照模式——每个变体以持续代价换取各自杠杆（每会话或每轮多一次模型调用、兄弟 provider 路由、前缀缓存抖动），且其 Project2 级分数无法与基础模式分离。基础两段式组合以零持续代价承载实测收益；变体可日后按需移植。

**保留 `custom-bash` 以与上游对齐 Windows。** 保留：本 harness 的 PTY 原语看似跨平台（node-pty 无 win32 守卫），但本地 subprocess 提供方的进程检查器只覆盖 linux/darwin、在 win32 spawn 时抛错，持久 shell 在 Windows 上无法执行。第二个 `bash` 实现是全平台可用双工具对的代价；其描述不同（全新 shell、无沙箱），e2e 以真实执行断言双工具对，而非目录在场。

**把 `anchored-standard` 提升为默认预设。** 否决：轨迹收益是上游项目在其评测上的测量，未在本 fork 的行为上复验；以可选方式内置让它按部署逐步证明自身，`standard` 仍是无所倾向的默认。

**默认对 bootstrap 请求封顶输出预算（`bootstrapMaxTokens`）。** 否决为默认、保留为 opt-in：Minimal schema 在 adapter 默认 maxTokens 下即可锚定，且封顶的送达在上游复现中依赖 profile 包行为；内置默认只应依赖真正承重的杠杆。

## Consequences

- 选择器新增第五个内置预设并带独立 UI 本地化条目（`ui-agent-preset` 语言包中的 `presetAnchored*`，沿内置映射模式），`web-agent-presets.e2e.ts` 断言完整清单，并新增两段式测试：引导双工具对与空 contexts → 持久回复晋升到 resident 集 → `dev_tool_search` 搜索与持久解锁 → 压缩边界降级回双工具对加工作集。
- 预设目录自包含：本地 `./…mjs` 行随目录携带，`agentPresets.copy` 复制它依旧可用；上游 MIT 归属保留在源自它的行文件中。
- 前缀缓存连续性在每次目录变化处断开（晋升、每次解锁）——相位收窄目录的固有代价，也正是该预设存在的取舍。
- 重型 Standard 工具（`web_search`、`subagent`、`workflow`、`exit_plan_mode` 等）距 resident 集一次 `dev_tool_search`；从不搜索的会话看到双工具表面，这正是 Minimal 对的设计代价剖面。
- 轨迹收益是继承证据而非本地保证：锚定条件（schema、预算、注入）由新测试断言，轨迹本身没有断言——无密钥测试无法断言模型行为。
