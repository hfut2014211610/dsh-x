# Agent Note: dsh-x-wireframe 原型图插件

Status: rejected — 技术前提被逐条推翻，由 [UED 模式](../proposed/2026-08-18-ued-mode.md) 取代

原始草稿日期 2026-08-17，作者 chenyj23489。2026-08-18 废弃。

## 废弃原因

三条核心技术前提在提出后一天内全部失效，保留原方案会误导实现：

| 原方案假设 | 实际情况 |
|---|---|
| 需要自定义 `WireframeDoc` JSON schema 作为中间表示 | 借鉴 [Open Design](https://github.com/nexu-io/open-design)（Apache-2.0，88k stars）的做法，产物直接是自包含 HTML。模型写 HTML 是它最擅长的事，不需要发明中间表示 |
| 需要手写 `store.ts` 实现 CRUD 与 `version` 乐观锁 | `ctx.documents`（`packages/writing/`，2026-08-17 落地）已提供版本守卫编辑与 workspace 包含性检查。`documents-local` 的 `formatOf()` 无扩展名白名单，`.html` 落入 `'code'` 分支，五个 `document_*` 工具原样可用 |
| 需要 `render-svg.ts` 的 Node/React 双实现渲染 11 种节点类型 | HTML 产物由浏览器渲染，整个渲染器连同「坐标重叠」「viewport 溢出」这一类风险一起消失 |

此外原方案未考虑迭代修改的并发形态——自然语言改设计是短频快的，需要主会话分线程并发执行，这要求 `tool-subagent` 与冲突策略，属于原方案完全没有覆盖的维度。

**仍然成立、已被新方案继承的部分**：agent tools 的接口形态、`/wireframe` 命令语法、Settings 页布局草图（作为新方案 C 阶段的备选）、以及「单用户个人工具、不做 workspace 隔离」这一定位判断。

以下为原文，仅供追溯，不代表当前计划。

---

## 问题

dsh 无法从自然语言描述产出 UI 线框原型。需要画原型的用户只能切到外部工具，手工把想法翻译成图形，再把结果带回会话——模型既看不到原型，也无法按指令修改它。

核心需求是 UI 线框图；流程图与思维导图（Mermaid）作为可选延伸，不进入第一版范围。

## 提案

新增两个个人插件：host 侧 `@personal/dsh-x-wireframe` 负责生成、存储、渲染与导出，client 侧 `@personal/dsh-x-ui-wireframe` 在 Settings 页提供实时预览。

### 数据模型

自定义 JSON Schema 描述原型文档：

```typescript
interface WireframeDoc {
  id: string            // nanoid(8)
  name: string
  version: number       // 乐观锁版本号，每次写入递增；store.ts 写入前校验，过期写入返回 STALE_VERSION
  createdAt: string     // ISO 8601
  updatedAt: string
  screens: Screen[]
}

interface Screen {
  id: string
  name: string
  viewport: { width: number; height: number }  // 375=移动, 1440=桌面
  nodes: WireNode[]
}

type WireNode =
  | NavbarNode | ButtonNode | InputNode | TextNode
  | ImagePlaceholderNode | ContainerNode | CardNode
  | CheckboxNode | SelectNode | TabsNode | BadgeNode

interface BaseNode {
  id: string; type: string
  x: number; y: number; width: number; height: number
  label?: string
  style?: {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    filled?: boolean
    fontSize?: number
  }
  children?: WireNode[]
}
```

存储路径 `~/.dsh/wireframes/<id>.json`，导出路径 `~/.dsh/wireframes/exports/<name>-<id>.<ext>`。

### 渲染：同构 SVG

Node.js 侧 `render-svg.ts` 产出 SVG 字符串写文件；浏览器侧 `WireframeRenderer.tsx` 产出 React SVG 组件做实时预览。两侧共用节点几何映射逻辑，不引入外部渲染依赖。

各节点类型的渲染规则：

| 节点类型 | 渲染形态 |
|---|---|
| `button` | `<rect rx=4>` + `<text>`，filled=`#444`，ghost=空心+虚线边框 |
| `input` | `<rect>` + placeholder `<text>` + 底部下划线 |
| `navbar` | 顶部全宽横条 + logo 占位 + nav items `<text>` |
| `image` | `<rect>` + 两条对角线（标准占位符 ✕）+ `<text>` label |
| `card` | 圆角 `<rect>` + 阴影模拟（偏移实心 rect）+ children |
| `container` | 虚线 `<rect>` + 左上角 label |
| `text` | `<text>` 直接渲染，支持 `fontSize`/`fontWeight` |
| `checkbox` | 小方块 + 勾选态 `<path>`（✓）+ label |
| `select` | `<rect>` + label + 右侧下拉箭头 `▾` |
| `tabs` | 一排 `<rect>` tabs，active tab 底部蓝线 |
| `badge` | 圆角 pill `<rect>` + `<text>`，小尺寸 |

颜色统一走灰度（`#111` 主文字、`#666` 次要、`#ccc` 边框、`#f5f5f5` 背景块），导出时以 `--color` 切换彩色主题。

### 包拓扑

```
personal/plugins/
├── dsh-x-wireframe/        # host 插件（Node.js 侧）
│   ├── package.json
│   ├── cordis.patch.yml
│   └── src/
│       ├── index.ts         # apply()：注册命令 + tools + RPC gateway
│       ├── schema.ts        # WireframeDoc schemastery/zod schema + 验证
│       ├── llm.ts           # LLM 生成/修改（system prompt + few-shot）
│       ├── render-svg.ts    # WireframeDoc → SVG 字符串
│       ├── export.ts        # 写 SVG/HTML 到本地文件
│       └── store.ts         # CRUD（~/.dsh/wireframes/）
│
└── dsh-x-ui-wireframe/     # client module（浏览器侧）
    ├── package.json
    ├── cordis.patch.yml
    ├── tsdown.config.ts
    └── src/
        ├── index.ts         # host 半边占位
        └── client/
            ├── index.ts              # apply()：注册 settings.section
            ├── store.ts              # createSnapshotStore + RPC 调用
            └── components/
                ├── WireframeList.tsx
                ├── WireframeViewer.tsx
                └── WireframeRenderer.tsx   # SVG React 组件
```

命名规范：

| 项目 | 值 |
|---|---|
| host 包名 | `@personal/dsh-x-wireframe` |
| UI 包名 | `@personal/dsh-x-ui-wireframe` |
| cordis id | `dsh-x-wireframe` / `dsh-x-ui-wireframe` |
| settings 命名空间 | `dsh-x-wireframe` |
| Settings 显示名 | `x-wireframe` |

### 模型接口

Agent tools（模型自动调用）：

```typescript
wireframe_generate(description: string, viewport?: 'mobile' | 'desktop'): { id: string; name: string }
wireframe_modify(id: string, instruction: string): { id: string }
wireframe_add_screen(id: string, screenDescription: string): { screenId: string }
wireframe_export(id: string, format: 'svg' | 'html'): { path: string }
```

`/wireframe` 命令（手动调用）：

```
/wireframe new <描述>              # 生成新原型图
/wireframe edit <id> <修改指令>    # 修改已有原型图
/wireframe list                    # 列出所有原型图
/wireframe export <id> [svg|html]  # 导出到文件
/wireframe show <id>               # 在终端输出节点树摘要（类型、坐标、label），不渲染 SVG
```

**结构化输出。** `wireframe_generate` / `wireframe_modify` 经 `ctx.llm.tool_call` 以 `WireframeDoc` JSON Schema 约束输出，模型被强制调用 `output_wireframe(doc: WireframeDoc)`，`llm.ts` 直接拿到已验证对象，消除正则提取歧义。

**调用参数。** 模型 `deepseek-chat`（结构生成足够，避免 reasoning 模型的高延迟）；temperature `0.2` 降低坐标随机性；max_tokens `4096`（中等复杂度单屏约 1500–2500 token，多屏预留）。

**System prompt。** 内嵌精简 TypeScript 接口（不含注释）加 3 个 few-shot 示例（登录页 / 列表页 / 表单页）。修改指令附原始 JSON 与指令，整体替换输出——不做 patch，避免模型在复制中丢失未修改节点。

**重试。** `schema.ts` 验证失败时把结构化错误拼入下一轮重试，最多 2 次；两次均失败以 `WIREFRAME_SCHEMA_ERROR` 返回可读错误并附原始模型输出供调试。

### Settings 页与导出

```
Settings > 原型图
┌─────────────────────────────────────────────────────────────────┐
│ 原型图                                              [+ 新建]    │
├──────────────┬──────────────────────────────────────────────────┤
│ ○ 登录页面   │  登录页面                 [导出SVG] [导出HTML]   │
│ ○ 注册流程   │  Screens: [主屏▾] [弹窗] [+]                    │
│ ● 主页布局   │  ┌────────────────────────────────────────────┐  │
│              │  │                                            │  │
│              │  │      [SVG 线框图实时渲染]                  │  │
│              │  │                                            │  │
│              │  └────────────────────────────────────────────┘  │
│   [删除]     │  viewport: 375×667    节点数: 12              │
└──────────────┴──────────────────────────────────────────────────┘
```

SVG 导出含完整 `viewBox` 与基础字体声明（`font-family: system-ui, sans-serif`）；多 Screen 生成多个 SVG 文件或以 `--multi=stack` 拼接长图。HTML 导出为单文件，内联 SVG 加简单 JS 切换 Screen 标签，无外部依赖。

## 备选方案

格式选型上比较过三种，选自定义 JSON：

| 方案 | LLM 友好度 | bundle 体积 | 修改精确性 | 结论 |
|---|---|---|---|---|
| draw.io XML | ✗ 冗长嵌套 | ~外部依赖 | ✗ 难 diff | 弃用 |
| Excalidraw JSON | △ 尚可 | ~2 MB inline | △ 需理解其内部坐标系 | 弃用 |
| **自定义 JSON** | **✓ 结构精简** | **零成本** | **✓ 字段直接对应意图** | **选用** |

## 验收标准

**第一步——host 插件最小可用。** `schema.ts`（schema + schemastery 验证）、`store.ts`（本地 JSON CRUD）、`llm.ts`（生成/修改）、`render-svg.ts`（核心节点类型）、`export.ts`（写 SVG/HTML）、`index.ts`（注册命令与 agent tools），以及单测（schema 验证、SVG 渲染快照、LLM mock）。

验收：`/wireframe new 一个简单的登录页` 生成 `~/.dsh/wireframes/exports/xxx.svg`，浏览器可打开查看。

**第二步——Settings 页预览。** `WireframeRenderer.tsx`（React SVG，复用节点映射）、`WireframeList.tsx` 与 `WireframeViewer.tsx` 页面骨架、`store.ts`（RPC 调用 wireframe gateway）、RPC gateway（`TypertRemoteService` 暴露 list/get/export）、bundle 构建与冒烟测试。

验收：Settings 页能列出、预览、导出原型图。

**第三步（可选）——Mermaid 流程图/思维导图。** 前提是已有可复用的 Mermaid 渲染器（开始前需确认 [`ui-primitives`](../../../../packages/client/ui-primitives/) 或现有插件中的模块路径与 API；若不存在，需自行集成 `mermaid` npm 包，约 +500 KB bundle，应单独评估）。host 插件增加 `diagram_generate(type, description)` tool，输出 Mermaid 代码由 Settings 页复用渲染器，与 wireframe 列表合并为同一页并加 tab 切换。

## 风险

| 风险 | 对策 |
|---|---|
| LLM 生成的 JSON 节点坐标重叠 | prompt 中强调"坐标从上到下递增，组件之间保留 8px 间距"，渲染层不做自动布局；`render-svg.ts` 对超出 `viewport` 边界的节点渲染橙色警告框而非静默溢出 |
| 复杂修改指令导致整体 JSON 格式破损 | `schema.ts` 验证失败自动重试一次（错误信息回填 prompt）；两次失败返回 `WIREFRAME_SCHEMA_ERROR`，不存盘 |
| client module `inject` 字段过多导致发现失败 | `dsh-x-ui-wireframe` 所需 inject 共 4 项：`ctx`、`settings`、`rpc.wireframe`、`session`，参照 `dsh-x-ui-model-hub` 格式声明 |
| SVG 文字在不同系统字体回退不一致 | 只用 `font-family: system-ui` 加绝对 `font-size`，不依赖字体度量 |
| 多会话并发修改同一 wireframe | `store.ts` 写入前校验 `version`，过期写入（传入 version ≠ 当前 version）返回 `STALE_VERSION`，不覆盖 |
| Settings 页枚举全部 wireframe（无 workspace 隔离） | 该插件是单用户个人工具，`~/.dsh/wireframes/` 不做 workspace 隔离，RPC gateway 暴露当前用户全部原型图；如未来需要隔离，可在 `WireframeDoc` 增加 `workspaceId` 字段并在 gateway 过滤 |

## 参考资源

- [插件开发指南](../../guides/plugin-guide.md) — 两类插件的创建、注册与页面新增全流程
- [`packages/client/ui-primitives/`](../../../../packages/client/ui-primitives/) — Button/Input/Modal 等组件
- [`docs/cookbook/adding-a-tool.md`](../../../../docs/cookbook/adding-a-tool.md) — agent tool 注册方式
- [`dsh-x-model-hub/src/index.ts`](../../../plugins/dsh-x-model-hub/src/index.ts) — `TypertRemoteService` 参考实现
- [`dsh-x-ui-model-hub/`](../../../plugins/dsh-x-ui-model-hub/) — client module 完整参考实现
