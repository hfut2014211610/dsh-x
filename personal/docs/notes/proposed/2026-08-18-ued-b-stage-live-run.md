# Agent Note: UED B 阶段实测——迭代闭环是断的

Status: proposed

对 [`ued` 预设](../implemented/2026-08-18-ued-mode-preset.md) 做的第一次真实模型会话，用来验证 B 阶段五条验收标准里除工具目录以外的四条。结论是其中三条不成立，且原因不是模型行为或 policy 措辞，是 `packages/writing/tool-documents` 的三个代码缺陷。**在这些缺陷修好之前，C 阶段没有意义**——预览面板会一直预览同一份从未被改动过的初稿。

## 实测条件

本机 `dsh web`（127.0.0.1:13080），工作区 DSH-X，模型 Deepseek V4 Flash-0731 / 推理等级 Max，经本地网关 `x-models`。Playwright 驱动真实浏览器，四条指令：建原型 → 三条短修改指令（圆角 / 间距 / 深色底）。产物目标目录 `.ued-scratch/`。

## 成立的部分

**产物形态完全符合 policy。** 第一条指令 57 秒产出 `login.html`：551 行，一个内联 `<style>`、一个内联 `<script>`、**零外部引用**（`src`/`href` 除锚点与 `data:` 外无一命中）。双栏布局、响应式降级、内联 SVG 社交登录图标、表单校验与模拟提交全部自包含。"单文件自包含 HTML、不发明中间表示"这条设计判断被真实产出验证。

预设切换、组合、模型路由、`document_create` 全部一次成功。

## 缺陷 1（阻断）：`document_read` 从不把 version 交给模型

三处地方都写着要先读取拿到 version：

- 提示段 `tool:documents`（`tool-documents/src/index.ts:26`）："always read first to obtain the version, then use document_edit with that version."
- `document_read` 的描述："Read a whole document or a located slice and **return its current version**."
- `document_edit` 的 `base_version` 参数描述："Version returned by a prior document_read."

而 `document_read` 的 `render` 是（`tool-documents/src/index.ts:105`）：

```ts
render: (_args, value) => [{ type: 'text', text: value.content }]
```

**只渲染 `content`。** 模型可见的工具结果就是 `render` 的返回值——`packages/core/tools/src/index.ts:1800` 把 `tool.output.render(...)` 的结果作为 `content` 送出，结构化的 `value` 只用于 schema 校验，`presentationMeta` 只给 UI。`output.schema` 里 `version: { required: true }` 声明得再清楚，也到不了模型面前。

于是 `document_edit` 的 `base_version` 除了猜没有别的来源。实测里模型：

1. 读文件，猜 `"0.1"`，撞 `stale document version`；
2. 重读、`document_outline`、再读，找不到 version；
3. 转去 `document_search` 检索 harness 自身源码，读了 `packages/writing/documents-local/src/index.ts`、`packages/fs/fs-local/README.zh.md`、`docs/subsystems/filesystem.zh.md`，想反推 version 的构造；
4. `document_create` 造了一个探针文件 `_probe.txt` 再读回来，试图观测 version 长什么样。

三轮修改指令、约 60 次工具调用，**成功编辑次数为零**。`login.html` 自创建起字节未变。

这个缺陷**同样命中 `writing` 预设**——两个预设用的是同一套工具，写作模式的任何"读了再改"同样走不通。

**修复**：把 version 放进渲染文本。同时 `truncated` 今天也到不了模型面前，读到截断内容却按行号编辑是另一个隐患，一并带出：

```ts
render: (_args, value) => [{ type: 'text', text:
  `path: ${value.path}\nversion: ${value.version}${value.truncated ? '\ntruncated: true' : ''}\n\n${value.content}` }]
```

## 缺陷 2：文档产物不产生 deliverables chip

`ui-deliverables` 按**渲染意图**而非工具名识别"产出文件"（`packages/client/ui-deliverables/src/client/turn-deliverables.ts:43-49`）：`card === 'diff'`，或 `card === 'generic'` 且 `kind === 'edit'`，然后取该 view 的 `locations`。

`tool-documents` 的五个工具**一个 `presentationMeta` 都没声明**，因此 `producedPaths()` 恒返回 `[]`。实测确认：`document_create` 成功后的助手消息下面没有任何产出文件行。

设计笔记复用矩阵里"产物打开 | `ui-deliverables` | 成功写文件自动成为聊天里的可点击 chip"这一条不成立。

**修复**：照 `packages/fs/tool-fs/src/edit.ts:153-156` 的写法，给 `document_create` / `document_edit` 加 `presentationMeta`，返回 `card: 'generic'`、`kind: 'edit'`、`locations: [{ path: args.path }]`。

## 缺陷 3：`ued` 会话没有任何工作区视图

`ui-writing` 的视图硬门在 `summary?.agentPreset === 'writing'`（`packages/client/ui-writing/src/client/index.ts:41,45`），所以 `ued` 会话拿不到文件树、大纲与预览。叠加缺陷 2，**B 阶段没有任何应用内路径从"模型写了 HTML"到"用户看到 HTML"**。实测里模型自己在收尾时写道"直接双击在浏览器打开即可预览"——它知道应用里没地方看。

**修复有两条路**，需要选：把 `ui-writing` 的门放宽到 `writing | ued`（立刻拿到文件树与文本预览，但预览是 markdown 取向的，HTML 只会显示源码），或者直接做 C 阶段的 iframe 预览（见[安全评审](2026-08-18-ued-preview-iframe-security.md)）。缺陷 2 修好后至少有一条"点开→系统浏览器"的路，可以作为过渡。

## 并发这一组：机制成立，策略排序被自发遵守

三条短修改指令里模型一次 `subagent` 都没调，全部内联处理。按 policy 冲突策略第 1 条（"一个线程负责一个 screen 或一个文件"），单文件任务本来就没什么可拆的，所以这不算违反 policy——只是这个任务形态用不上并发。

第四条指令直接要求"同时开两个线程改 `login.html` 的主按钮，一个改蓝一个改绿"，机制随即全部跑起来：

- **委派成立**：两次 `subagent` 调用（标签 `蓝色主按钮变体` / `绿色主按钮变体`），主会话 154 秒返回，未阻塞。
- **可见面确认是 `ui-subagent` 而非 `ui-jobs`**：会话头出现 `2 个子代理，正在运行`；子会话结束时收到服务方的落定通知（`subagent-settled … finished and will do no further work unless you send it more`）。这实测确认了[实施笔记](../implemented/2026-08-18-ued-mode-preset.md)对设计笔记的那处订正。
- **`send_message` 是真的续投通道**：一个子线程声称创建了文件却没落盘，父会话读到 `document not found` 后用 `send_message` 把纠正指令推给**已存在的**那个线程，而不是另起一个。
- **策略 1 被自发选中**：模型没有让两个线程去改同一个 `login.html`，而是各自产出 `login-blue.html` / `login-green.html` 变体。因此**验收标准第 5 条（跨线程改同一元素先回主会话确认）没有被触发**——模型用更优的做法绕开了冲突本身。policy 的优先级排序按预期工作，但"确认"分支仍未被观测到。

**唯一没交付的**：`login-blue.html` 落盘（19 544 字节，主按钮 `#2563eb`），`login-green.html` 直到回合结束仍不存在。子线程声称创建却未真正调用工具，父会话检测到了并已发出纠正，但回合先结束了。这属于子会话可靠性，与缺陷 1 无关，需要单独复现。

## 验收标准复盘

| B 阶段验收 | 结果 |
|---|---|
| 工具集只含 `document_*` 与委派三件套 | ✅ 已由 `web-agent-presets.e2e.ts` 断言 |
| 出自包含 HTML | ✅ 实测通过，551 行零外部引用 |
| 产物成为 deliverables chip 点开可渲染 | ❌ 缺陷 2 + 缺陷 3 |
| 连续三条指令主会话不阻塞、可见可取消 | ✅ 委派、非阻塞、会话头 `2 个子代理，正在运行`、落定通知、`send_message` 续投全部实测成立（可见面是 `ui-subagent` 不是 `ui-jobs`） |
| 并发写同一文件时落后者重读重做 | ❌ 缺陷 1：连**无并发**的顺序读-改都撞 `DOCUMENT_STALE_VERSION` |
| 跨线程改同一元素先回主会话确认 | ⚠️ 未触发——模型自发按策略 1 拆成两个变体文件，绕开了冲突。排序符合预期，但"确认"分支仍未被观测 |

## 建议顺序

1. 修缺陷 1（一行 `render`，`tool-documents`）。这是唯一阻断项，且 `writing` 预设同样受益。
2. 修缺陷 2（两个 `presentationMeta`）。
3. 用多屏原型任务重测：验证策略 2（撞版本后重读重做）在真并发下成立，并制造一次真正无法拆分的同元素修改，看"回主会话确认"分支是否触发。
4. 复现一次"子线程声称创建却未落盘"，判断是模型问题还是 fork 子会话的工具执行问题。
5. 缺陷 3 与 C 阶段一起决策。

修复顺序上 1 是硬前置：在它之前重测任何东西都会卡在同一处。

前两项都在 `packages/writing/`——该目录由本 fork 自己引入（提交 `07ab6d0926`），不是上游文件，但它没有列在 `CLAUDE.local.md` 的 fork 所有权表里，值得顺手补上。
