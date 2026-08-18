# Agent Note: UED B 阶段实测——改不动自己刚写的东西

Status: proposed

对 [`ued` 预设](../implemented/2026-08-18-ued-mode-preset.md) 做的第一次真实模型会话，用来验证 B 阶段五条验收标准里除工具目录以外的四条。结论是其中三条不成立，且原因不是模型行为或 policy 措辞，是 `packages/writing/tool-documents` 的三个代码缺陷。

**缺陷 1 与 2 已修复**（见文内各自的"修复"段），并由第二次真实会话验证：4 次 `document_edit`、0 次 stale、产物真的被改动（`border-radius: 999px` 真的写进去了），会话里出现"产物"行与可点击的文件 chip。

修复后按建议顺序做的**多屏重测又挖出缺陷 4**：一个畸形 locator 会静默把整份文档覆盖成替换文本，`isError: false` 且版本守卫看不见。已修复。

再往后又跑了两轮，**B 阶段五条验收标准现在全部验过**（含构造出来的真并发冲突与策略 2 恢复）。**缺陷 3 仍未处理**，是 C 阶段的决策项。

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

**已改**：`document_read` 的渲染改为「`path` / `version` /（仅在裁剪时）`truncated` + 空行 + 正文」。`truncated` 一并带出是因为读到截断内容却按行号编辑是同一类隐患。`document_create` 的渲染也补上它自己写入产生的 version，与 `document_edit` 早已有的 `Updated to version …` 对称——这样紧随创建的第一次编辑不必再读一遍。

**实测复验**：同样的"建原型 → 改按钮圆角"序列，4 次 `document_edit`、**0 次 stale**，`login.html` 真的被改动（`border-radius: 999px` 出现两处）。

两点副产物观察（非缺陷，但影响手感）：version 的实际形态是 `dev:ino:size:mtimeNs:ctimeNs` 这样的长串，模型在一次调用里把它误当成 `path` 传了（后面自己纠正过来了）。另外，`code` 格式文档只支持按行定位（`heading`/`block` 直接 `DOCUMENT_LOCATOR_UNSUPPORTED`），没有字符串锚定的编辑方式，所以复验回合里模型反复 `document_search` 找 `.btn {`、`border-radius: var(--radius)` 再回去数行号——单次修改的往返次数明显高于 `str_replace_editor` 那种按字符串替换的工具。这是 `documents` 接缝的固有形态，不是缺陷，但它是"迭代为主"这个产品形态的真实成本。

## 缺陷 2：文档产物不产生 deliverables chip

`ui-deliverables` 按**渲染意图**而非工具名识别"产出文件"（`packages/client/ui-deliverables/src/client/turn-deliverables.ts:43-49`）：`card === 'diff'`，或 `card === 'generic'` 且 `kind === 'edit'`，然后取该 view 的 `locations`。

`tool-documents` 的五个工具**一个 `presentationMeta` 都没声明**，因此 `producedPaths()` 恒返回 `[]`。实测确认：`document_create` 成功后的助手消息下面没有任何产出文件行。

设计笔记复用矩阵里"产物打开 | `ui-deliverables` | 成功写文件自动成为聊天里的可点击 chip"这一条不成立。

**已改**：识别读的是**调用视图**（`presentCall`），不是 `presentationMeta`——`turn-deliverables.ts` 取的是 `ToolResultNode['callView']`。因此给两个工具加 `presentCall`：`document_create` 用 `card: 'diff'` 对空做差（内容就在 args 里，与 `str_replace_editor` 的 create 同形），`document_edit` 用 `card: 'generic'` + `kind: 'edit'`（定位编辑在调用时没有原内容，`oldText: null` 的 diff 会谎称"新建或覆盖"），两者都带 `locations`。

**实测复验**：创建回合的会话里出现「产物」行与 `打开 .ued-verify/login.html` 的 chip，收尾正文里的文件名也变成了可点击链接。

## 缺陷 3：`ued` 会话没有任何工作区视图

`ui-writing` 的视图硬门在 `summary?.agentPreset === 'writing'`（`packages/client/ui-writing/src/client/index.ts:41,45`），所以 `ued` 会话拿不到文件树、大纲与预览。叠加缺陷 2，**B 阶段没有任何应用内路径从"模型写了 HTML"到"用户看到 HTML"**。实测里模型自己在收尾时写道"直接双击在浏览器打开即可预览"——它知道应用里没地方看。

**修复有两条路**，需要选：把 `ui-writing` 的门放宽到 `writing | ued`（立刻拿到文件树与文本预览，但预览是 markdown 取向的，HTML 只会显示源码），或者直接做 C 阶段的 iframe 预览（见[安全评审](2026-08-18-ued-preview-iframe-security.md)）。缺陷 2 修好后至少有一条"点开→系统浏览器"的路，可以作为过渡。

## 并发这一组：机制成立，策略排序被自发遵守

三条短修改指令里模型一次 `subagent` 都没调，全部内联处理。按 policy 冲突策略第 1 条（"一个线程负责一个 screen 或一个文件"），单文件任务本来就没什么可拆的，所以这不算违反 policy——只是这个任务形态用不上并发。

第四条指令直接要求"同时开两个线程改 `login.html` 的主按钮，一个改蓝一个改绿"，机制随即全部跑起来：

- **委派成立**：两次 `subagent` 调用（标签 `蓝色主按钮变体` / `绿色主按钮变体`），主会话 154 秒返回，未阻塞。
- **可见面确认是 `ui-subagent` 而非 `ui-jobs`**：会话头出现 `2 个子代理，正在运行`；子会话结束时收到服务方的落定通知（`subagent-settled … finished and will do no further work unless you send it more`）。这实测确认了[实施笔记](../implemented/2026-08-18-ued-mode-preset.md)对设计笔记的那处订正。
- **`send_message` 是真的续投通道**：父会话以为一个子线程没写出文件（其实是查早了，见下），用 `send_message` 把纠正指令推给**已存在的**那个线程，而不是另起一个。发错了内容，但通道本身走通了。
- **策略 1 被自发选中**：模型没有让两个线程去改同一个 `login.html`，而是各自产出 `login-blue.html` / `login-green.html` 变体。所以这一轮**没能触发**验收标准第 5 条（跨线程改同一元素先回主会话确认）——模型用更优的做法绕开了冲突本身。第三次会话堵死这个逃生口之后才验到，见下文。

**看起来只交付了一半，实际是父会话查早了**（后续查证纠正）。回合结束时只有 `login-blue.html`（19 544 字节，主按钮 `#2563eb`），`login-green.html` 不在。当时判断是子线程声称创建却没真正写入——错了。查子会话日志 `96da81fa-…`，它确实调了 `document_create`，唯一那次报错是**父会话**的 `document_read` 撞上 `document not found`。文件后来写成了，19 544 字节，绿色 `#059669` / `#10b981` 都对，时间戳比父会话那一轮结束还晚，甚至晚于我手工删掉整个目录（目录被子线程重建了）。

真正的问题是 policy 少了一句：**子线程在父会话回合结束后还在干活**，父会话却去立刻读文件核对，读到"文件不存在"就当成失败，还用 `send_message` 重发了一遍已经在做的事。落定通知才是判断结束的依据，读文件不是。已在 policy 的并发段补上这一条。

## 第三次会话：多屏重测，以及缺陷 4

缺陷 1/2 修复后按建议顺序做的多屏重测（同一模型与网关），三条指令：建三屏 → 两个线程改同一文件的**不同**元素 → 两个线程改同一文件的**同一**元素且禁止生成变体。

**按产物分线程成立。** 建三屏一次派出三个 `subagent`，会话头显示 `3 个子代理，正在运行`，主会话 106 秒返回。这是冲突策略 1 在真实任务上的样子。

**"回主会话确认"分支触发了。** 第三条指令堵死了模型上次用的逃生口（禁止变体文件），它没有各改各的，而是回到主会话列出方案并写"所以先请你定夺……你倾向哪个方案？"，还主动说明上一轮两个圆角线程仍在运行、与颜色改动同在 `.btn` 规则块内。**验收标准第 5 条至此实测成立**——用的是普通回复而非 `ask_user_question`（该工具本就不在预设里）。

**当时以为策略 2 没触发，其实是我看错了地方。** 第二条指令让两个线程并发改同一文件的不同元素，按钮 `4px` 和输入框 `16px` 两处改动都在，父会话的记录里一次 `DOCUMENT_STALE_VERSION` 都没有。但**冲突发生在子会话里，父会话根本看不见**。翻子会话日志 `0aa17287-…`：3 次读、3 次改、撞上 stale，然后重读、再改、成功。策略 2 那时就已经跑过了。

**这条方法上的教训要记住**：并发冲突只在子会话的日志里，`personal/scripts/dump-session.ts` 是唯一能看到的地方，光看父会话的 transcript 会得出相反结论。

### 缺陷 4（严重）：畸形 locator 静默覆盖整份文档

三屏里的 `reset.html` 最终只有 **168 字节**——三行游离的 JS。子会话日志（`09336077-…`）显示它先 `document_create` 写了 21 931 字节的完整页面，然后两次 `document_edit`。第一次报 `locator unit undefined is not supported`，第二次是：

```json
{ "kind": "replace",
  "locator": { "find": "…5 行 JS…", "unit": "line" },
  "text": "…3 行 JS…" }
```

模型想要**字符串锚定替换**（`documents` 没有这种 locator），于是编了个 `find` 字段；被第一次的错误提示后补上 `"unit": "line"` 绕过了单位检查——但**没有 `start`/`end`**。而 `applyTextEdit` 的越界检查对 `undefined` 全部为假：

```ts
locator.start < 1              // undefined < 1        → false
locator.end < locator.start    // undefined < undefined → false
locator.end > lines.length     // undefined > 552       → false
```

于是 `startIndex = undefined - 1 = NaN`，`offsets[NaN] ?? 0` → `0`，`offsets[undefined] ?? content.length` → 文件末尾，replace 把 `[0, 末尾)` 换成那三行——**整份文档被替换成替换文本，`isError: false`，版本守卫也通过**（base_version 是对的，这是一次合法编辑）。没有任何地方报告数据丢失。

工具 schema 也拦不住：`locator` 声明为 `additionalProperties: true` 且不要求 `unit`/`start`/`end`，因为不同单位携带的字段不同。AGENTS.md 把"模型/工具 JSON"明确列为必须校验的边界，而这里没有校验。

**已改**：在越界检查之前先按整数校验 `start`/`end`，不合格以 `DOCUMENT_LOCATOR_UNSUPPORTED` 拒绝，错误文案顺带告诉模型没有字符串锚定的 locator。回归测试覆盖三种畸形形态（缺 `end`、只给 `find`、非整数），并断言文档内容未被改动；去掉守卫该测试即红（已验证）。

这个缺陷同样命中 `writing` 预设，而且**写作场景下更危险**——一篇长文被一次"看起来成功"的编辑清空，比一个可以重新生成的原型损失大得多。

## 第四次会话：把冲突构造出来

自然时序下两个线程很少真撞上，所以这一次直接构造：一条指令要两个线程同时改 `.ued-race/login.html`，线程 A 把 6 个元素的 `border-radius` 逐个改成 `2px`，线程 B 把同样 6 个元素的 border 颜色逐个改成 `#ff0000`，每一处都要单独发一次 `document_edit`，不许合并。读-改窗口重叠成了必然。

子会话 `3de0fbc9-…` 的调用顺序就是策略 2 的完整路径：

```
document_read → document_edit → stale document version
document_read → document_edit → Updated to version …    ← 重读后重新施加，成功
document_read → document_edit → Updated to version …
```

**最终文件里两个线程的改动都在**：`border-radius: 2px` 3 处、`#ff0000` 6 处，一处都没丢。这正是验收标准原话要求的"最终内容包含两次修改而非丢失其一"。

有一点值得注意：文件在 09:14 时只有线程 A 的改动，09:16 才有线程 B 的。子线程写盘的时间跨度比父会话那一轮长得多，查早了同样会得出错误结论——和前面 `login-green.html` 是同一个坑。

| B 阶段验收 | 结果 |
|---|---|
| 工具集只含 `document_*` 与委派三件套 | ✅ 已由 `web-agent-presets.e2e.ts` 断言 |
| 出自包含 HTML | ✅ 实测通过，551 行零外部引用 |
| 产物成为 deliverables chip 点开可渲染 | ✅ 缺陷 2 修复后实测通过（chip 经 Host opener 打开，`.html` 落到默认浏览器）。应用**内**渲染仍缺，那是缺陷 3 / C 阶段 |
| 连续三条指令主会话不阻塞、可见可取消 | ✅ 委派、非阻塞、会话头 `2 个子代理，正在运行`、落定通知、`send_message` 续投全部实测成立（可见面是 `ui-subagent` 不是 `ui-jobs`） |
| 并发写同一文件时落后者重读重做 | ✅ 构造出真冲突后完整跑通：撞 stale → 重读 → 重新施加 → 成功，最终文件里两个线程的改动都在 |
| 跨线程改同一元素先回主会话确认 | ✅ 多屏重测第三条指令堵死变体逃生口后触发：模型回主会话列方案并明确请用户定夺 |
| 按产物分线程（策略 1） | ✅ 建三屏一次派出三个 `subagent`，会话头 `3 个子代理，正在运行`，主会话 106 秒返回 |

## 建议顺序

1. ~~修缺陷 1~~ ✅ 已改，并跑真实会话复验过。`writing` 预设同样受益。
2. ~~修缺陷 2~~ ✅ 已改，并跑真实会话复验过。
3. ~~多屏任务重测~~ ✅ 已完成。策略 1 与"回主会话确认"分支都实测成立；**策略 2 仍未触发**，真冲突比设计假设稀有。重测本身挖出了缺陷 4。
4. ~~修缺陷 4~~ ✅ 已改，回归测试去掉守卫就变红。
5. ~~策略 2 的构造性验证~~ ✅ 已完成，见"第四次会话"。**B 阶段五条验收标准至此全部验过。**
6. ~~复现"子线程声称创建却未落盘"~~ ✅ 已查明，不是缺陷：文件写成了，只是晚于父会话那一轮。父会话读早了。已给 policy 补上"落定通知到达前不要读文件核对"。
7. 缺陷 3 与 C 阶段一起决策。

修复顺序上 1 是硬前置：在它之前重测任何东西都会卡在同一处。缺陷 4 则说明**光靠单测抓不住这类问题**——它要真实模型在真实任务里去够一个不存在的能力，才会撞出那条路径。

前两项都在 `packages/writing/`——该目录由本 fork 自己引入（提交 `07ab6d0926`），不是上游文件，但它没有列在 `CLAUDE.local.md` 的 fork 所有权表里，值得顺手补上。
