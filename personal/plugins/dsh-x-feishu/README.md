# dsh-x-feishu — 飞书通道

把 dsh 接进飞书：单聊发一句话就干活，群里 @ 一下就接活，过程在卡片上看得见。

设计与取舍见[飞书通道笔记](../../docs/notes/proposed/2026-08-18-feishu-channel.md)。

## 两个部件

| 部件 | 跑在哪 | 干什么 |
|---|---|---|
| 插件（`src/`） | dsh 的 web profile 进程内 | 建会话、提交消息、渲染事件、答工具审批 |
| 桥接（`bridge/`） | 独立常驻进程 | 当唯一的飞书事件消费者、发消息发卡片、dsh 不在时回执并拉起它 |

桥接与 dsh 插件之间只有一条本地 socket。**socket 连着就等于 dsh 活着**，所以没有心跳文件、没有 pid 探活、没有过期阈值。桥接另开一个只读事件 relay socket，供 ZCode/Agent Bus 等本机组件复用入站事件；这些组件不得再启动 `lark-cli event consume`。

为什么要拆成两个进程：`lark-cli` 的**一个 event key 只允许一个消费者**。既然只能有一个，就让常驻的桥接从头到尾持有它，dsh 反过来当客户端，交接、互斥这些问题就都不存在了。

## 依赖

- `lark-cli`（本机已装 v1.0.87，应用与凭证配在系统 keychain）。桥接只通过它跟飞书说话，本插件自己不存任何飞书凭证。
- 插件侧只依赖 dsh 的服务与 `zod`。

## 配置

先选一条路（`access`），要填的东西差别很大：

| | `own`——用 dsh 自己的应用 | `reuse`——复用已经在跑的桥接 |
|---|---|---|
| 桥接归谁 | dsh 的 | 别人的 |
| 谁写 `~/.dsh-x-feishu/config.json` | dsh（一保存就写） | **谁都不写**，dsh 一个字都不碰 |
| 订阅名单、准入名单在哪定 | 这一页 | 桥接那边 |
| dsh 这一页要填什么 | 用哪份 profile + 准入名单 | **什么都不用填** |

复用时 dsh 就是那条 socket 上的一个消费端：连上去、收桥接给的、回话用被搭话的
那个机器人。它不报身份、不声明订阅、不配置对面——桥接订了什么就给它什么。

```yaml
# $DSH_HOME/settings.yaml
dsh-x-feishu:
  access: own           # own | reuse
  profile: ''           # dsh 自己那个飞书应用；留空 = ~/.lark-cli/dsh-x。reuse 下只影响扫码授权

  # dsh 这一侧，两条路都有
  endpoint: ''          # 连桥接的本地 socket，留空用平台默认
  presetId: standard    # 飞书开的会话用哪个 agent 预设，留空用部署默认
  density: standard     # compact | standard | detailed
  flushMs: 2500
  approvalTimeoutMs: 300000

  # 准入。默认拒绝：名单不填谁都用不了。只有 own 会写到桥接那份配置里
  dmMode: allowlist     # open | allowlist | disabled
  dmAllowlist: []       # 装 open_id
  groupAllowlist: []    # 装 chat_id，空 = 一个群都不放行
  requireMention: true
  staleMs: 600000

  probeOrigin: ''       # 桥接探这个地址判断 dsh 在不在，留空用本进程自己的地址
```

`~/.dsh-x-feishu/config.json` 里 `launch`（dsh 不在时用什么命令拉起来）和 `botOpenIds`
（每个应用的机器人 open_id 手工覆盖）永远不归设置页管，`own` 模式写的时候也原样留着。

### 出站身份跟着入站走

桥接可以同时订好几个飞书应用。事件从哪个应用进来，回它的消息、卡片就以那个应用的
身份发——这不是讲究：卡片只能由发它的那个应用改，身份错了连进度都刷不动；机器人
open_id 也是一个应用一个，拿 A 的去判 B 的 @，判出来永远是「没 @ 我」。

所以 dsh 不需要声明自己是谁：`message` / `card-action` 帧带 `source` 字段说明这句话
从哪个应用进来，桥接按会话记着，出站现查。relay 帧里也有同一个字段，别的订阅方
要回话同样得以那个应用的身份回。

### 单应用与多应用

`own` 时桥接只订 dsh 自己那一个应用，`~/.dsh-x-feishu/config.json` 由这一页写出。

`reuse` 时订阅表是桥接主人写的，可以有好几个应用——同一个群里有多个独立机器人时，
飞书只把「@某机器人」的消息投给那个机器人所属的应用，所以桥接对每个应用各持有一份
订阅，再汇进同一条 relay。同一应用 + EventKey 仍然只能有一个 consumer，而且全部归
桥接所有；别的组件连 relay，不要自己起 `lark-cli event consume`。

**注意**：桥接把过了准入的消息一律转给 socket 上那个 dsh。如果同一个应用还有别的
agent 从 relay 读并且也会回话，那一句话会被答两次——要缩范围就改桥接的订阅名单。

## 跑起来

```sh
# 1. 装依赖（个人插件不进根 workspace）
cd personal/plugins/dsh-x-feishu && pnpm install --ignore-workspace

# 2. 挂进 profile
dsh plugin --profile web add <本目录绝对路径>

# 3. 起桥接（常驻）
pnpm run bridge

# 4. 起 dsh
pnpm dsh web
```

## 检查

```sh
pnpm exec vitest run --config personal/plugins/dsh-x-feishu/vitest.config.ts
pnpm exec tsc -p personal/plugins/dsh-x-feishu --noEmit
```

个人插件不在 workspace 里，根 `tsc -b` 覆盖不到，所以类型检查得单独跑。

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
