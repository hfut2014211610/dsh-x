# Agent Note: UED 模式 C 阶段——原型预览视图

Status: implemented

C 阶段做完了：`packages/client/ui-ued/`，一个 `conversation.view` 标签页，左边列原型、右边用沙箱 iframe 渲染。设计依据见 [UED 模式设计笔记](../proposed/2026-08-18-ued-mode.md)，隔离方案与实测见 [iframe 安全评审](../proposed/2026-08-18-ued-preview-iframe-security.md)，B 阶段的实测过程见[实测笔记](../proposed/2026-08-18-ued-b-stage-live-run.md)。

## 问题

B 阶段做完之后，应用里没有任何路径能看到模型写出来的 HTML。`ui-writing` 的视图硬门在 `agentPreset === 'writing'`，所以 `ued` 会话连文件树都没有；而就算把那道门放宽，它的预览切换只在 `format === 'markdown'` 时出现，HTML 只会显示源码。修好 deliverables chip 之后至少有了"点开 → 系统浏览器"这条路，但那是离开应用去看，而且原型在那边是无沙箱的 `file://` 页面。

## 决策

新包 `@deepseek-ai/dsh-client-ui-ued`，浏览器侧，宿主侧只有一个空的 loader 入口。三件事：

- 注册 `conversation.view` 标签页 `ued`，order 6。
- 对 `agentPreset === 'ued'` 的会话把自己声明为首选视图，并把 `chat` 作为同伴视图放回去（与 `ui-writing` 同样的写法；多个 resolver 按注册序跑，第一个非空的胜出，所以两个插件并存不冲突）。
- 收到 `documents/changed` 就重绘当前预览的那个路径。

视图本身很小：左栏用 `documents.list` 列目录，只显示子目录和 `.html`/`.htm`；右栏一个 iframe。没有编辑器——改原型要走模型，这是设计策略的要求。

### 隔离

`src/client/sandbox.ts` 单独持有隔离逻辑，跟视图分开，好让它能被直接断言。三条：

1. **`sandbox="allow-scripts"`，绝不与 `allow-same-origin` 并列。** 并列会让框内文档落到宿主源上，从那里能拿到 `parent.document`、删掉自己的 `sandbox` 再重载。这件事错了预览看不出任何异样，所以测试对 token 集合做**双向**断言：授予的恰好是 `allow-scripts`，而且逐个断言九个会放宽边界的 token 都不在。
2. **只用 `srcdoc`。** 从宿主源提供原型会让它带着合法的同源 `Origin` 去调 `/api`，那样 iframe 属性写什么都没用了。目前没有任何路由提供工作区文件。
3. **注入一条 CSP meta。** `srcdoc` 继承嵌入方的 CSP，而本应用一条都没有，所以策略得随文档进去。它把 policy 里只是"要求"模型做到的自包含变成强制。位置有讲究：meta 排在 `<!doctype html>` 之前会把页面推进 quirks 模式，所以插在 `<head>` 之后，没有 head 就造一个，连 `<html>` 都没有就整体包一层。这是加固层不是防线——标记形态让插入失效时，沙箱仍然拦着。

## 与提案的偏差

**放在 `packages/client/ui-ued/`，不是提案说的 `personal/plugins/dsh-x-ui-ued/`。** 原因是发行流程：`personal/scripts/build-windows.mjs` 只打 `packages/*/*` 和 `apps/*` 两组 tarball，`personal/` 完全不在闭包里。放个人插件层的话，本机 `dsh plugin add` 之后能用，但**安装包里不会有这个视图**。同族的 `ui-writing` 本来就在 `packages/client/` 并由 web-app bundle patch 挂载，走同一条路即可。

代价是要动四个上游跟踪文件：`packages/bundle/web-app/cordis.patch.yml`（挂载行）、同目录 `package.json`（`verify-cordis-config` 要求裸插件出现在解析清单的 `dependencies` 里）、`tsconfig.base.json`（paths）、`tsconfig.client.json`（构建面）。加上 `scripts/verify-package-readme-model-experience.ts` 的白名单一行。这些都是"新增一个 client 包"的固定手续，不是对上游行为的修改。

**`CLAUDE.local.md` 的 fork 所有权表该补一笔**：`packages/writing/*`、`packages/client/ui-writing/`、现在还有 `packages/client/ui-ued/`，都是本 fork 自己引入的（`07ab6d0926` 起），但表里没写。

## 备选方案

**把 `ui-writing` 的门放宽到 `writing | ued`。** 否决：它的预览只认 markdown，给设计模式的会是一个源码编辑器。而且大纲对 HTML 也没意义——`documents-local` 的 outline 是按 `#` 标题正则抽的。

**把整个 Web 应用加上 CSP，让 srcdoc 继承。** 否决为当前方案、保留为独立议题：那要连带核对应用自身的内联样式、动态 import 与 HMR 通道，影响面远大于一个预览面板。

**扩展打包脚本，把 `personal/plugins/*` 也打进闭包。** 否决：多一层 profile 安装步骤，而且个人插件层的定位本来就是"本机个性化"，不是"随安装包分发"。

## 后果

- Web 会话选择器里 `ued` 会话默认进入设计视图，`chat` 作为同伴面板在旁边。
- 新增九条单测（沙箱 token 双向、CSP 三个关键指令、四种标记形态的 meta 插入位置、可预览后缀判断）。
- 刷新带 400ms 尾沿去抖。设计线程在启动它的那一轮结束之后还在写，多个线程可能在同一秒里写——B 阶段实测里 `login.html` 在两分钟内被两个线程先后改动过，所以不去抖就会看到写到一半的文档。切走之后迟到的读取直接丢弃，不会画到当前这份上面。
- 预览框保留可见边框和"预览"角标。原型能画一个像宿主设置页的界面骗输入，沙箱不解决这个。

## 风险

| 风险 | 现状 |
|---|---|
| `allow-same-origin` 被误加 | 唯一的全盘失守路径，且完全静默。靠白名单加黑名单的双向单测兜底，不靠人工评审 |
| CSP meta 插入被畸形标记绕过 | 有意接受：它是加固层，沙箱才是防线。插入失败最多等于回到"只有沙箱"的状态 |
| 框内 UI 仿冒 | 沙箱不解决。靠常驻的边框与角标缓解 |
| 刷新丢滚动位置 | 已知，`srcdoc` 整体替换的固有代价。恢复它要往原型里注入脚本，与自包含冲突 |
