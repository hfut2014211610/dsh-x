# Agent Note: UED 预览视图的 iframe 安全评审

Status: proposed

[UED 模式设计笔记](2026-08-18-ued-mode.md) 把 iframe 沙箱逃逸列为 C 阶段唯一真难点，并要求"单独评审，不与功能一起赶工"。这份笔记就是那次评审，在写任何 C 阶段代码之前完成。

## 问题

C 阶段要在会话内渲染模型生成的 HTML。这些 HTML 带内联脚本，是**既非用户手写、也未经审阅的可执行代码**，要在与宿主 RPC 通道同源的页面里被渲染。

dsh 客户端目前没有任何相关基础设施：`packages/client/`、`apps/web/src/`、`apps/desktop/src/` 下没有一处 `sandbox=` 或 `allow-scripts`，全仓也没有任何 `Content-Security-Policy`（HTTP 头或 meta 都没有）。因此这是从零建立一条新的"宿主 ↔ 不可信内容"边界。

## 基线：今天的风险比 C 更高，不是更低

评审的第一个结论是这条边界的方向被搞反了。

B 阶段没有任何应用内查看路径（`ui-writing` 的视图硬门在 `agentPreset === 'writing'`，见 `packages/client/ui-writing/src/client/index.ts:41`），用户只能自己去工作区打开 `login.html`。而 `packages/host/apiproxy/src/native-path-opener.ts` 的 `BROWSER_DOCUMENTS` 含 `.html`，所以一旦补上产物入口，点开就是**用户默认浏览器里的 `file://` 页面，完全无沙箱、无 CSP、可任意联网**。

C 的沙箱 iframe 是把"在用户真实浏览器里裸跑"换成"在应用内受限跑"。**这是降风险，不是引入新风险。** 评审的目标不是论证要不要做，而是别把它做成升风险的那一种——只有一种做法会升风险，就是下面规则 1 和规则 3 的反面。

## 已经免费拿到的一层保护

`packages/client/connection/src/api-request-trust.ts` 的 Origin 围栏对 opaque origin 失败关闭：不带 `allow-same-origin` 的沙箱 iframe，其文档 origin 是 opaque，浏览器发出的请求头是 `Origin: null`；围栏第 119 行 `new URL(origin)` 对字符串 `'null'` 抛 `TypeError`（已实测），catch 分支 `return false`。所以框内脚本的任何 CORS 模式 fetch 打不进 `/api`。

**但围栏有一个缺口**，且必须写进设计依据：第 117 行 `if (origin === undefined) return true` —— 不带 Origin 也不带 `Sec-Fetch-Site: cross-site` 的请求直接放行，模块自己的注释（第 99–103 行）就说明文 HTTP 的图片与导航两个头都不带。`/api` 下确实有 GET 端点：`/api/events.mux`、`/api/events.host`（SSE 事件流）、`/api/session.export`（会话日志 ZIP），见 `packages/host/apiproxy/src/fetch/handler.ts:254,257,260`。框内一个 `<img src="http://127.0.0.1:13080/api/session.export">` 会真的发出去。

当前影响面是"**能发不能读**"：跨源响应不可读、不给 `allow-downloads` 时导航不落盘、RPC 是 POST 信封所以 GET 打不动它。但这是当下的巧合而非设计保证——今后任何一个带副作用的 GET 端点都会把它变成真洞。**结论：不要把这条围栏当作唯一防线。**

## 决策：五条硬规则

**1. `sandbox="allow-scripts"`，且永远不与 `allow-same-origin` 同列。** 两者同列等于没有沙箱：框内文档与父页同源，可以拿到 `parent.document` 把自己的 `sandbox` 属性删掉再重载，取得完整宿主权限。这是整份评审里唯一一条"错了就全盘失守"的规则，也是唯一失效时**完全静默**的规则——预览照常工作，看不出任何异常。

本机 Chromium 实测（见下节），两种配置的差别是二元的：

| iframe 属性 | 框内脚本访问 `parent.document` | 父页读 `iframe.contentDocument` |
|---|---|---|
| `sandbox="allow-scripts"` | **被拒** | **`null`** |
| `sandbox="allow-scripts allow-same-origin"` | **成功** | **可读** |

**2. 不给 `allow-top-navigation*`、`allow-popups`、`allow-modals`、`allow-downloads`、`allow-forms`。** 顶层导航会把整个应用导走；`allow-modals` 的 `alert`/`confirm` 会阻塞宿主 UI 线程；表单提交交给原型自己的内联 JS `preventDefault`——B 阶段实测产出的登录页原型本来就是这么写的，所以这条不牺牲任何真实能力。

**3. 产物只经 `srcdoc` 注入，绝不从宿主源提供。** 今天 `packages/host/frontend-static/src/index.ts` 只服务 `distRoot` 且做了穿越拒绝，全仓没有任何路由把工作区文件挂到宿主源上。**C 不得新增这样的路由**：同源提供 + 无沙箱 = 原型脚本带着合法的同源 Origin 直接调 `/api`，那才是真正的逃逸，而且会绕过规则 1。`blob:` URL 同样要小心——它继承创建者的 origin，只有在沙箱剥掉同源之后才是 opaque；`srcdoc` 没有这个歧义，也免掉 URL 生命周期管理。

**4. CSP 作为增强项，不作为防线。** srcdoc 文档继承父文档的 CSP——这一条已实测确认（父页声明 `img-src 'none'` 时，沙箱 srcdoc 子框加载 data URI 图片被拒；父页无 CSP 时同一段代码加载成功）。而本仓库当前没有任何 CSP，等于继承"无"。可行做法是注入前把一条 meta 插进模型 HTML 的 `<head>` 之后：

```
default-src 'none'; img-src data:; style-src 'unsafe-inline' data:;
script-src 'unsafe-inline'; font-src data:; connect-src 'none';
form-action 'none'; base-uri 'none'
```

这恰好把 policy 里"自包含、无外部资源"从"告诉模型"升级成"强制执行"，并且直接堵上前一节那个无 Origin GET 缺口。**但字符串插入是脆的**：没有 `<head>` 时要兜底，插到 `<!doctype>` 之前会掉进 quirks mode 改变渲染。因此它是增强项，规则 1–3 才是防线。iframe 的 `csp` 属性不可用：它需要被嵌资源以 `Allow-CSP-From` 响应头 opt-in，srcdoc 根本没有响应头，且仅 Chromium 支持。

**5. 该视图只对 `ued` 会话挂载。** 照 `ui-writing` 的做法硬门在 `agentPreset === 'ued'`，不让预览面板出现在别的预设的会话里——否则任何预设的任何 HTML 文件都会获得一个渲染入口，把这条边界的暴露面从"设计会话"扩大到"全部会话"。

## 实测方法

规则 1 与规则 4 原本是照规范写的，现在在本机 Chromium（Playwright 1.61）上实测过了。方法记在这里，方便复现：父页 `setContent` 一段 HTML，内嵌一个 `srcdoc` iframe，框内脚本经 `postMessage` 向父页汇报——**信号必须是 `postMessage`**，因为 opaque origin 的子框调不到宿主注入的函数（第一版探针用 `exposeFunction` 汇报，两组都收不到消息，无法区分"被 CSP 拦下"与"跑了但报不回来"）。CSP 那组同样不能用 `script-src 'none'` 做区分信号，它会连父页自己的内联脚本一起挡掉；改用 `img-src 'none'` 加子框内的 data URI 图片，父页脚本不受影响，唯一被该指令决定的就是子框的取用结果。

## 备选方案

**不做 iframe，只做静态渲染（把 HTML 解析成 React 元素）。** 否决：客户端现有的 markdown 渲染器正是这么做的（`packages/client/ui-primitives/src/markdown/render.tsx` 构造元素而非注入 innerHTML，并对 URL 做 sanitize），但它渲染不了脚本与布局，而 UI 原型的价值恰恰在交互与布局。静态渲染出来的不是原型，是截图的劣化版。

**继续用 B 阶段的路子——交给用户的默认浏览器。** 否决：见"基线"一节，那是本方案要取代的**更高**风险，且它没有解决 B 阶段真正缺的东西（应用内没有任何产物入口）。

**给整个 Web 应用加 CSP，让 srcdoc 继承。** 否决为当前方案、保留为独立议题：这会约束应用自身（内联样式、动态 import、HMR 通道都要一并核对），blast radius 远大于一个预览面板，不该被 C 阶段挟带。

## 验收标准

- **iframe 属性字符串在单测里被逐 token 断言**：含 `allow-scripts`；不含 `allow-same-origin`、`allow-top-navigation`、`allow-top-navigation-by-user-activation`、`allow-popups`、`allow-modals`、`allow-downloads`、`allow-forms`。这条断言必须存在且必须是白名单+黑名单双向的，因为规则 1 的失效完全静默。
- **一个真实逃逸回归**：srcdoc 注入一段试图 `fetch('/api/…')` 并把结果写进 DOM 的 HTML，断言框内拿到的是失败而非数据。
- **守卫测试**：断言没有任何路由以宿主源提供工作区文件（现状即如此，测试防的是回归）。
- 预览面板有持续可见的边框与"预览"标签，不做无边框全幅嵌入（见风险表的 UI 仿冒条）。
- 刷新由 `documents/changed` 驱动并带尾部去抖；并发写入时不出现半截文档。

## 风险

| 风险 | 状态 |
|---|---|
| **规则 1 被误配** | 唯一的全盘失守路径，且静默。靠双向断言的单测兜底，不靠代码评审 |
| 网络外传 | 无 CSP 时框内脚本可 `fetch(…, {mode:'no-cors'})` 发一条打不回来的请求；能带走的只有原型自身内容。而现在这段脚本是在用户真实浏览器里毫无限制地跑，所以这是明确的改善；加上规则 4 的 CSP 之后归零 |
| `/api` 的无 Origin GET | "能发不能读"，见上。缓解是规则 4 的 `connect-src 'none'`；同时把"新增带副作用的 GET 端点"列为需要重新评审本笔记的变更 |
| 框内 UI 仿冒 | 原型可以画一个像宿主设置页的界面骗用户输入。沙箱不解决这个，靠持续可见的预览边框缓解 |
| srcdoc 整体替换导致滚动位置丢失 | 非安全项，但会明显影响迭代手感。可用尾部去抖减少发生次数；跨 opaque origin 的滚动恢复需要向框内注入脚本，与"自包含"冲突，暂不做 |
