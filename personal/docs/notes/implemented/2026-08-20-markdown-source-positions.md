# Agent Note: 让渲染后的 Markdown 说得出自己是哪几行来的

Status: implemented

## 问题

写作视图的阅读态（预览）是发现错别字的地方，但改它要先离开阅读态、切到编辑器、在源文里重新找到那一行、改完再切回来。「在预览里直接改」需要一件现在没有的东西：**点到的这一块对应源文哪几个字符**。

预览由 `packages/client/ui-primitives` 的 `MarkdownText` 渲染。它走的是 mdast → React 的直连管线，mdast 节点本来就带 `position`（start/end 的绝对 offset），但渲染时全部丢掉，DOM 里一个字都不剩。

绕开它的路都不通：

- `extractMarkdownPlainText` 只返回字符串，没有 offset 映射。
- 按空行切源文再跟 DOM 顶层子元素按序号对齐——**松散列表（item 之间有空行）在 mdast 里是一个 list、在空行切分里是多块**，序号立刻错位，而且错位不会报错，只会把改动写到别的块上。
- 每块单独渲染一个 `MarkdownText`——跨块的引用式链接与脚注会失效，是 Markdown 的实打实的功能退化。

## 决策

**打一个最小的上游补丁**：`ui-primitives` 给顶层块标 `data-md-start` / `data-md-end`，**默认关闭**，由调用方显式打开（`<MarkdownText sourcePositions />`）。

这一条越过了 `personal/README.md` 写的「个性化优先走插件与配置，不打上游补丁」。越界是用户在 2026-08-20 会话里明确选的，理由是三条路里只有它同时满足精确、零漂移、可往上游提 PR。

默认关闭不是保守，是硬要求：`render.tsx` 的模块注释写着「the rendered DOM is pinned byte-for-byte by `tests/fixtures/markdown-dom` and must not drift」，那套 fixture 是拿它跟被替换掉的 react-markdown 管线做逐字节比对的。旧管线从来不发这两个属性，无条件加上就是漂移。开关一加，默认 DOM 一个字节没变，505 个 primitives 测试原样通过。

只走 settled 渲染路径。流式渲染的块会冻成缓存元素，offset 指向一份还在写的文档；而且没人会去编辑一条正在流的助手回复。

### 代价

| 事项 | 状态 |
|---|---|
| 合并冲突面 | `render.tsx` 与 `MarkdownText.tsx` 各多一处改动，是 fork 在 `packages/client/ui-primitives` 下唯一碰过的地方 |
| 未覆盖的块类型 | 围栏代码、展示式公式、裸 HTML 分别渲染成组件或 Fragment，没有元素能挂属性，因此不标；点它们没反应 |
| 上游化 | 这个补丁本身是可以往上游提的形状，提上去冲突面就归零 |

围栏代码是最值得能编辑的一类，但让它可标需要给 `CodeBlock` 加两个它没声明的 prop，补丁面会明显变大。第一版先不做。

## 落地

- `render.tsx`：`MarkdownRenderContext` 加 `sourcePositions?: boolean`；新增 `withSourceRange`，只对宿主元素（`typeof element.type === 'string'`）clone 上属性。
- `MarkdownText.tsx`：加同名 prop，穿到 settled 的 context 里，并进 `useMemo` 依赖。
- `WritingView.tsx`：预览的 `<article>` 挂 click，`closest('[data-md-start]')` 取范围，在块自己的盒子上覆盖一个 textarea。文档在底下保持渲染、保持只解析一次，所以别的块里定义的引用与脚注在编辑期间照常解析。
- 提交读的是 ref 不是闭包：取消会卸载 textarea，而浏览器在卸载被聚焦元素时可能补发 blur，闭包里那份就是 Escape 刚扔掉的那次编辑。

## 验收标准

- 打开开关时，每个顶层块的 `data-md-start`/`data-md-end` 切出来的正是这块的源文——已断言。
- 不打开时 DOM 里没有这两个属性，parity fixture 全绿——已断言。
- 覆盖层落在它编辑的那块上（两轴各 24px 内）——**只能在真浏览器里断言**：jsdom 不做布局，那边所有几何量都是 0，断言恒真。web e2e 里量的，而且两个盒子都在点击之后量——点击会把块滚进视口，点之前量的那个盒子对的是文章已经离开的滚动位置。

## 风险

上游哪天重写 `render.tsx` 的顶层渲染，这个补丁会在合并时冲突。冲突是**看得见**的，这正是选它而不选「ui-writing 自己再解一遍语法」的原因——后者漂移时不报错，只是静默把改动写到错的块上。
