# 复盘：模型中心探活连环报错（2026-08-15）

探活功能上线当天连续报红。三轮排查挖出两个我们侧的 bug、一个抽象缺口（催生了新特性），以及一批网关侧真实故障。探活本身始终如实上报——这正是它的设计目的。

## 症状时间线

1. 用户报两条红：`x-models` 探活返回 "Model \"claude-fable-5\" is not supported by any configured account in this group"；`local-gateway` 返回 "'NoneType' object has no attribute 'get'"。
2. 修复根因①后复测：所有 local-gateway 模型探活变 `NO_ADAPTER: no adapter registered for provider "local-gateway~openai-completions"`。
3. 用户把两个模型切成 anthropic-messages 协议后报：两条 `404 {"detail":"Not Found"}`。

## 根因①：供应商级 compat 透传到异协议组（我们的 bug）

机制链：把 `minimax-m3` 改成 anthropic-messages → local-gateway 变双协议供应商 → 编译出的 `local-gateway~anthropic-messages` 组继承了供应商级 `compat.thinkingFormat: deepseek` → 该开关只存在于 openai-completions 协议，llm-pi-ai 拒绝**整段**编译结果 → 注册表停在旧的裸 `local-gateway` 路由 → 探活按新文档解析出 `local-gateway~openai-completions` → 注册表里没有 → NO_ADAPTER。

定位：`getDoc.reconcileError` 横幅机制直接给出了官方拒绝文案——之前沉淀的"跨命名空间失败要回显"发挥了作用。教训是链路的下半环：reconcile 失败挂着期间，**配置文档与活注册表脱节**，此时按文档解析名字再调运行时的任何读路径都会撞上晦涩的下游错误（NO_ADAPTER），而不是真正的配置问题。

修复：`inheritedCompat` 只把供应商 compat 继承到 openai-completions 组；`resolveProbeRoutes` 先核对活注册表，未生效路由直接回 `ROUTE_NOT_LIVE` + 待处理的 reconcile 失败原因。

## 根因②：Anthropic SDK 自拼 /v1/messages，双 /v1 吃 404（抽象缺口 → `endpoints` 特性）

关键对照实验：

- `curl POST /v1/messages`（Anthropic 原生请求体）→ **200**，网关支持 Anthropic 协议；
- 探活（pi-ai anthropic-messages 适配器）→ 404；
- `curl POST /v1/v1/messages` → 404 `{"detail":"Not Found"}`，与探活错误**逐字节一致**。

读 pi-ai 源码确认：anthropic-messages 走官方 Anthropic SDK，SDK 在 baseURL 之后自己拼 `/v1/messages`；而 openai 系把 baseURL 当前缀（`{baseURL}/chat/completions`）。所以 OpenAI 风格网关（`/v1` 前缀）的两种协议端点不同，"供应商 = 一个端点"的抽象盖不住。

修复：hub 供应商新增 `endpoints` 字段按协议覆盖端点（UI 供应商弹窗加了"Anthropic 端点"输入框）。给 `local-gateway`、`x-models` 配上不带 `/v1` 的根地址后，`minimax-m3` anthropic 路由探活 ✓ 2.0s。

## 上游事实（我们改不了的部分）

- **claude-fable-5**：`/models` 列出它，但 OpenAI 路径报"组内无账号"、Anthropic 路径挂起无响应——网关侧没接好。**列出 ≠ 可服务**。
- **claude 全系**（haiku-4-5、opus-5、sonnet-5 及 -0.2 变体）：非流式 curl 全部正常返回，**`stream: true` 必现** NoneType Python 崩溃；deepseek-v4-flash 偶发。dsh 全走流式，所以这些模型对话也会挂。**非流式通 ≠ 流式通**；探活走流式能测到，这是特性不是误报。
- 同端点不同 key = 不同账号组，可用模型集合可能不同。

## 调试方法论（这次真正管用的四招）

1. **curl 对照矩阵**：怀疑"我们的代码发错请求"时，先用 curl 逐字段对齐（body 全字段、headers 全量、同一个 key）重放。这次 curl 全维度对齐后仍复现不了 404，直接证伪了"请求内容有错"，把嫌疑压到"发的不是这个请求"。
2. **请求抓包**：起一个本地 404 echo server 当供应商 baseURL，从探活链路抓 method/path/headers/body——十分钟拿到确定性证据，胜过读代码猜路径。本次用它证实了 openai 路径/凭证/请求体全部正确。
3. **进程内最小复现**：直接 import pi-ai 的 `stream` 用同样的模型描述符发请求——把"dsh 组装层"与"pi-ai/网关"切开。pi-ai 直发拿到的是真实网关错误，证明 404 产生在 dsh 组装层的路由解析（编译出的 api 字段）而非传输。
4. **文档 vs 注册表比对**：编译型插件出诡异错误时，先比对"配置文档的编译结果"与"活注册表"是否一致——`route keys` 与已注册路由名对不上就是脱节信号（本次 NO_ADAPTER）。

## 读探活结果的速查

| 现象 | 优先怀疑 |
|---|---|
| `404 {"detail":"Not Found"}`（FastAPI 风格） | URL 拼接/SDK 路径约定（如双 /v1），**不是**模型不存在 |
| `not supported by any configured account in this group` | 网关账号组没接这个模型的上游 |
| `'NoneType' object has no attribute 'get'` | 网关 Python 崩溃；先流式/非流式对照 |
| `NO_ADAPTER: no adapter registered for provider ...` | 文档与注册表脱节——看 reconcileError 横幅 |
| `ROUTE_NOT_LIVE` | 同上，但这是探活直接给出的明示 |

## 沉淀位置

- `personal/docs/plugin-guide.md` §3：compat 按协议过滤、endpoints 按协议覆盖、reconcile 失败期读路径对活注册表兜底；§6：请求抓包进调试工具箱。
- `personal/plugins/dsh-x-model-hub/README.md`：编译规则 4（端点按协议）与 5（compat 按协议）、探活的 ROUTE_NOT_LIVE 语义。
