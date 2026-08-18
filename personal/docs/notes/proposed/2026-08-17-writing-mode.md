# Agent Note: 面向文档编写与修订的写作模式

Status: proposed

## 问题

长篇文档工作与当前 Web 界面并不匹配。中心栏始终是会话，文档文件要通过外部应用打开，标准 agent preset 暴露完整编码工具集。需要起草、修订或检索文档的用户必须在 dsh 和外部编辑器之间来回切换，手工保持模型上下文与文件状态一致，还要为写作任务根本用不到的工具支付成本。

产品没有面向文档的模式。写作会话需要一个能编辑文本、Markdown、代码、Word 和 Excel 的单一编辑器界面，工作目录范围的内容搜索，单文档结构导航，可引用到提示词中的文档切片，以及模型修改实时回显到编辑器。

## 提案

新增**写作模式**，由三个相互配合的部分组成。它不引入通用 mode 注册表，也不改动 agent loop：

- 一个随产品发布的 agent preset `writing`，只贡献文档工具和写作政策提示词 section；
- 一个宿主侧 `documents` 能力族，通过现有文件系统 seam 打开、切片、搜索、生成大纲、创建和修改工作目录文档；
- 一个 Web 客户端插件，贡献编辑器视图、可折叠搜索浮窗、文档树与大纲侧栏，以及 `@doc` 切片引用源。

模式按会话生效。宿主能力在进程范围内组装，但作用域限定为调用 agent 的会话工作目录；只有以 `writing` preset 创建的会话才看到缩减后的工具集，并把写作视图作为默认视图。

### 组合方式

会话面由 Web preset 机制承担；现有[按会话 agent preset 决策](../../../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md)原样适用。宿主服务是按 workspace 或会话建 key 的注册表，因此一个进程实例可以为所有 preset 服务。写作视图是 `conversation.view` 的一个 list 条目，不替换 conversation 槽位，所以聊天 tab 和 composer 仍然可用。

### 包拓扑

| 包 | 路径 | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-documents` | `packages/writing/documents/` | `Documents` Service Definition、共享的 locator/edit/error 词汇、客户端安全类型、Typert Remote 入口，以及 `documents/changed` 事件声明 |
| `@deepseek-ai/dsh-documents-local` | `packages/writing/documents-local/` | 基于 `ctx.fs` 的本地 provider：路径包含检查、格式适配器、搜索索引、大纲、修改，以及 Remote 方法 |
| `@deepseek-ai/dsh-tool-documents` | `packages/writing/tool-documents/` | 面向模型的 Consumer，注册五个 `document_*` 工具及其卡片呈现 |
| `@deepseek-ai/dsh-writing-mode` | `packages/writing/writing-mode/` | `writing:policy` system-prompt section |
| `@deepseek-ai/dsh-client-ui-writing` | `packages/client/ui-writing/` | 浏览器插件：写作视图、搜索浮窗、文档树与大纲侧栏、编辑器适配、`@doc` 引用源、`documents/changed` 应用；node half 为空 |

三个文档包构成一个完整的 [capability seam](../../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)：Service Definition、本地 Service Provider 和面向模型的 Consumer。

### 文档能力

服务通过 `ctx.fs` 将所有相对路径按 agent 会话 cwd 解析，要求落在 workspace 内，并把不透明的 fs 版本以不作解释的字符串返回。

**版本语义：** 版本字符串是 `ctx.fs` 返回的不透明 `FsVersion`；客户端不得解读。documents 层只把它用于过期守卫和事件传播。当前本地后端从高分辨率文件元数据（`dev:ino:size:mtimeNs:ctimeNs`）派生该 token，并用文件级锁串行化修改；如果后续需要内容哈希语义，`documents-local` 必须在委托 `ctx.fs` 之前增加内容派生版本，或扩展 fs provider。`ctx.fs` 的锁粒度是**文件级**：`apply` 在单个目标文件上持锁，读-校验-写为一个原子区间。两个写入者都持有合法的同一 `baseVersion` 时，先进入锁的胜出，后者在锁内校验发现 `baseVersion` 已不等于当前版本，返回 `DOCUMENT_STALE_VERSION`。

```ts ignore-check
type DocumentFormat = 'text' | 'markdown' | 'code' | 'docx' | 'xlsx'

type DocumentLocator =
  | { unit: 'line'; start: number; end: number }
  | { unit: 'paragraph'; start: number; end: number }
  | { unit: 'heading'; id: string }
  | { unit: 'block'; id: string }
  | { unit: 'cell'; sheet: string; range: string }

type DocumentEdit =
  | { kind: 'replace'; locator: DocumentLocator; text: string }
  | { kind: 'insert'; at: DocumentLocator; where: 'before' | 'after'; text: string }
  | { kind: 'delete'; locator: DocumentLocator }

type DocumentChange = {
  sessionId: SessionId
  path: string
  baseVersion: string
  version: string
  patches: DocumentPatch[] | null
}

// Element type for patches; null means the change is too large or not text-shaped — clients reload
type DocumentPatch =
  | { op: 'splice'; start: number; deleteCount: number; text: string } // line-level text patch (txt/md/code)
  | { op: 'replace'; locator: DocumentLocator; text: string }          // structured block replace (docx)
```

当修改过大或不是文本形态时，`DocumentChange.patches` 为 `null`；此时客户端重新打开文档，而不是应用本地补丁。所有修改都经过同一个服务入口 `apply`，并在文件写入提交后发出 `documents/changed`。该事件加入 `dsh-api-remotes` 的转发事件白名单。

### 格式适配器

| 格式 | 编辑器 | 修改能力 |
|---|---|---|
| `.txt` 与代码 | 带语言模式的 CodeMirror 6 | 完整保真的行与段落编辑 |
| `.md` | CodeMirror 6 加预览切换 | 完整保真的行、段落与标题编辑 |
| `.docx` | 净化预览之上的块编辑器 | 段落/块文本的替换、插入与删除；插入的 run 继承锚点格式；不支持的构造以 `DOCUMENT_EDIT_UNSUPPORTED` 失败 |
| `.xlsx` | 基于 SheetJS 提取 JSON 的虚拟化单元格网格 | 单元格与区域值更新；公式和值可往返，复杂样式尽力保留 |

适配器自带解析限制：压缩与解压大小上限、条目上限、OOXML 外部实体拒绝，以及有界的提取文本。`.docx` 和 `.xlsx` 原始字节不传给浏览器，只有提取并净化后的结构化数据会传。

### 搜索

搜索是 workspace 范围内、进程内、懒构建的索引，每次查询前按文件 stat 增量失效。文本文件使用拉丁词切分加 CJK bigram 分词；`.docx` 和 `.xlsx` 通过其提取文本进入索引。相关性为正文 BM25 加文件名加权和标题或大纲加权。结果按分数排序，并由配置设限。

**索引上限：** 单文件提取文本上限为 512 KB（超出部分截断并标记为 `truncated`）；索引总条目上限由配置项 `search.maxFiles`（默认 50,000）控制，超限时新文件跳过并在查询结果顶部显示警告。`.docx` 和 `.xlsx` 的提取文本额外限制：压缩大小上限 50 MB，解压大小上限 200 MB；超限文件从索引中排除。

### 模型面

随产品发布的 `writing` preset 只包含 persona、`writing-mode` 和 `tool-documents` 三行。它不贡献 shell、web、todo、plan、subagent、workflow、skill、ralph、goal 或通用文件工具。

| 工具 | 用途 | UI 卡片 |
|---|---|---|
| `document_search` | 按内容关键词检索工作目录文档并按相关性排序 | `search` |
| `document_read` | 读取整个文档或定位后的切片，并返回版本 | 带位置的 `generic` |
| `document_outline` | 读取标题、块或工作表结构 | `generic` |
| `document_create` | 新建受支持的文本文档（仅限 `.txt`、`.md`、代码文件；**不支持创建 `.docx` / `.xlsx`**） | `diff` |
| `document_edit` | 应用带版本守卫的替换、插入或删除操作 | `diff` call 与 result |

`document_edit` 要求携带此前读取返回的版本；过期写入返回 `DOCUMENT_STALE_VERSION`。工具使用 `ctx.fs` 并派发现有 `fs/*` policy 事件，因此 sandbox 与先读后改政策无需第二套权限体系即可生效。`writing:policy` 提示词 section 要求所有文档修改都必须经过 `document_edit`。

**Locator 与格式对应关系：** 并非所有 locator 单元在所有格式下均有效，服务层在工具调用入口校验以下矩阵，传入无效组合时返回 `DOCUMENT_LOCATOR_UNSUPPORTED`：

| Locator 单元 | txt / code | .md | .docx | .xlsx |
|---|---|---|---|---|
| `line` | ✓ | ✓ | ✗ | ✗ |
| `paragraph` | ✓ | ✓ | ✓ | ✗ |
| `heading` | ✗ | ✓（ATX/Setext 标题） | ✓（样式名 Heading 1–6） | ✗ |
| `block` | ✗ | ✗ | ✓（OOXML 段落/表格/列表块） | ✗ |
| `cell` | ✗ | ✗ | ✗ | ✓ |

**Locator 与编辑语义：** 行号和段落号均为从 1 开始的闭区间。`insert` 把新文本放在定位单元之前或之后；`delete` 删除该单元。`.xlsx` 只支持 `replace`（单元格/区域值更新）；`insert` 与 `delete` 返回 `DOCUMENT_EDIT_UNSUPPORTED`。

### 浏览器 UI

客户端插件注册一个 id 为 `writing` 的 `conversation.view` 条目、一个 `shell.overlay` 搜索条目、一个经 input-trigger seam 注册的 `@doc` 引用源，以及带 key 的工具卡片。会话视图注册表增加一个小扩展 `preferredView(sessionId)`；写作插件对 `agentPreset` 为 `writing` 的会话偏好 `writing` 视图，用户显式选择的 tab 仍然优先。这是对 `ui-conversation` 或 client runtime 的唯一改动。

**`preferredView` 扩展点接口：** 该扩展点在 `ui-conversation` 的会话视图注册表上新增一个公开方法：

```ts ignore-check
interface ConversationViewRegistry {
  /** Existing: register a conversation.view entry */
  register(entry: ConversationViewEntry): void
  /** New: plugins call this to declare a preferred view for a given session.
   *  Resolvers run in registration order; the first non-null result wins.
   *  A view id persisted in the session summary from an explicit user tab selection
   *  takes precedence over any resolver's return value. */
  declarePreferredView(resolver: (sessionId: SessionId) => string | null): void
}
```

影响面：仅修改 `ui-conversation` 的注册表类型定义和调用点（约 1 处）；普通会话的快照用例需补充"无 agentPreset 时 preferredView 返回 null，视图回退到默认 `conversation`"的场景覆盖。

写作视图在中心放置编辑器 tab，右侧是可折叠的文件树与当前文档大纲侧栏。搜索浮窗是右上角可折叠的悬浮面板；每个命中项都提供在工作区打开，或在读取 URL 中会话 id 和路径的独立同源窗口打开。文本文档以带期望版本的防抖自动保存；`.docx` 和 `.xlsx` 显式保存。用户保存（手动或防抖）都走同一个 documents 服务 `apply` 入口并携带编辑器期望版本，因此模型与用户写入共享同一条带版本守卫的修改路径。过期版本绝不覆盖。

选中的行、段落或章节可以以纯文本 `<document-slice>` envelope 发送到 composer，其中携带路径、版本、locator 和当前文本。选择 `@doc` 会插入同样的 envelope，沿用现有[纯文本引用决策](../../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)。envelope 以普通 `user/message` 文本传输，因此无需新增 session 事件或 content block 即可落盘并可重建。

**`@doc` 与 `@file` 的区别：** `@file` 引用整个文件路径并让模型自行读取；`@doc` 引用的是已打开文档的一个定位切片，直接携带文本内容，模型无需再调用 `document_read`。两者都是纯文本插入，互不冲突，可在同一消息中混用。

**`<document-slice>` envelope 精确格式：**

```
<document-slice path="<workspace-relative path>" version="<opaque version string>" locator="<JSON-serialized DocumentLocator>" >
<referenced text, original line endings preserved>
</document-slice>
```

`locator` 字段值为 JSON 序列化的 `DocumentLocator` 对象（单行，无额外转义）。模型依据 `path` + `locator` 定位文件位置，`version` 用于后续 `document_edit` 的版本守卫。

**版本过期冲突的编辑器 UX：** 模型调用 `document_edit` 返回 `DOCUMENT_STALE_VERSION` 时，客户端在编辑器顶部显示一条 banner（"模型修改失败：文档已在本地更新，请重新描述修改意图"），不弹出合并界面，不静默丢弃。用户手动保存或防抖保存触发版本更新；模型的下一次 `document_read` 将拿到新版本号。

### 数据流

1. 用户以 `writing` preset 创建会话；会话摘要携带 `agentPreset`，偏好视图选择 `writing`，提示词只组装写作工具。
2. 打开文档时路径经 `ctx.fs` 解析，在格式适配器中解析，并向编辑器返回 surface、大纲和版本。
3. 引用的切片以纯文本插入 composer，并成为一条已落盘的用户消息。
4. `document_edit` 经 `ctx.fs` 提交，发出 `documents/changed`，每个打开的窗口应用补丁或在版本不匹配时重新加载。

### 安全与并发

- 每个路径都经 `ctx.fs` 解析；workspace 外的绝对路径、`..` 逃逸和 symlink 逃逸都会被拒绝。
- 模型与用户写入共享现有 sandbox 和 `fs/*` policy gate；任何 Consumer 都不能绕过。
- 版本守卫加 `ctx.fs` 每目标锁让一个写入者胜出，其余写入者得到明确的过期结果。
- 搜索和大纲只返回有界提取内容；二进制文档字节和完整索引内容不经过网络。
- OOXML 与电子表格解析强制大小、条目和外部实体限制；预览 HTML 在渲染前净化。

### 组合变更

- `packages/bundle/web-app/cordis.patch.yml` 增加 `documents-local` host 行和 `ui-writing` client 行。
- `packages/api/remotes` 导入并挂载生成的 `documents` Remote，并把 `documents/changed` 加入转发事件白名单。
- `apps/cli` 随产品发布 `config/agent-presets/writing/`，并依赖 preset 中的两个宿主包。
- `packages/README.md` 增加 `writing/` 组行；工具、配置、事件和模块目录重新生成。
- 新增 `docs/subsystems/writing.md` 参考，并同步更新 architecture 扩展点表。

### 分阶段

1. 端到端文本路径：documents seam、txt/Markdown/代码编辑、preset、写作视图、文件树与大纲、搜索、`@doc`、`document_edit` 实时回显，以及偏好视图。
2. 结构化格式：`.xlsx` 网格编辑、带净化预览的 `.docx` 块编辑，以及独立窗口打开路径。
3. 增强：持久化或预热搜索索引、外部文件变更监听、代码符号大纲、`/writing` 命令，以及采纳模型散文的审阅面板。

### 待评审决策

1. **Phase 2 是否包含 `.docx` 块级写入**（块级编辑、格式继承与显式拒绝）？还是 Phase 2 也只保持 `.docx` 只读，块级写入推迟到 Phase 3？（Phase 1 只含 txt/Markdown/代码，`.docx` 写入不在 Phase 1 范围内。）
2. 是否接受文本防抖自动保存、Word 和 Excel 显式保存？
3. 是否接受所有文档修改都必须经过 `document_edit`，不自动采纳模型散文？
4. 是否接受进程内搜索索引在重启后重建？
5. 是否只通过 preset 选择器进入写作模式，还是为空白会话增加 `/writing`？
6. 是否接受 CodeMirror 6、虚拟化网格和受限 OOXML 编辑作为编辑器基础？

## 考虑过的替代方案

**通用 mode 注册表。**不采用。Plan mode 刻意采用会话专属的落盘状态，而 agent preset 机制已经在按会话组合工具和提示词 section。新的 mode 注册表只会重复组合职责，却不带来新行为。

**只复用现有 `tool-fs` 与 ripgrep 工具。**会话工具集层面不采用。这些工具能解决文件发现与文本编辑，但不会索引 Word 或 Excel 内容、生成文档大纲，也不携带写作视图所需的切片与版本词汇；同时完整编码工具集仍然可见。

**引入带专属 session event 的持久文档存储。**不采用。文件仍是真源，`ctx.fs` 已经提供原子且带版本守卫的修改。模型工具调用以普通 tool event 落盘，切片 envelope 以普通用户文本落盘，因此无需新 session event 即可重建。

**用纯写作布局替换 `conversation` 槽位。**不采用。该 single 槽位由会话骨架占用，替换会移除 composer、聊天 tab 及所有已声明的子槽位。`conversation.view` tab 保留这些界面，并只增加编辑器而不接管它们。

## 验收标准

- 以 `writing` preset 创建的会话恰好组装五个文档工具和 `writing:policy` section；看不到 shell、web 或通用文件工具。
- 写作视图是这类会话的默认视图，聊天只需一次点击即可切换，显式 tab 选择会持久保留。
- txt、Markdown 和代码文件的打开、编辑与保存无损往返内容和换行符。
- 搜索返回按相关性排序的文件名与内容命中，支持中文关键词，并可在工作区和独立窗口中打开结果。
- 右侧栏展示文档树和当前文档大纲，大纲节点可跳转到精确的编辑器位置。
- 行、段落或章节可以作为纯文本切片引用到 composer，模型能够据此回到对应文件。
- `document_edit` 通过 `documents/changed` 更新所有打开的窗口，并在文件状态更新时返回 `DOCUMENT_STALE_VERSION`，而不是覆盖新状态。
- `.docx` 和 `.xlsx` 文件可打开、生成大纲、搜索，并支持上文声明的适配器限定编辑；不支持的构造以结构化错误码失败，绝不静默损坏文件。
- 单元、GUI、快照和目录门禁覆盖新包及组装后的写作会话 transcript。

## 风险

- `.docx` 往返只保留声明的块级子集；复杂格式、修订记录和嵌入对象明确不在范围内，可能让用户感到意外。
- 进程内搜索索引在超大 workspace 上可能较慢，并在重启后丢失预热状态。
- 中文相关性质量依赖分词与加权调优，首发版本可能需要现场迭代。
- 多窗口及模型/用户编辑竞争受版本守卫约束，但仍会表现为需要用户处理的冲突。
- `preferredView` 扩展触及共享的 client conversation 机制；影响面很小，但需要为普通会话补充快照覆盖。
