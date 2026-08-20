# Agent Note: 阅读态就地编辑——不透明的块编辑器与被撤掉的显示模式切换

Status: implemented

## 问题

块编辑器（点预览里的块、在原位弹出源文编辑）落地后有两个反馈：

1. **弹窗是透明的**。块编辑器是 `textarea`，而 `.paper textarea` 给整档编辑器定的样式是 `background: transparent; border: 0`——它的特异性（一个类 + 一个元素标签）压过 `.blockEditor`（单个类），类里的背景与边框全部失效，源文跟底下的渲染文字叠在一起没法读。
2. **「预览/编辑」切换按钮没有存在感了**。每种有阅读视图的格式都能就地编辑之后，切换开关剩下的事只有「把整篇源文铺开」。

## 决策

**弹窗不透明靠选择器，不靠 `!important`**。规则从 `.blockEditor` 改为 `.preview textarea.blockEditor, .codeReader textarea.blockEditor`：带上阅读视图自己的类，特异性严格高于 `.paper textarea`，级联赢在明处。顺带在注释里写明这是选择器带类的原因，防止后人「简化」回单类。

**删掉 `viewMode` 整个概念，而不是藏按钮**：

- markdown：永远是阅读视图，逐块编辑（已有 `data-md-start/end` 机制）。
- code：阅读视图（着色代码）保留，整个文件作为一个可编辑块——article 自身携带 `data-md-start=0 / data-md-end=全文长度`，点击任意处弹出覆盖整个滚动区域的源文编辑器；几何测量对 article 用 `scrollWidth/scrollHeight`，否则长文件尾部会从覆盖层下面露出来。
- text：没有比源文更好的展示，保持整档编辑器（唯一保留 `文档编辑器` 的格式）。
- docx/xlsx：从 zip 里抽出来的文本本来就不是源文（`hasReadingView` 的注释原话），停在只读抽取视图。

`jumpToOutline` 随之简化：markdown 标题在预览里滚动定位；text 格式直接把编辑器选中到目标行。原来为「先记下选区、等切回编辑态再应用」的 `pendingSelectionRef` 机制随 viewMode 一起删除——编辑器要么常在（text），要么不存在（其它格式），没有「稍后应用」的时机了。

## 代价

| 事项 | 状态 |
|---|---|
| 整档源文编辑入口 | markdown/code 不再提供；逐块编辑覆盖日常修改，需要大改时用外部编辑器 |
| docx/xlsx 的可编辑性 | 本来就是把抽取文本写回文件，编辑价值存疑，明确降为只读 |
| 快照 | `writing-outline.expected.md` 头部 golden 去掉模式切换组；`ued.expected.md` 顺带补上此前漏刷新的 Annotate 按钮 |

验证：`packages/client/ui-writing` 22 个单测重写后全过；`agent-preset-selection.e2e.ts` 8 个场景（真实浏览器）两轮全过；弹窗 computed style 从 `rgba(0,0,0,0)` 变为 `rgb(255,255,255)` 且边框 1px。
