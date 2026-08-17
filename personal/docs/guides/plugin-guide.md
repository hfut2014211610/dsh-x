# dsh-x 插件开发指南

本文沉淀在 DeepSeek Harness fork（DSH-X）上开发个人插件的完整方法，来自 `dsh-x-model-tuning`、`dsh-x-model-hub`、`dsh-x-ui-model-hub` 三个插件的实战经验。所有个性化代码放 `personal/`（上游永不新增该顶层目录，fork 合并永远 fast-forward）。

## 1. 两类插件与加载方式

| | host 插件（逻辑在 Node 侧） | client module（浏览器 UI） |
|---|---|---|
| 形态 | cordis 插件（`apply(ctx)`） | cordis 插件 + 预构建浏览器 bundle |
| 装载 | `dsh plugin --profile web add <绝对路径>` | 同左，但另有硬性发现规则 |
| 构建 | 无需构建（tsx 源码直载） | 必须 `tsdown` 产出 `lib/client.js` |
| 例子 | dsh-x-model-tuning、dsh-x-model-hub | dsh-x-ui-model-hub |

**关键约束**：client module 由宿主按**包名**从 profile 目录（`~/.dsh/profiles/web`）的 node_modules 解析 `dsh.client` 声明，所以 UI 插件必须 install 进 profile 并以包名挂载；file:// 路径挂载的插件不会被发现为 client module。host 插件两种挂法都行，但**统一用包名挂载**——插件清单页的显示名从 cordis 行的 `name` 派生（去 scope、剥 `dsh-` 前缀），file:// 路径会原样上屏。

**命名规范**：包名 `@personal/dsh-x-<功能>`（UI 包 `@personal/dsh-x-ui-<功能>`）；cordis 行 `id` 用 `dsh-x-<功能>`；settings 命名空间同名。清单页显示为 `x-<功能>`（`dsh-` 被剥除，官方包同样如此）。

## 2. 每个包的最小文件清单

```
personal/plugins/dsh-x-<name>/
├── package.json       # name/type/exports/dsh.bundle（自挂载声明）
├── cordis.patch.yml   # bundle patch：以包名 insert 自身（dsh plugin add 后自动挂载）
├── src/index.ts       # 插件本体
├── tests/*.spec.ts
├── vitest.config.ts   # tsconfigPaths 指向根 tsconfig.base.json
└── .gitignore         # node_modules/、*.tsbuildinfo
```

`package.json` 要点：

```json
{
  "name": "@personal/dsh-x-<name>",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-x-<name>
      name: '@personal/dsh-x-<name>'
```

**不要**把包加进根 `pnpm-workspace.yaml`/`package.json`（上游文件）——`@deepseek-ai/*` 导入经根 tsconfig paths 解析到源码，与宿主共享模块实例。

## 3. host 插件写法

### 骨架与配置

```ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-x-<name>'

export interface Config { /* ... */ }
export const Config = z.object({ /* ... */ }) as unknown as z<Config>

export function apply(ctx: Context, config: Config): void {
  // ctx.on / ctx.inject / ctx.commands.register / ctx.plugin(...) —— 全部经 ctx 注册，卸载自动清理
}
```

### schemastery 陷阱（都踩过）

- **缺失的数组/对象字段会被物化**为 `[]` / `{}`，不是 `undefined`。"无意见"与"空值"靠长度/字段存在性区分（如 `stop.length > 0` 才应用）。
- 可选标量（number/string）缺失保持 `undefined`。
- schema 的对象类型推导会给成员标 `| null`：接口注解对不上时用官方同款 `as unknown as z<Config>` 逃逸。
- 需要"未声明即继承"语义的 dict（如 reasoningEfforts），用 `z.union([z.const(false), dict])` 防止物化。

### settings 命名空间（要持久化+热重载的配置）

用官方助手 `installSettingsSection(ctx, NS, Config, entryConfig, { validate, setSource, onChange })`（`@deepseek-ai/dsh-settings`）：cordis patch 的 `config:` 是组合基座，`settings.yaml` 的同名段是用户层，按 key 合并，改动热生效。`validate` 用于跨字段校验——**非法配置在写入时被拒**，这是官方语义，别自己做静默兜底。

### 凭证（API Key 等秘密值）

- 配置文档里只放**引用**（环境变量风格命名，`/^[A-Za-z_][A-Za-z0-9_]*$/`）；值由凭证 seam 管理：注入 `credentials` 服务后用 `ctx.credentials.set(credentialRef(ref), value)` / `describe(ref)` / `unset(ref)`（`@deepseek-ai/dsh-credentials`），本地落盘 `~/.dsh/.credentials.yaml`，消费方每次操作时 `resolve`（改密钥免重启）。
- **教训（真实踩过）**：用户会把 Key 本体贴进"引用名"字段。你自己命名空间的 schema 放行任意字符串，但 `role('credential-ref')` 的校验在**编译目标命名空间**（如 `llm-pi-ai`）拒绝它 → 页面显示保存成功、路由却永远生成不出来。对策：网关在写目标命名空间前用 `credentialRef()` 预检并返回明文错误；表单提供密码输入框代存凭证、自动派生引用名 `<供应商键大写>_API_KEY`（参考 dsh-x-model-hub 的 `prepareProviderEntry` / `deriveKeyRef`）。
- 顺序：先 `credentials.set` 再写配置文档——写文档触发的 reconcile 紧接着就要解析这个引用。

### 跨命名空间写入的失败要回显到 UI

往别的插件的命名空间写配置（典型：编译输出）会被对方的 `validate` 拒（`settings-rejected`）。写在 `onChange` 链路上时，catch 里只打日志 = UI 永远显示"保存成功但什么都没发生"（真实踩过）。把最近一次失败记到模块级状态，让 `getDoc` 类读接口带出来，页面顶部挂横幅。

- 失败挂着期间，**活注册表停在旧状态、与配置文档脱节**：凡是按文档解析出名字再去调运行时的读路径（如探活按编译路由名发请求），都要先对活注册表（`ctx.llm.listProviders()`）核对，对未生效的名字直接回"未生效 + 待处理的失败原因"，否则用户看到的是下游抛出的晦涩错误（如 `NO_ADAPTER`），而不是真正的配置问题（参考 dsh-x-model-hub 的 `resolveProbeRoutes`，真实踩过）。
- 编译输出要**按接收方的校验规则过滤继承字段**，不能整张供应商默认表透传到每条派生路由：llm-pi-ai 的 `compat.thinkingFormat`/`supportsReasoningEffort` 只存在于 openai-completions，透传到 anthropic-messages 组会让整段编译被拒（真实踩过）。
- **端点路径约定随 SDK 而不同**：openai 系把 baseURL 当前缀（`{baseURL}/chat/completions`），Anthropic SDK 会自己在 baseURL 后拼 `/v1/messages`。同一网关开两种协议时端点往往不同（如 OpenAI 在 `/v1`、Anthropic 在根），所以"供应商 = 一个端点"的抽象需要按协议覆盖出口（dsh-x-model-hub 的 `endpoints` 字段）；直接把带 `/v1` 的 baseURL 给 anthropic 路由会打成 `/v1/v1/messages` 吃 404（真实踩过，完整复盘见 [postmortem-2026-08-15-model-hub-probe.md](postmortem-2026-08-15-model-hub-probe.md)）。

### 事件

- waterfall 监听器**必须 `await next()`** 再返回替换值；直接 return 会短路整条链。
- 改 LLM 请求配置（provider/model/temperature/...）的正统拦截点是 `agent/request`；`llm/stream` 的请求已深冻结且有不变量校验，不能改。
- 请求失败恢复的正统挂点是 `agent/request-error`：返回 `{kind:'retry'}` 且不调 `next()` = 接管恢复；调 `next()` = 委派下游。跨供应商降级 = 该事件决策 + `agent/request` 在重发尝试上替换 provider（参考 dsh-x-model-hub）。监听器按挂载序执行：base bundle 的 llm-retry 先花当前路由的重试预算，耗尽才轮到你。
- **个人插件不要自造会话事件类型**：读侧只认生成的 `KNOWN_SESSION_EVENT_TYPES` 目录（packages/core/session/src/known-event-types.ts，由 scripts/gen-persistence-catalog.ts 生成，不扫 personal/），未知且非 `ignorable` 的事件会让整份会话日志在读取侧被拒；而 `session.append` 没有打 ignorable 标记的入口。用现有事件承载事实（`llm/retry` 记失败、`request/header reason:change` 记路由切换）。
- `ctx.inject(['service'], cb)` 处理可选依赖；**inject 纤维的错误被框架收容**——重要的初始化失败要自己 `ctx.logger.error`，别指望启动中止。
- pi-ai 凭证语义（影响错误码）：`apiKeyEnv` 省略 → 交给 pi-ai 环境自发现，自定义路由会以 `PI_AI_ERROR`（"No API key for provider"）失败；引用已设置但解析不出值 → `MISSING_CREDENTIAL`；值格式非法 → `INVALID_CREDENTIAL`。做降级/诊断时三类码要分开对待。

### 向浏览器暴露 RPC（TypertRemoteService）

HTTP `settings.*` 表面对命名空间有白名单（`WEB_SETTINGS_NAMESPACES` + LLM 供应商目录注册的空间），第三方命名空间一律 `settings-not-exposed`。插件自己的数据通路 = TypertRemoteService 子类：

```ts
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export class MyGateway extends TypertRemoteService {
  static inject = ['settings']
  constructor(ctx: Context) { super(ctx, 'myNs') }   // wire 命名空间

  @Remote('getDoc')
  getDoc() { /* 返回 JSON-safe plain object */ }

  @Remote('saveThing')
  async saveThing(key: string, value: unknown) { /* ... */ return { ok: true } }
}
// apply 里：ctx.plugin(MyGateway)
```

- Typert gateway 的 SRC 回退会从活跃 Service 自动发现 `@Remote` 方法，**无需 typert 生成产物**。
- 方法签名约束：简单标识符参数（禁解构/默认值/rest）；参数名避开 `agent`/`session`（会命中 lookup 解析）；末参名 `signal` 自动成为 AbortSignal。
- 浏览器调用：`connection.rpc.call('/api', 'myNs/getDoc', { args: {} })`。
- 推送：自定义事件名要登记进上游白名单（不可改）——**借道 `settings/document-updated`**（写入经 settings 服务即自动发出，按 ns 过滤订阅）。

## 4. client module（新增设置页）

### package.json 额外声明

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings",
                 "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-api-remotes"]
    },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

### 构建

`tsdown.config.ts` 复用官方 preset（banner 包装、平台 externals、CSS Modules 注入全都有了）：

```ts
import { clientBundle } from '../../../packages/client/tsdown.client.ts'
export default clientBundle('@personal/dsh-x-ui-<name>', ['src/index.ts'])
```

`cd personal/plugins/dsh-x-ui-<name> && pnpm exec tsdown` → `lib/client.js`。React/`ui-primitives`/`cordis` 等是宿主供给的 external，**单实例**；其余依赖一律 inline。禁止跨插件 `@deepseek-ai/*` 值导入（纯度门，构建期报错）——跨插件协作走 cordis 服务或 RPC。

### 浏览器半边

```ts
export const inject = ['slots', 'locale', 'connection', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), '...')   // 词典
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new MyStore(connection.rpc)                  // 数据层
  const useSnapshot = bindSnapshotSelector(controller.store)      // uSES hook
  ctx.slots.inject('settings.section', () => ctx.slots.register({ // 等插槽声明
    name: 'settings.section', id: 'my-page', order: 20,
    label: () => t('nav'), inject: () => ({ controller, useSnapshot, t }),
  }, MySection))
}
```

要点：

- **插槽**：整页用 `settings.section`（list 型，id/order/label）；单行偏好用 `settings.general.item`。注册组件 props = inject 面的扁平展开（`Partial<Injected>`）。
- **store**：`createSnapshotStore`（来自 `@deepseek-ai/dsh-client-runtime/client`，平台豁免 external）+ `getSnapshot/subscribe/update`；React 侧 `bindSnapshotSelector` 绑成 `useSnapshot(s => s)`。
- **组件库**：`dsh-client-ui-primitives`（Button/Input/Modal/Pill/Menu…）直接用；样式 CSS Modules + `--dsw-alias-*` token；禁 Tailwind。`Modal` 的完整形态：`description` + `className`（宽度）+ `contentClassName`（`max-height`+`overflow-y:auto` 滚动区）+ `footer`（动作按钮）。
- **编辑器常驻挂接时用 `key` 强制重挂载**（`key={editingId ?? 'new'}`），否则上次的表单状态残留。
- 数据层假设错配时必须落入显式错误态——**绝不允许停在"加载中"**（踩过：describe 信封结构臆测导致永久 loading）。

### 验证

- `curl http://127.0.0.1:13080/plugins/@personal%2Fdsh-x-ui-<name>/client.js` → 200
- 首页 HTML 的 `__DSH_BOOT__` 含本条目；服务启动日志无 AggregateError
- bundle 冒烟测试：stub `window.__ModuleLoader__` + require 表执行产物，驱动 `apply()` 断言插槽注册（见 `dsh-x-ui-model-hub/tests/bundle.spec.ts`）

## 5. 测试

```sh
pnpm exec vitest run --config personal/plugins/dsh-x-<name>/vitest.config.ts
```

- vitest.config.ts 用 `tsconfigPaths({ projects: ['../../../tsconfig.base.json'] })`（`@deepseek-ai/*` → 源码），`root` 指向包目录。
- 用了 `@Remote` 装饰器的包，加 `standardDecoratorPlugin()`（从根 `vitest.shared.ts` 导入）。
- 纯逻辑（schema、编译、diff、form→ops）直接单测；ctx 交互用手写 fake（settings capture / rpc capture）。
- `tsc -p` 会对 vendor/cordis 源码报与插件无关的诊断（仓库按 project-references 分面编译），不做门禁；vitest 是门禁。

## 6. 调试工具箱

- **请求抓包**：怀疑"客户端发的请求有错"却比对不出来时，起一个本地 404 echo server（二十行 Node，记录 method/path/headers/body）当供应商 baseURL，让被测链路把真实请求发过来——比读代码猜路径快一个量级。配套手法：curl 逐字段对照矩阵（body/headers/key）、进程内最小复现（直接 import pi-ai 的 `stream` 切开 dsh 组装层与传输层）、编译型插件比对"文档编译结果 vs 活注册表"。完整案例见 [postmortem-2026-08-15-model-hub-probe.md](postmortem-2026-08-15-model-hub-probe.md)。

- **会话日志**：`node --import tsx/esm personal/scripts/dump-session.ts <session.jsonl.zstd> [事件类型]`——`.zstd` 是分帧拼接格式，Node 内置解压只读首帧。
- **组合树**：`pnpm dsh --profile web --dump-config` 看插件行是否真在树里。
- **RPC 直探**：`curl -X POST http://127.0.0.1:13080/api/<ns>/<method> -d '{"type":"client-request","rpcId":"<uuid>","method":"<ns>/<method>","payload":{"args":{}}}'`（HTTP 路径是 channel/endpoint 两段）。
- **一次性 LLM 调用（探活/小任务）**：直接 `for await (const chunk of ctx.llm.stream(options))`——失败不抛出，落在终态 `finish` chunk（`reason.kind === 'error'|'aborted'` 带 `failure.code/message`）；用 `createUserMessage`（`@deepseek-ai/dsh-llm`）组消息，`AbortSignal.timeout` 限时。参考 dsh-x-model-hub 的 `probeRoutes` 与官方 session-title-llm。
- **读 pi-ai 内置 catalog**（厂商预设数据源）：`@deepseek-ai/dsh-llm-pi-ai/src/catalog.ts`（包 exports 有 `./src/*`，tsconfig.base.json 的 paths 加一条 `"@deepseek-ai/dsh-llm-pi-ai/src/*"` 映射即可类型解析）。模型条目带 `thinkingLevelMap`（精确的档位映射，别自己猜）。手写路由只能声明 openai-completions/openai-responses/anthropic-messages 三种协议——catalog 里说其他协议的厂商（如 google-generative-ai）要改指其 OpenAI 兼容端点。
- **探针日志**：host 插件里临时 `console.error('[probe] ...')`，重启 web 看 `/tmp` 日志——比猜快。用完即删。
- **headless 验证请求面**：`pnpm dsh --profile headless "<task>"` + dump-session 查 `request/header`。

## 7. 环境坑（这台机器）

- Node 必须 `^22.19 || >=24`：22.14 的 `lstatSync` dev 恒为 0，lefthook 安装器必失败（用 `CI=true pnpm install` 跳过，或升级 Node）。
- lefthook 安装器留下 stale 锁 `.git/dsh-lefthook-install.lock` 时，`pnpm dsh web` 这类脚本会在依赖自检的 postinstall 阶段直接挂掉（报 lock 路径）——删掉该文件再跑。
- pnpm 要全局装一份（`npm i -g pnpm@11.7.0`）：pnpm 11 运行脚本前会做依赖检查并 spawn 裸 `pnpm`。
- Windows 上 file:// 挂载插件路径必须写 `file:///D:/...` URL 形式（ESM import 不认盘符路径）。
- UI 包要严格 tsc 检查：root node_modules 没有 react——给插件 `node_modules` 建 junction 指到 `packages/client/ui-primitives/node_modules` 的 `react`/`react-dom`/`@types/*`（参见 dsh-x-ui-model-hub/tsconfig.check.json 的姿势，css-module 的 Record 索引要关 `noUncheckedIndexedAccess`）。

## 8. 新插件落地检查清单

1. 先查官方有没有（`docs/architecture.md` "Where new behavior goes"、config-catalog）——别重造
2. 骨架四件 + `dsh plugin add` 挂载
3. host 逻辑 + 单测绿
4. （有 UI 才做）client module：bundle 构建 → 路由 200 → 冒烟测试 → 页面目视
5. README 更新 + `personal/README.md` 清单同步
