# Agent Note: 在预览里指着一个组件说话

Status: implemented

## 问题

设计会话里，人看着预览框想说的往往是「这个按钮太窄了」。但「这个」在对话里没有指代物——他只能改用文字描述位置（「右上角那个蓝的」），或者干脆自己去翻源文找选择器。层叠处更糟：遮罩下面的控件用嘴根本说不清是哪一个。

诉求两件：**把预览里的某个元素标注出来、送进对话**；**层叠的地方能选中被遮住的那个**。

## 卡在哪

预览框是 `sandbox="allow-scripts"` 且刻意不与 `allow-same-origin` 并列（理由见 `packages/client/ui-ued/README.md` 的「预览框」一节）。这条隔离的直接后果是：**宿主读 `contentDocument` 得到 `null`**。宿主这边没有任何命中测试可做——它看不见框里有什么。

所以拾取只能发生在框内，靠注入脚本；答案只能靠 `postMessage` 回来。这就把问题从「怎么做拾取」换成了「**怎么信任框里回来的话**」。

## 决策

新建 `packages/client/ui-ued/src/client/inspect.ts`，两半都归它：注入脚本的源码，和宿主侧的收信关卡。

### 一、回话不能按 origin 验

不透明来源的文档发出的 `event.origin` 是字符串 `'null'`——**页面上每一个沙箱框都是这个值**。拿它当校验等于没校验，而且是那种看起来很像在校验的没校验。

唯一站得住的判据是对象身份：`event.source` 必须是本视图框住的那个 `Window`。`readInspectMessage(data, source, frame)` 因此把 frame 作为参数收进来，第一件事就是 `source !== frame` 就丢弃。

反方向投递必须用 `'*'`——同一件事的镜像：不透明来源匹配不上任何别的目标值。这不是图省事，是没有别的值可填。

这条判据配了两级断言（`inspect.client.spec.ts` 与 `view.client.spec.tsx` 各一条）。把 `source !== frame` 那半行删掉，两条同时红——验过。

### 二、载荷一律当敌意文本

注入的脚本与原型同处一个域，原型伪造消息毫无难度。

**但注入本身没给原型任何新能力**：向嵌入方 `postMessage` 从来就不受 `sandbox` 管，一个恶意原型在注入之前也能给宿主发消息。变的是宿主现在会**听**。所以硬化点全在收信侧：每个字段到达时重新构造一遍——截断（选择器 240、文本 120、标记 600）、剔除控制字符（保留 tab 与换行，标记里本来就有）、深度按数组下标重编而不采信对方声明的值、栈深上限 8。

**来自框内的东西一个字都不进标记渲染口。** 视图里 `label`/`text` 都是文本子节点，`html` 只进草稿字符串。

### 三、层叠用 `elementsFromPoint`

`elementFromPoint`（单数）只给最上面那个，`elementsFromPoint`（复数）给整条命中栈。被遮挡的控件因此只是列表里往下一行，而不是够不着。悬停某一行，宿主投一条 `highlight` 回去，框内把那个元素描出来——描边只能在框内画，宿主既读不到它的几何量，也没有它的坐标系（框自己会滚动、会被缩放）。

### 四、脚本随文档一起进去，不是按下标注时才注入

晚注入意味着重载整个框。而标注到一半被重载的原型会丢掉人刚导航出来的状态——展开的折叠面板、填了一半的表单——**那通常正是他要指的那个状态**。

代价是原型静置时多一个 `<script>` 元素和几个被动监听器。用 `previewSrcdoc(html, { inspect })` 收口：**默认不注入**，函数的朴素形态与改动前逐字节相同（`sandbox.client.spec.ts` 里那条 `toBe(previewSrcdoc(html))` 钉的就是这个），宿主不提供 `annotate` 回调时也整个不进去。

CSP meta 必须排在注入脚本之前——排在后面的话脚本会在文档自己声明的策略下跑，而覆盖它正是这条插入存在的理由。顺序本身是断言。

## 加入对话走草稿，不直发

`ctx.sessions.scope(id)` 是 id → 会话作用域 ctx 的正规兑换点（`packages/client/ui-commands/src/client/service.ts` 里标了 "registered exchange point"）。拿到 ctx 后 `conversation.input.for(actx).setDraft(...)`——契约里 `setDraft` 被点名为**单一草稿写入路径**，所有草稿变更都得走输入机的事件，别处手工拼接会让 chip 占位表跟文本失去同步。

作用域每次调用现取，不缓存：`scope()` 返回的 ctx 活不过它所属的作用域，会话没了的拾取直接丢弃，而不是写到别处去。

**为什么是草稿不是 `send()`**：引用不构成请求。人还得说「把它改窄」。落进草稿正好停在他要接着打字的地方。

进一步的体面做法是 `insertReference` + `Occurrence`（真正的引用 chip，带 label 与剪贴板投影，同名引用各自独立可寻址）。它要向 input-trigger 注册一个 reference source，是另一个包的公开面，本轮没做——chip 化是可以后加的一层，不推翻现有结构。

## 标注里有什么，没有什么

送进草稿的是结构，不是散文：`路径 · 选择器` 加一段 ```html 围栏。刻意不生成一句话——生成的句子要挑语言，而模型并不在乎那个；选择器定位，标记让模型在选择器已经漂了的时候还能找到它。

**没有的是像素。** 元素长什么样不在标注里，沙箱也不给宿主任何截取它的办法——截屏只能在框内自己画，成本差一个量级。这条与另两条（描边框仍是原型自己那棵树上的元素；`srcdoc` 重载丢滚动位置，现在有了路但还没做）一起记进了包 README 的 Known Limitations。

## 外部实现比过：dsh-openpencil

`ZSeven-W/dsh-openpencil` 是 OpenPencil（矢量设计工具）的 dsh 通道，做的是相邻的事。它的预览是 headless 导出器渲出来的 **PNG**，加一条缩略图轨；交互选择发生在另外懒加载的只读 Web SDK 画布里；选中的东西回到模型的方式是模型**主动调工具**：`openpencil_selection`——「Reads the exact nodes selected in the live editor canvas」。

**渲 PNG 这条不能借。** 它渲是因为 `.op` 是矢量文档，非过导出器不可。HTML 原型本来就能渲，换成 PNG 是纯损失：交互没了，而 #9 要指的常常正是交互出来的那个状态（展开的面板、填了一半的表单）。它的文档也完全没提层叠遮挡，所以这里最难的那半那边没有前例。

**「拉」比「推」顺，这条记下。** `openpencil_selection` 让模型在回合里随时问「现在选中的是什么」，人只要选一下、然后说「把这个改窄」，「加入对话」这个动作整个可以不要。

没这么做是因为有个真障碍：**选择状态在浏览器，工具在宿主**。现有 Remote 面是浏览器调宿主，反过来没有通道。另外推草稿有一件拉工具没有的好处——**引用留在对话记录里**，事后翻这段对话的人看得见当时指的是哪个元素，工具拉回的答案只存在于那一次工具结果里。

视图里已经存着确认过的候选，将来要接工具不用推翻现有结构。

## 落点

- `packages/client/ui-ued/src/client/inspect.ts` — 新增，协议 + 注入脚本 + 收信关卡 + 标注格式
- `packages/client/ui-ued/src/client/sandbox.ts` — `previewSrcdoc` 加 `PreviewOptions`，默认行为不变
- `packages/client/ui-ued/src/client/UedView.tsx` — 标注开关、候选栈面板、消息监听
- `packages/client/ui-ued/src/client/index.ts` — `annotateIn(sessionId)` 经 `sessions.scope` 写草稿
- 测试：`inspect.client.spec.ts` 新增，`sandbox.client.spec.ts` 与 `view.client.spec.tsx` 各补一组
