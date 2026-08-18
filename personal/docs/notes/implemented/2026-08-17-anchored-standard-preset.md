# Agent Note: 锚定标准内置预设

Status: implemented

## 问题

DeepSeek V4 级模型第一条思维链走成什么样，很大程度上取决于第一次模型请求在 API 上让它看见了什么。上游的社区复现项目（`dsh-anchored-standard`，MIT）量出三个真正起作用的因素：工具 schema（官方 Minimal 的双工具对 5 次锚定 5 次；所有 standard 系 schema 11 次全部落进 standard-like）、第一次请求的输出预算、自动注入的上下文（技能目录在场时 9 次里锚定 0 次）。内置预设以前只能二选一：`standard` 从请求 #1 就把完整目录和全部注入摆出去，等于放弃 Minimal 那条轨迹；`minimal` 能一直保住轨迹，但重型工具一个都用不上。上游 Project2 级评测里，这个预设家族三轮 V4 Pro 拿了 98/99/99，Standard 是 91，两段式组合就是把两边都收回来的做法。

## 决策

新增第五个内置预设 `apps/cli/config/agent-presets/anchored-standard/`（选择器里叫"锚定标准模式"，order 1.5，可选；默认仍然是 `standard`）。它在 Standard 行集前面挂两个相位控制行，另外替换两处注入：

- **`context-gate`**（必须挂 FIRST 行）在会话还没晋升时，把两条统一注入路径都关掉：装配好的 `contexts` 直接清空（覆盖整个 `SystemPrompt.context()` 家族，不去按来源列黑名单），pre-step 瀑布只留本轮 CLAIMED 的消息批次加 `allowKinds`（`skill-invocation` 算用户手势，放行）。瀑布的 after-next 变换按注册的逆序生效，所以最先注册、再加 `prepend` 监听，这一步就成了最外层的变换。
- **`tool-bootstrap`** 把请求 #1 缩到只剩 Minimal 预设那对真工具——常驻 `bash`（沙箱 `tool-bash` 全平台禁用，这个名字由持久 shell 独占）加 `str_replace_editor`。等会话落库了第一条持久的 `tool/call` 或 `assistant/message`（`promoteOn: either`），再放开到 resident 集：那对工具、三个发现工具、以及模型自己显式解锁过的工具。晋升时一次性把完整目录倒出来会把轨迹打回 standard-like，这正是上游修过的晋升后回退问题。
- **`instruction-hint`** 替换 `dsh-agent-instructions` 的摘要行：晋升之后注入一条由持久事件守护的一次性提示，只告诉模型指令文件存在，内容让它自己去读。
- **`skill-search`** 替换 `dsh-tool-skill` 行：用按需的 `skill_search`/`skill_load` 取代那份约 9KB 的 `<available_skills>` 目录注入，同时保留 tool-skill 原有的可见性规则（`invocation.modelInvocable`）。
- **`dev-tool-search`** 注册 `dev_tool_search`：在 agent 作用域的目录里按关键词搜，按精确名解锁；已解锁的名字从持久 `tool/call` 的参数推导出来，resume 之后还在。

所有相位状态都由同一个 epoch-aware 追踪器（`compaction-epoch.mjs`）从持久会话事件推出来：碰到 `compaction/end` 边界，会话退回双工具对加 `compactionTools` 工作集，直到边界之后又出现新的晋升信号，所以压缩后的第一个请求也是受控的，相当于"第二次首请求"。相位行设了 `includeSubagents: true`，委派出去的子 agent 第一个请求同样被锚定。bootstrap 工具缺失时，带一次性告警退回完整目录；配置非法在挂载时就报错；`context-gate` 的过滤器自己出错时，选择保留上下文，不把它吞掉。

## 相对上游预设做的改动

上游那套组合面向 harness `0.1.0-rc.5`，在 Windows 上靠 `custom-bash` 行补位（它的 PTY 后端只支持 linux/darwin）。本 harness 的 `spawnTerminal` 直接跑 node-pty，看着像是跨平台的，但 `subprocess-local` 的进程检查器在 spawn 时仍然拒绝 win32（"terminal inspection is unsupported on platform win32"），PTY 这条接缝实际还是只有 linux/darwin 能用。所以移植保留了上游的平台切分：linux/darwin 上 `bash` 由持久 shell 持有，win32 上由移植过来的 `custom-bash` 持有同名工具（按本 harness 必填 `cwd` 的 spawn 规格适配过），走普通 subprocess 接缝去执行 Git Bash。内置的 `minimal` 预设有同样的 win32 毛病——没有门控的持久 shell 能挂上但执行不了——这次一并给它加了门控，挂同一个 `custom-bash`。

上游 `dev-tool-search` 的 schema 编译器还会把 `toolNames` 的 `items` 字段丢掉，移植版把它透传下去。技能可见性按本 harness 的调用策略走（上游那版早于这套机制）。

## 备选方案

**把上游的变体家族一起移植过来（zero-anchored、whoami、prefab、eternal-minimal、wire-think、combo）。** 否决：它们是上游评测循环里的对照模式，每一种都要一直付出代价才换来自己那点作用——或者每会话多请求一次，或者每轮多请求一次，或者要走到同级 provider，或者前缀缓存被打乱；而且它们的 Project2 级分数没法单独拆出来看。基础的两段式组合不用一直付代价就拿到了实测收益，变体以后要用再移。

**保留 `custom-bash`，跟上游一样处理 Windows。** 保留：本 harness 的 PTY 原语看着跨平台（node-pty 没有 win32 守卫），但本地 subprocess 提供方的进程检查器只覆盖 linux/darwin，在 win32 spawn 时会抛错，持久 shell 在 Windows 上根本执行不了。要让这对双工具在所有平台都能用，代价就是第二个 `bash` 实现；它的描述不一样（全新 shell、无沙箱），所以 e2e 断言的是真实执行，不是目录里有没有这个名字。

**把 `anchored-standard` 提成默认预设。** 否决：轨迹上的收益是上游项目在它自己的评测上测出来的，还没在本 fork 的行为上复验过。先做成可选的内置项，让它按部署一点点证明自己，`standard` 继续当那个不偏不倚的默认。

**默认给 bootstrap 请求的输出预算封顶（`bootstrapMaxTokens`）。** 不做默认，留成 opt-in：Minimal schema 在 adapter 默认 maxTokens 下就能锚定，而且封顶能不能送达，在上游复现里还依赖 profile 包的行为。内置默认只依赖那些真正管用的因素。

## 后果

- 选择器多了第五个内置预设，带自己的 UI 本地化条目（`ui-agent-preset` 语言包里的 `presetAnchored*`，沿用内置映射的写法）。`web-agent-presets.e2e.ts` 断言完整清单，并新增了两段式的测试：引导阶段是双工具对加空 contexts，一条持久回复晋升到 resident 集，`dev_tool_search` 搜索并持久解锁，压缩边界退回双工具对加工作集。
- 预设目录是自包含的：本地的 `./…mjs` 行随目录一起走，`agentPresets.copy` 复制之后照样能用；来自上游的行文件保留了 MIT 归属。
- 每次目录发生变化（晋升、每一次解锁），前缀缓存的连续性都会断一次。这是分相位裁剪目录必然要付的成本：拿缓存连续性，换第一次请求锚定在 Minimal 条件上。
- 重型的 Standard 工具（`web_search`、`subagent`、`workflow`、`exit_plan_mode` 等）离 resident 集只差一次 `dev_tool_search`；从来不搜的会话看到的就是那对双工具，这也正是 Minimal 那对工具在设计上要付的代价。
- 轨迹上的收益属于继承来的证据，不是本地保证：锚定条件（schema、预算、注入）由新测试断言，轨迹本身没有断言，因为无密钥的测试断言不了模型行为。
