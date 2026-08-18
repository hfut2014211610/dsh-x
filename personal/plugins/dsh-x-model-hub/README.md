# @personal/dsh-x-model-hub

模型中心布局的模型/供应商配置层：供应商与模型分开声明，**每个模型自己指定协议**——解决官方 `llm-pi-ai` "一路由一协议"的限制（其 Known Limitations 里的手工 workaround 是拆多个路由，本插件把它自动化）。

配套可视化页面：`dsh-x-ui-model-hub`（Settings → 模型中心）。两者经本插件暴露的 `modelHub/*` RPC 网关（`ModelHubGateway`，TypertRemoteService SRC 模式，零生成产物）通信——HTTP `settings.*` 表面的命名空间白名单不含本插件，页面不能直接走它。

## 闭环：配置 → 模型菜单 → 界面选择

保存即生效（settings seam 热更 → `llm/adapters-updated` → 聊天页模型选择器自动刷新），页面同时回报联动状态：

- **API Key 直接粘贴**：供应商编辑器的 API Key 输入框把密钥写进凭证 seam（`~/.dsh/.credentials.yaml`），引用名取 `apiKeyEnv`（若填）或派生的 `<供应商键大写>_API_KEY`；配置文档里永远只有引用。`apiKeyEnv` 只接受环境变量风格命名（`A-Z 0-9 _`）——把 Key 本身贴进去会被网关拒绝并提示（凭证引用经 `credentialRef` 校验，非法值会让整条路由生成失败）。
- **失败可见**：reconcile 被官方校验拒绝时，页面顶部横幅显示原因（`getDoc.reconcileError`），不再只写日志。
- **模型探活**：`probeModel(id)` 对该模型编译到的每条路由（主 + 降级）发一个真实最小请求（`maxTokens: 1` 的 "ping"，单路由 30s 上限，并行），逐路由返回 ✓/延迟 或 错误码/上游消息——凭证错、endpoint 不通、协议不匹配、模型 id 不存在都在配置时暴露，而不是对话中。探活不经 agent-loop、不进会话日志。编译路由未生效（reconcile 被拒后注册表停在旧路由）时不发请求，直接回 `ROUTE_NOT_LIVE` + 待处理的 reconcile 失败原因，而不是晦涩的 `NO_ADAPTER`。注意探活走流式——上游只在流式路径上才暴露的故障（如网关流式崩溃）也测得到。
- **厂商预设**：`listPresets` 从 pi-ai 内置 catalog **运行时派生**主流厂商预设（DeepSeek/Kimi/MiMo/Claude/Qwen/GLM/MiniMax/GPT/Gemini/Grok）——模型 id、上下文窗口、思考档位映射随锁定的 pi-ai 版本更新，零手工漂移。两个例外：Qwen 无纯厂商 builtin（手写 DashScope 兼容端点表，容量为保守值）；Gemini 的 builtin 说 `google-generative-ai`（手写路由不可声明），预设改指 Google 的 OpenAI 兼容端点。供应商条目带 `preset` 标记（自由文本，不参与编译），模型编辑器据此过滤该厂商的模型预设。
- **导入现有配置（反推）**：`importFromPiAi` 把手写的 `llm-pi-ai` 路由（settings user 层合并 composition base 层）反解回模型中心布局——`provider~api` 归并到同一供应商、按路由恢复每个模型的协议。只增不改：插件自己生成的路由（`_routes` 账本）跳过，已存在的供应商/模型不覆盖；内置目录路由（无显式 models）、缺协议/缺 endpoint、endpoint 与同名供应商冲突的路由跳过并逐条给出原因。官方 `llm-deepseek` 适配器（`deepseek-official` 路由）不在 `llm-pi-ai` 命名空间，不参与导入。
- **设为默认**：每个模型行的"设为默认"把 `agent-default-model` 指向该模型的编译路由（新会话生效；已有会话保留自己的选择）。

## 原理：配置编译器

harness 的 `provider` 路由是请求身份（贯穿会话日志、默认模型、选择器），不能改；改的是**编写层**。你写模型中心布局，插件编译成官方路由布局，经 settings seam 写入 `llm-pi-ai` 命名空间（写入即被官方 validate 校验，生效无需重启）：

```
dsh-x-model-hub 配置  ──编译──>  llm-pi-ai 路由  ──官方适配器──>  协议实现/凭证/目录/发现
（供应商 + 模型分离）            （按协议分组）                    （全部重活留在官方）
```

## 配置

```yaml
dsh-x-model-hub:
  providers:                    # 供应商 = endpoint + 凭证 + 共享默认
    my-gateway:
      displayName: 我的网关
      baseURL: http://127.0.0.1:18080/v1      # 必填
      endpoints:                              # 可选，按协议覆盖端点
        anthropic-messages: http://127.0.0.1:18080   # Anthropic SDK 会自拼 /v1/messages，要去掉 /v1
      apiKeyEnv: LOCAL_GATEWAY_API_KEY        # 凭证引用（环境变量名）
      headers: { X-Tenant: dev }              # 可选
      compat: { thinkingFormat: deepseek }    # 可选，路由级默认；只继承到 openai-completions 组
      defaultInput: [text, image]             # 可选
      defaultContextWindow: 262144            # 可选
      defaultMaxTokens: 32768                 # 可选
  models:                       # 模型 = 谁提供 + 什么协议 + 自身能力
    deepseek-v4-pro:
      provider: my-gateway              # 必填，引用 providers 的键
      api: openai-completions           # 必填：openai-completions | openai-responses | anthropic-messages
      fallbacks:                        # 可选：有序降级供应商（见下节）
        - { provider: backup-gw, api: anthropic-messages }
      contextWindow: 1000000
      maxTokens: 384000
      reasoningEfforts: { off:, high: high, max: max }
    claude-sonnet-5:
      provider: my-gateway
      api: anthropic-messages           # 同一供应商、另一协议
      input: [text, image]
```

模型条目字段与官方 `models` 条目一一对应（`name`/`contextWindow`/`maxTokens`/`input`/`reasoningEfforts`/`compat`）。

## 编译规则（确定性契约）

1. 按 `(provider, api)` 分组，每组一条官方路由。
2. 供应商只有一个协议组 → 路由名 = 供应商键（如 `my-gateway`）；多个组 → 每组 `provider~api`（如 `my-gateway~anthropic-messages`）。
3. `displayName`：单协议取供应商名；多协议取 `供应商名 · 协议名`。
4. 组端点 = `endpoints[协议]` 覆盖值，缺省回落 `baseURL`。路径约定随 SDK 而不同：openai 系把 baseURL 当前缀（`{baseURL}/chat/completions`），anthropic-messages 走 Anthropic SDK、自拼 `/v1/messages`——OpenAI 风格网关（`/v1` 前缀）开 Anthropic 协议时必须用 `endpoints` 给不带 `/v1` 的根地址，否则请求打到 `/v1/v1/messages` 吃 404（真实踩过）。
5. 供应商级 `compat`（`thinkingFormat`/`supportsReasoningEffort`）只继承到 **openai-completions** 组——这两个开关只存在于该协议，官方适配器会拒绝带了它们却没有 openai-completions 模型的路由（整段编译结果被拒，旧路由保持生效）。模型级 `compat` 不做过滤：在非 openai-completions 模型上显式设置属于配置错误，同样在写入时大声失败。
6. 路由名即请求身份（会话日志引用），规则固定。**改模型协议会改路由名，等于换了一个 provider**——已存的会话模型选择不会自动迁移。

## 按顺序降级（failover）

模型声明 `fallbacks` 后，编译器把它放进**每一条**对应路由（该模型在各路由下仍可单独选择），并派生有序链 `[主路由, ...降级路由]`。运行时由本插件的一对瀑布监听器执行降级：

1. 请求失败先走官方 `llm-retry`（base bundle 挂载在本插件之前）：当前路由花掉自己的重试预算（默认 2 次、指数退避）。
2. 预算耗尽或错误码不在路由策略内时 `next()` 委派给本插件：错误码命中降级集合（`EMPTY_RESPONSE`/`RATE_LIMIT`/`QUOTA`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`INVALID_CREDENTIAL`/`MISSING_CREDENTIAL`——凭证类错误降级有意义，因为换路由同时换凭证）且当前路由在链中未到末尾，则返回 `{kind:'retry'}` 接管恢复，并在随后的 `agent/request` 瀑布里把请求配置替换为链上下一条路由。
3. 降级在**会话内粘滞**：换路由由事件循环自己的 `request/header (reason: change)` 落日志，后续步骤以新路由为种子；新会话从所选模型重新开始。失败事实在 `llm/retry`、切换在 `request/header`，无需自定义会话事件（个人插件的事件类型不在官方 KNOWN_SESSION_EVENT_TYPES 目录里，自造事件会让会话日志在读取侧被拒）。

边界：`CONTEXT_WINDOW_EXCEEDED` 不降级（对该模型的声明容量是确定性失败）；跨适配器降级会丢 pi-ai 的 replayState（本插件编译的路由都由同一个 pi-ai 适配器实例服务，不受影响）；降级只发生在 agent-loop 的 turn 边界（流中段不做 chunk 级切换，与官方一致）。

## 所有权约定

- 插件只管理**自己生成的路由**：生成过的路由键记在 `dsh-x-model-hub._routes`（插件自维护，勿手改）。reconcile 时新增/更新 desired、`unset` 消失的，绝不碰手写路由（如你的 `local-gateway`）。
- 空配置 = 休眠：挂载但不配任何东西时，reconcile 会把账本里上次生成的路由全部回收。
- 不要手写带 `~` 的路由键——那是本插件的保留命名。
- 同一模型 id 在 `models` dict 里只能声明一次（键唯一）；要多供应商服务同一模型，用该条目的 `fallbacks`（有序），不要在官方段另写同 id 条目。
- `llm-pi-ai` 未挂载时插件报错并记日志（它依赖官方命名空间作为写入目标）。

## 与 dsh-x-model-tuning 的协同

tuning 的 key 用**编译后**的路由名。例如给上面的 Claude 模型配采样默认值：

```yaml
dsh-x-model-tuning:
  profiles:
    my-gateway~anthropic-messages/claude-sonnet-5:
      temperature: 0.7
```

## 加载与测试

```sh
# 加载（持久）：insert 行已在 ~/.dsh/profiles/web/cordis.patch.yml；临时用 --patch 覆盖层
pnpm dsh web --patch ./personal/plugins/dsh-x-model-hub/cordis.patch.yml

# 测试（仓库根目录，Node ^22.19 || >=24）：
pnpm exec vitest run --config personal/plugins/dsh-x-model-hub/vitest.config.ts
```

## 已验证

- 单测 63/63（schema、编译规则与 compat 协议过滤、降级链派生、reconcile 差分与所有权账本、反推导入 plan、凭证引用派生与校验、failover 路由决策、catalog 预设派生、探活结果映射与未生效路由判定）。
- e2e：双协议配置生成 `hub-gw~openai-completions` + `hub-gw~anthropic-messages` 两条路由并持久化；真实请求经 `hub-gw~openai-completions/kimi-k3` 成功返回；空配置 reconcile 自动回收全部生成路由。
- 联动 e2e：页面配置供应商（粘贴 API Key）+ 模型后，`llm-pi-ai` user 层即时出现编译路由（凭证引用合法化后），凭证值落在 `~/.dsh/.credentials.yaml`。
- 降级 e2e（headless profile）：主路由 `dead-gw`（死端口）以 `TRANSPORT` 失败 → `llm-retry` 按预算重试 2 次 → 本插件接管降级到 `local-gateway` → 会话日志含 `request/header reason:change` 且助手正常作答；测试后探针已清理。
- 探活 e2e：`kimi-k3@local-gateway` ✓（2–4s）；错误模型 id ✗ 2s 返回上游 404 文案；网关挂起的模型 ✗ 按超时上限中止——三类配置问题都在配置时可见。
- 预设 e2e：`listPresets` 在线返回全部 10 家厂商（DeepSeek/Kimi/MiMo/Claude/Qwen/GLM/MiniMax/GPT/Gemini/Grok）的端点与模型表。
