# @deepseek-ai/dsh-feishu

[English](README.md) | 中文

把 dsh 接进飞书：单聊发一句话就干活，群里 @ 一下就接活，过程在卡片上看得见。

设计与取舍见[飞书通道笔记](../../../personal/docs/notes/proposed/2026-08-18-feishu-channel.md)。

## 两个部件

| 部件 | 跑在哪 | 干什么 |
|---|---|---|
| 插件（`src/`） | dsh 的 web profile 进程内 | 建会话、提交消息、渲染事件、答工具审批 |
| 桥接（`src/bridge/`） | 独立常驻进程 | 当唯一的飞书事件消费者、发消息发卡片、dsh 不在时回执并拉起它 |

桥接与 dsh 插件之间只有一条本地 socket。**socket 连着就等于 dsh 活着**，所以没有心跳文件、没有 pid 探活、没有过期阈值。桥接另开一个只读事件 relay socket，供 ZCode/Agent Bus 等本机组件复用入站事件；这些组件不得再启动 `lark-cli event consume`。

为什么要拆成两个进程：`lark-cli` 的**一个 event key 只允许一个消费者**。既然只能有一个，就让常驻的桥接从头到尾持有它，dsh 反过来当客户端，交接、互斥这些问题就都不存在了。

## 依赖

- `lark-cli`（本机已装 v1.0.87，应用与凭证配在系统 keychain）。桥接只通过它跟飞书说话，本插件自己不存任何飞书凭证。
- 插件侧只依赖 dsh 的服务与 `zod`。

## 配置

一切都在 dsh 的「设置 → 连接器 → 飞书」，或者等价的 `$DSH_HOME/settings.yaml`。桥接自己没有界面，它那份 `~/.dsh-x-feishu/config.json` 由插件写出，只读、并且盯着文件变——改完不用重起桥接。

第一个问题是**接没接入**（`mode`）。还没接的时候卡片上只有两条路：

| | `direct`——用 dsh 自己的飞书应用 | `bridge`——第三方桥接 |
|---|---|---|
| 要填什么 | 一个 profile 名（默认 `dsh`） | app id + 替代 `lark-cli event consume` 的命令 |
| 怎么接完 | 扫码授权 | 填完就算 |
| 谁持有事件订阅 | 桥接自己 spawn lark-cli | 你给的那条命令 |
| 推荐 | 是 | 高级用法，一般用不上 |

接好之后卡片只摆状态和两个动作（重新注册、注销配置），会话设置默认折起来。

```yaml
# $DSH_HOME/settings.yaml
dsh-x-feishu:
  mode: direct          # '' not connected | direct | bridge
  profileId: dsh        # direct: which lark-cli profile, at ~/.lark-cli/dsh
  appId: ''             # bridge: which Feishu app those events belong to
  eventCommand: ''      # bridge: the command replacing `lark-cli event consume`

  # Session settings (folded away on the card)
  workspace: ''         # where Feishu sessions run; empty means $DSH_HOME/feishu
  presetId: standard    # which agent preset; empty uses the deployment default
  density: standard     # compact | standard | detailed
  flushMs: 2500
  approvalTimeoutMs: 300000
  endpoint: ''          # local socket to the bridge; empty uses the platform default

  # Who can reach it. Deny by default: an empty list admits nobody
  dmMode: allowlist     # open | allowlist | disabled
  dmAllowlist: []       # open_ids
  groupAllowlist: []    # chat_ids; empty admits no group at all
  requireMention: true
  staleMs: 600000
```

`~/.dsh-x-feishu/config.json` 里 `launch`（dsh 不在时用什么命令拉起来）和 `botOpenIds`（每个应用的机器人 open_id 手工覆盖）不归设置页管，写的时候原样留着。`mode` 还是空的时候一个字都不写——什么都没定，写下去只会让桥接按一份空配置起来。

### 会话落在哪

`workspace` 留空时会话跑在 `$DSH_HOME/feishu`。那不是一个注册过的工作区，所以这些会话出现在「未分组」下——一条从聊天软件进来的消息，默认不该往你手上的项目里写东西。要它进某个项目，把那个目录填进去。

### 第三方桥接怎么接

`eventCommand` 替代的是桥接原本要跑的 `lark-cli event consume <key> --as bot`。桥接会把事件键追加在你那条命令后面，整条交给 shell 跑，然后按行读 stdout 的 NDJSON。别的进程已经独占了那个 EventKey 时用它把事件引过来——一个 EventKey 只允许一个消费者。

出站还是走 lark-cli：`appId` 用来在本机找回对应的 profile，回话、发卡片都以那个应用的身份发。事件从哪个应用进来，回它的就是谁——卡片只能由发它的那个应用改，身份错了连进度都刷不动。

## 跑起来

Web bundle 默认挂载本包，所以只剩桥接要自己起——它是常驻进程，持有本机唯一的那份飞书事件订阅：

```sh
# From a checkout
node --import tsx/esm packages/channel/feishu/src/bridge/main.ts

# Once installed
dsh-feishu-bridge
```

## 检查

```sh
pnpm exec vitest run packages/channel/feishu
```

## 真实凭证验收

已用 `lark-cli` v1.0.87 和真实群聊打通这些 raw escape hatch：

- 发消息：`POST /open-apis/im/v1/messages?receive_id_type=chat_id`，`--params` 传查询参数，`--data` 传 `{ receive_id, msg_type, content }`；`content` 是完整消息 JSON 的字符串。
- 回复：`POST /open-apis/im/v1/messages/:message_id/reply`，成功响应的消息 ID 固定取 `data.message_id`。
- 更新卡片：`PATCH /open-apis/im/v1/messages/:message_id`，body 是 `{ content }`，其中 `content` 是完整卡片 JSON 的字符串。
- 机器人身份：`GET /open-apis/bot/v3/info` 的原始响应固定取 `bot.open_id`。这里必须用 `--format ndjson` 保留原始形状；v1.0.87 的 `--format json` 会把该响应规整成空的 `data`。
- 按钮回调：事件 schema 的字段是顶层 `action_value`，值是开发者定义对象的 JSON 字符串，不是 `action.value`；桥接会解析成原对象后再路由审批或停止动作。

`event consume` 不加 `--quiet`，避免隐藏丢事件告警；真实丢失率仍需靠常驻日志长期观察。

## 已经量过的数

`lark-cli` 冷启动五次：339 / 361 / 291 / 343 / 282 ms。**约 300ms 一次**，这就是卡片按阶段更新而不是逐字流式的原因——逐字要 200–500ms 一帧，光进程启动就吃满了。
