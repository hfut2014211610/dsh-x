# @personal/dsh-x-ui-model-hub

模型中心的可视化设置页（Settings → 模型中心）：`dsh-x-model-hub` 插件的浏览器半边。供应商/模型的增删改全在页面上完成，写入即触发 hub 的路由编译，无需重启。

## 与 hub 的关系

零代码耦合，但**数据通路是 hub 插件暴露的 `modelHub/*` RPC 网关**（`TypertRemoteService` + `@Remote`，经 Typert gateway 的 SRC 回退发现，无需生成产物）：页面通过 `connection.rpc.call('/api', 'modelHub/<method>', { args })` 读写。不能用 `settings.describe/mutate` 直连——HTTP `settings.*` 表面对命名空间有白名单（`WEB_SETTINGS_NAMESPACES`，见 `packages/host/apiproxy/src/api-proxy.ts:126`），本插件的命名空间不在其列。写入仍经 settings 服务落盘并触发 hub 的路由编译；变更推送借道已转发的 `settings/document-updated` 事件（按 ns 过滤）。本包不 import hub 的任何模块。

## 页面能力

- **厂商预设**：供应商编辑器的类型下拉（DeepSeek/Kimi/MiMo/Claude/Qwen/GLM/MiniMax/GPT/Gemini/Grok/自定义）自动填好 endpoint 与名称；模型编辑器的预设下拉自动填好模型 ID、协议、容量与思考等级（数据来自 pi-ai 内置 catalog，随版本更新）。供应商带预设标记时，模型预设只列该厂商。
- **模型探活**：每个模型行的"探活"按钮对该模型的每条路由（主+降级）发真实最小请求，逐路由显示 ✓/延迟 或 ✗ 错误码+上游消息。
- 供应商：新增/编辑/删除（displayName、baseURL、**Anthropic 端点覆盖**（可选，Anthropic SDK 自拼 /v1/messages，填不带 /v1 的根地址）；**API Key 密码框直接粘贴**——网关先写凭证 seam 再在配置里记派生引用名 `<供应商键大写>_API_KEY`；高级场景可自填引用名；仍被模型引用的供应商禁止删除并点名）
- 供应商行实时显示凭证状态（已配置 ✓ / 未配置 / 引用名非法，红色可点进编辑器修复）
- 模型：新增/编辑/删除（所属供应商、协议下拉、contextWindow、maxTokens、模态、思考等级、**有序降级供应商**——增删行、↑↓ 调序；路由预览显示完整降级链 `主 → 备1 → 备2`）
- 模型行显示服务端编译的降级链；多供应商模型在其每条路由下都可单独选择
- 编译后路由名实时预览（单协议→供应商键；多协议→`供应商~协议`），加载后以服务端编译结果为准
- 弹窗按"预设 / 基本信息 / 凭证 / 能力与参数 / 降级"分组，长表单分区滚动
- **联动状态**：路由生成失败（reconcile 被拒）顶部横幅给出服务端原因；每个模型行可一键"设为默认"（写 `agent-default-model`，新会话生效），当前默认带标记
- **导入现有配置**：一键把手写的 `llm-pi-ai` 路由反推回模型中心（只增不改；内置目录路由/缺协议/缺 endpoint/endpoint 冲突/重复模型逐条列出跳过原因）
- 写入失败展示服务端校验错误文案；settings 只读部署下页面只读
- 中英文界面（跟随系统 locale）

## 构建 / 安装 / 挂载

```sh
# 构建 lib/client.js（仓库根目录，Node ^22.19 || >=24）
cd personal/plugins/dsh-x-ui-model-hub && pnpm exec tsdown

# 安装进 web profile 并自动挂载（包内 dsh.bundle 声明）
pnpm dsh plugin --profile web add D:/dev/DSH-X/personal/plugins/dsh-x-ui-model-hub
```

构建产物变更后需要重启 web 或等 HMR（客户端模块按内容 hash 供给 `/plugins/<id>/client.js`）。

**为什么必须是"安装进 profile 的包"**：client module 发现规则要求从 profile 目录的 node_modules 按包名解析 `dsh.client` 声明，file:// 路径挂载的插件不会出现在图中（`packages/client/modules/src/index.ts`）。这是它与 hub/tuning 主机插件加载方式不同的原因。

## 测试

```sh
pnpm exec vitest run --config personal/plugins/dsh-x-ui-model-hub/vitest.config.ts
```

- `tests/store.spec.ts` — 路由名规则、引用集合、store 读写与错误透出
- `tests/bundle.spec.ts` — 用 stub 模块表执行构建产物并驱动 `apply()`，验证 `settings.section` 注册装配（无需浏览器即可捕获接线错误）

## 边界（v1）

- 编辑的是 hub 编写层；headers/compat 等高级字段仍需 YAML（页面未暴露）
- tuning 采样默认值不在本页（用 `/model-tuning` 命令）
- 模型发现（`llm.discoverModels`）按钮未接
