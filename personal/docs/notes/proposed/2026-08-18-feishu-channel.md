# Agent Note: 飞书通道 —— 单聊与群聊接入 dsh

Status: proposed

## 问题

dsh 现在有三个面：CLI、Web、桌面壳，三个都要求人坐在电脑前。想在飞书里直接支使它——单聊发一句话就干活，群里 @ 一下就接活，过程能看见——现在没有任何入口。

外面已经有两份现成的东西，都要先看过再动手。

[`PlutoKeating/dsh-lark-bot`](https://github.com/PlutoKeating/dsh-lark-bot) 是把 dsh 桥进飞书的 bot，功能齐全（流式卡片、每会话一个 git worktree、守护进程）。它的桥接层作为 dsh 插件跑在 dsh 进程内，但 agent 执行走官方 SDK 子进程，而 `packages/sdk/client/README.md` 明写这条路 **no mid-turn cancel**——想停一个正在跑的回合只能把整个 runtime 关掉重建，它的 `/stop` 就是这么实现的。同一个限制也堵死了工具审批：SDK 协议里没有审批通道。

本机上还有一份：`~/.agents/skills/` 下的 `lark-event` / `lark-im` / `lark-shared` 三个技能，底下是装好的 `lark-cli` v1.0.87，应用与凭证都配完了（secret 在系统 keychain）。它把飞书的接入难点解决掉了一大半，本笔记的通道层就建在它上面。

## 提案

两个部件：

- `personal/plugins/dsh-x-feishu/`，host 插件，用 `dsh plugin --profile web add` 挂进常驻的 web profile。
- 同一个包里的 `feishu-bridge`，独立常驻进程，是飞书事件的唯一消费者。

上游文件一行都不改。

### 为什么插件必须在 dsh 进程内

`docs/architecture.md` 的扩展点表里写的就是这条：**"Add UI or editor integration → drive `ctx.agents` and render from `session/event`"**。飞书 bot 本质是一个没有界面的客户端。三条候选路子的差别不是取舍，是能不能做到：

| 路子 | 中途取消 | 工具审批 | 会话延续 |
|---|---|---|---|
| **进程内驱动 `ctx.agents`** | `agent.cancel({ kind: 'user' })` | 挂 `approval/request` 答复者 | `ctx.agents.resume()` |
| SDK 子进程 | 没有，只能关掉 runtime | 没有通道 | 有 |
| `dsh --profile headless "task"` | — | — | 没有，一次性 |

还有一条决定性的：**一个会话只能有一个写者**。dsh-lark-bot 专门做了个 web adapter，README 给的理由是"local dsh web agent as single writer (eliminates multi-writer session corruption)"。挂进程内天然就是单写者。

顺带得到的好处：飞书开的会话和 Web UI 用的是同一个会话存储，在飞书里聊到一半可以在浏览器里打开同一个会话接着看。

### lark-cli 给了什么，又限制了什么

给了三样，都是白拿的：**长连接归它的 agent-bus 常驻进程持有**（`~/.lark-cli/agent-bus/events/<app>/bus.alive.lock`），**凭证在系统 keychain**，**`card.action.trigger` 有事件支持**，卡片按钮回调这条通。

限制有四条，每一条都改变了设计：

1. **同一个 event key 只允许一个消费者**（已实测确认）。这条直接推翻了"平时插件消费、崩了守护接管"的交接式设计——没得争，只能让一个常驻进程从头持有。
2. **每次调用约 300ms 进程启动**（实测 `lark-cli --version` 五次：339 / 361 / 291 / 343 / 282 ms，真发 API 还要加 token 解析与网络）。逐字流式卡片要 200–500ms 更新一次，光启动就吃满了。**逐字打字机这条路不通。**
3. **没有 `cardkit` 域**。域列表里 application/approval/…/wiki 没有它，CardKit 只能走 `lark-cli api` 这个 raw escape hatch，还是回到第 2 条。技能里给卡片更新指的是 `interactive/v1/card/update`，那是回调用的 token，**最多更新 2 次**，不是流式那套。
4. **`lark-cli auth` 导不出 token**（只有 check/list/login/logout/qrcode/scopes/status），所以"入站用 lark-cli、出站自己发 HTTP"这条折中也堵死了。

### 结构：桥接进程当唯一消费者

既然只能有一个消费者，就不要交接。让常驻的桥接进程永远持有它，dsh 插件反过来连它：

```
飞书 ⇄ lark-cli agent-bus（lark-cli 自己的常驻进程）
         ▲
         │ event consume（唯一消费者）/ im send / api
         │
   ┌──────────────────┐  常驻独立进程
   │  feishu-bridge   │  ├ 唯一 consumer，读 NDJSON
   │                  │  ├ 本地 pipe/socket 服务端
   │                  │  ├ 出站：回复、卡片、排队回执
   │                  │  └ dsh 不在时自己回执并拉起 dsh
   └──────────────────┘
         ▲ 本地 socket ——「连着」就等于「dsh 活着」
         │
   ┌──────────────────┐  跑在 web profile 进程内
   │  dsh-x-feishu    │  ├ router  chat → sessionId（落盘）
   │                  │  ├ queue   全局串行（共用工作区）
   │                  │  ├ driver  ctx.agents create | resume
   │                  │  ├ renderer session/event → 展示文本
   │                  │  └ approval approval/request 答复者
   └──────────────────┘
```

**用 socket 连接本身当活性信号**，原设计那套心跳文件、pid 探活、15 秒过期阈值、接管与交还两个方向，全部不需要了。而且崩溃发现是即时的：dsh 挂 → socket 断 → 桥接立刻知道。它还自带一个想要的语义——一个跑了很久的回合把 dsh 事件循环占住时 socket 照样连着，桥接正好不该接管，这个判断白拿，不用再拿阈值去猜。

桥接拉起 dsh 之前先探 `127.0.0.1:13080`，与桌面壳判断"要不要自己拉运行时"是同一套（`apps/desktop/src/discovery.ts` 的 `DEFAULT_PROBE_ORIGIN`），不另发明一套发现逻辑。

出站全部归桥接，**dsh 插件完全不碰 lark-cli**。插件那半边只剩纯 dsh 逻辑加一个 socket 客户端，测试里把 socket 一 mock 就全可测。

### 卡片：按阶段更新，不逐字

仍然发 CardKit 卡片，但更新粒度从"每个 token"退到"每个阶段"——收到了、在调哪个工具、出结果了。几秒一次，300ms 的 spawn 完全吃得下。

打字机效果没有了。这是第 2 条限制逼出来的取舍，但代价比看上去小：诉求是"能看见过程"，分段更新一样满足；而逐字效果在一个动辄跑几分钟、几十次工具调用的编码 agent 上，本来就比聊天机器人场景的价值低。

### 已经确认的接入 API

驱动一个新会话，抄 `packages/bundle/headless/src/index.ts` 的骨架，但要多一步挂预设——headless bundle 不组合预设，web profile 组合了：

```ts
const { agent } = await ctx.agents.create({
  sessionId: SessionId(`session-${randomUUID()}`),
  meta: { cwd: workspaceCwd },
  agentOptions: { provider, model },
  setup: async (agentCtx) => {
    await ctx.agentPresets.mount(agentCtx, presetId)   // setup 是唯一支持的调用点
    installModelSelection(agentCtx, { current: selection, assembled: undefined })
  },
})
agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
```

接回已有会话用 `ctx.agents.resume({ resumeSessionId, agentOptions, setup })`，和 `packages/host/apiproxy/src/api-proxy.ts:1658` 走同一条路。

渲染和审批的写法，`packages/acp/acp/src/index.ts` 是现成的模板，整个桥 436 行：

- `ctx.on('session/event', (session, event) => …)` 拿事件，进来先按自己的会话表过滤，不是自己的直接返回。
- `ctx.on('approval/request', (request, next) => …)` 答工具审批，不是自己的会话 `return next()`；自己的就发一张带按钮的卡片，把 `card.action.trigger` 的结果映射成 `allowed-once` / `rejected` / `cancelled`。
- 回合是否结束看 `turn/end`，配合 `agent/inbox/claimed` 认领自己那条消息的 turn 号。`turn/end` 的取消原因是 `aborted` 不是 `cancelled`，另外还有 `blocked` / `max-tokens` / `interrupted` 三种要覆盖。

**不要自造会话事件类型。** 插件指南里写了：读侧只认生成的 `KNOWN_SESSION_EVENT_TYPES`，未知且没打 ignorable 标记的事件会让整份会话日志在读取侧被拒。飞书那边的状态存桥接自己的地方。

会话映射落 `ctx.storageDomain`。域名要满足 `/^[a-z][a-z0-9_]*$/`，所以是 `dsh_x_feishu`，写成连字符会在模块加载时就抛。

### 工作区与并发

所有单聊、群聊共用同一个工作区（web profile 当前那个目录）。代价必须写明白：**同一时刻只允许一个回合在跑，其余排队**。两个人同时让它改同一个仓库，不串行就是互相覆盖。`lark-cli` 那边没有这层，插件自己维护一把全局队列，排队时回一句"前面还有 N 个"。

想要真并行得给每个 chat 开独立 worktree，那是另一篇笔记的事。

### 权限

默认拒绝：单聊要发起人在白名单里，群聊要群在白名单里，群里还要 @ 到机器人。这层判断在桥接进程做——不该让一条没资格的消息穿过 socket 进到 dsh。

飞书应用凭证不归本插件管，`lark-cli` 已经放在系统 keychain 里了。

## 备选方案

**直接装 dsh-lark-bot，不自研。** 否决：它的 agent 执行走 SDK 子进程，拿不到中途取消和工具审批，而这两样正是"在飞书里支使一个会改代码的 agent"必需的。它继续当参考实现，不当依赖。

**用 `@larksuite/channel`（官方高层 SDK）自己连长连接。** 否决：它确实把传输、去重、按 chat 串行、@判定、白名单都包好了，但本机已经有配好凭证的 `lark-cli`，再引一个 v0.5.0 的 npm 依赖是把已经解决的问题重新解决一遍，还多一处凭证要管。

**纯技能方案，不写插件（codex 那版的形态）。** 不够：技能是给会话里的模型用的，飞书这边需要的是一个没有人盯着也能收消息、能起会话、能答审批的常驻件。技能层留着，它是桥接进程调 lark-cli 时的文档来源。

**保留逐字流式卡片。** 否决，见上第 2、3 条限制：300ms 的进程启动吃不下 200–500ms 的更新节拍。

**插件自己消费事件，桥接只在崩溃时接管。** 否决：同一个 event key 不允许两个消费者（已实测），交接式设计无法成立。

**桥接里也能跑 agent（dsh-lark-bot 的 safe mode）。** 本轮不做：那是第二套执行路径，桥接的依赖面一旦长到能跑 agent，它自己就不再是"带不崩的兜底"了。先做只回执的版本。

**把飞书状态写进会话事件。** 否决：会让整份会话日志在读侧被拒。

## 验收标准

- 单聊发一句话，机器人建会话并回复；同一个单聊再发一句，接的是同一个会话，模型看得见上文。
- 群里不 @ 机器人时它不吭声；@ 一下就接活。
- dsh 重启后，在原来的单聊里继续发消息，接回的是重启前那个会话而不是新建。
- 回合跑到一半点卡片上的"停止"，`agent.cancel` 生效，卡片落到"已停止"，会话没坏，下一句还能继续。
- 模型调需要审批的工具时飞书弹审批卡片；点"拒绝"，工具拿到拒绝结果，模型继续跑而不是挂死。
- 白名单外的人发消息，机器人不回，也不建会话，且这条消息不穿过 socket。
- 同一个 chat 连发三条消息，三条按顺序跑完，不并发、不丢。
- 把 dsh 的 web 进程 kill 掉，飞书里发消息，收到桥接的回执，且 dsh 被拉起来。
- dsh 拉起后继续发消息，回的是正常回复而不是桥接回执。
- 让 dsh 卡在一个长回合里但进程还活着，桥接不接管。
- 飞书这边开的会话，能在 Web UI 的会话列表里打开并看到完整记录。

## 风险

| 风险 | 现状 |
|---|---|
| lark-cli 每次调用约 300ms | 出站降到按阶段更新之后够用，但一个回合里工具调用密集时仍可能积压。要拿真实回合量一次 |
| `event consume` 会丢事件 | 技能明确说 `--quiet` 会隐藏丢事件警告，说明存在丢的可能。桥接不加 `--quiet`，把丢事件警告记进日志 |
| 桥接自身跟着崩 | 它只依赖 node 内置和 lark-cli 子进程，不 import 任何 dsh 包。这条一旦破例，兜底就不成立 |
| CardKit 只能走 `lark-cli api` | 没有 typed command 意味着没有参数校验，请求形状写错只能在运行时发现。先用一次性脚本把建卡片和更新元素跑通再接进桥接 |
| 共用工作区导致串行 | 有意为之。排队要给明确回执，不能静默等 |
| 插件把 web 进程搞崩时 Web UI 仍会断 | 桥接只保证飞书侧有应答并把 dsh 拉回来，Web UI 在重启完成前照样不可用 |
| lark-cli 是外部工具，版本会动 | 现在钉在 v1.0.87 的行为上。它自带 `update` 命令，升级后事件形状或命令名变化会静默打断桥接 |
