---
description: "设计模式浏览器视图：沙箱原型预览与框内元素拾取，仅 ued agent 预设激活。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-ued

[English](README.md) | 中文

浏览器侧的设计模式插件。它注册会话自有的 `ued` `conversation.view`，里面是原型列表加一个沙箱预览框；该视图只在 `agentPreset` 为 `ued` 的会话中激活，并把 `chat` 作为同伴视图放回去。宿主侧没有任何行为：原型来自已有的 `documents` Remote 接口，收到 `documents/changed` 就重绘预览。

门开在预设上，不是文件类型上：它决定哪些会话激活这个视图，所以不是为了设计而开的会话，不会渲染模型写的页面。已注册条目不会出现在普通 tab 栏中，会话开始后也不能再选择。

## 概述

本包是 `ued` agent 预设的浏览器设计模式视图。它在沙箱预览框里渲染模型写的原型（`sandbox="allow-scripts"` 且不带 `allow-same-origin`、`srcdoc` 投递、注入 Content-Security-Policy），通过按来源窗口认证的 `postMessage` 通道在框内拾取元素，拾取结果以引用的形式落进 composer 草稿。收到 `documents/changed` 突发时在后沿重绘。宿主侧无行为。适合用来设计页面而不是聊天的会话。

## 目录

- [预览框](#the-preview-frame)
- [拾取元素](#picking-an-element)
- [刷新](#refresh)
- [Model Experience](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="the-preview-frame"></a>
## 预览框

框里渲染的是模型写的文档——没有人审阅过的可执行标记——而且和宿主的 RPC 通道在同一个页面里。`src/client/sandbox.ts` 单独持有这层隔离，特意跟视图分开，好让它能被直接断言。决策与实测依据见 fork 的 [iframe 安全评审](../../../personal/docs/notes/proposed/2026-08-18-ued-preview-iframe-security.md)。

靠三件事撑住：

- **`sandbox="allow-scripts"`，绝不与 `allow-same-origin` 并列。** 两者并列会让框内文档落到宿主源上，从那里可以拿到 `parent.document`、删掉自己的 `sandbox` 属性再重载，取得完整权限。这件事错了预览看不出任何异样，所以测试对 token 集合做双向断言——授予的恰好是 `allow-scripts`，每一个会放宽边界的 token 都不在。
- **只用 `srcdoc`，绝不从宿主源提供。** 从本源提供的原型带着合法的同源 `Origin` 去调 `/api`，不管 iframe 属性怎么写都已经绕过去了。目前没有任何路由提供工作区文件，也不许为这件事新增。
- **注入一条 `Content-Security-Policy` meta。** `srcdoc` 文档继承嵌入方的策略，而本应用一条 CSP 都没有，所以策略必须随文档一起进去。它把 `ued` 提示段里只是"要求"模型做到的自包含、不加载网络资源变成强制，并且禁掉框内的每一种子资源来源。位置有讲究：meta 若排在 `<!doctype html>` 之前会把页面推进 quirks 模式，所以插在 `<head>` 之后，没有 head 就造一个。这是加固层，不是防线——就算标记形态让插入失效，沙箱仍然拦着。

预览框保留可见边框和"预览"角标。原型可以画一个像宿主设置页的界面，沙箱不解决这个问题。

<a id="picking-an-element"></a>
## 拾取元素

要标注一个组件，就得指认宿主读不到的那份文档里的某个元素。`sandbox="allow-scripts"` 不与 `allow-same-origin` 并列，`contentDocument` 按设计就是 null，所以宿主这边根本没有命中测试可做：拾取发生在框内，由一段与策略一起注入的脚本完成，答案经 `postMessage` 回来。两半都归 `src/client/inspect.ts` 管。

这条通道上有三件事是承重的。

- **回话没法按来源验。** 不透明来源的文档发出的 `event.origin` 是 `'null'`——页面上每一个沙箱框都是这个值，拿它当校验等于没校验。宿主改为把 `event.source` 和自己框住的那个 `Window` 对比，这正是 `readInspectMessage` 要接一个 window 参数的原因。反方向的命令则必须投给 `'*'`，理由是同一件事的镜像：不透明来源匹配不上任何别的值。
- **载荷不可信。** 注入的脚本与原型同处一个域，原型想伪造什么消息都行。注入本身没给原型任何新能力——向嵌入方 `postMessage` 从来就不受 `sandbox` 管——变的是宿主现在会听，所以每个字段到达时都重新构造一遍：截断、剔除控制字符、只当文本用。来自框内的东西不进任何标记渲染口。
- **被遮挡的元素正是要点。** `elementsFromPoint` 返回指针下的整条命中栈而不只是最上面那个，所以藏在遮罩后面的控件只是列表里往下一行，而不是够不着。悬停某一行，框内就把那个元素描出来。

拾取器随文档一起进去，而不是等谁按下标注时才注入。晚注入意味着重载整个框，而标注到一半被重载的原型会丢掉人刚导航出来的状态——那通常正是他要指的那个状态。宿主不提供 `annotate` 回调时它整个不进去；`previewSrcdoc` 默认也不带它，所以那个函数的朴素形态仍然只是原型加策略，别无他物。

确认后的拾取落进这个会话的输入草稿（经 `conversation.input`），不是直接发出去的消息。引用不构成请求：要改什么，还得人自己说。

<a id="refresh"></a>
## 刷新

设计线程在启动它的那一轮结束之后还在写，而且多个线程可能在同一秒里写。视图按 `documents/changed` 的尾沿重绘当前预览的路径，所以框里不会出现写到一半的文档。已经切走的原型即使回调迟到也直接丢弃，不会画到当前这份上面。

<a id="model-experience"></a>
## Model Experience

None, as this package only renders documents the `documents` seam already owns; it registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **替换 `srcdoc` 会重载整个框** — 刷新后原型内部的滚动位置丢失。注入的拾取器给了这件事一条原来没有的路——框内可以自己上报并恢复滚动位置——但还没人这么做。
- **视图内不能编辑** — 这个视图只读原型；要改就走模型，这也是设计策略的要求。
- **拾取带回的是标记，不是像素** — 模型拿到的是元素的选择器和它自己的标记。元素长什么样不在标注里，而沙箱也不给宿主任何截取它的办法；截屏只能在框内自己画。
- **描边框是原型自己那棵树上的元素** — 它挂在 `documentElement` 而不是 `body` 上，避开页面自己的选择器，退出标注时移除；但一条写成 `html > *` 的规则仍然看得见它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`sandbox="allow-scripts"` 绝不能和 `allow-same-origin` 并存，原型也绝不能从宿主源的路由 served：任犯一条，沙箱都会在毫无可见变化的情况下失效。测试双向断言 token 集合。拾取通道按 `event.source` 窗口身份认证，不看 origin，所有载荷字段到达即重建。

</details>
