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

插件（`$DSH_HOME/settings.yaml`）：

```yaml
dsh-x-feishu:
  endpoint: ''          # 留空用平台默认：win32 命名管道 / POSIX unix socket
  presetId: standard    # 飞书开的会话用哪个 agent 预设，留空用部署默认
  density: standard     # compact | standard | detailed
  flushMs: 2500         # 卡片正文最少隔多久推一次
  approvalTimeoutMs: 300000
```

桥接（`~/.dsh-x-feishu/config.json`）：

```json
{
  "eventEndpoint": "\\\\.\\pipe\\dsh-x-feishu-events",
  "policy": {
    "dmMode": "allowlist",
    "dmAllowlist": ["ou_你的open_id"],
    "groupAllowlist": ["oc_群id"],
    "requireMention": true
  },
  "botOpenId": "",
  "probeOrigin": "http://127.0.0.1:13080",
  "launch": { "command": "pnpm", "args": ["dsh", "web"], "cwd": "D:/dev/DSH-X" }
}
```

**默认拒绝**：名单不填，谁都用不了。`botOpenId` 留空时桥接启动会向飞书问一次；问不到就要手填，否则群里的 @ 判定会全部落空。

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
