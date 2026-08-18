# @deepseek-ai/dsh-client-ui-ued

[English](README.md) | 中文

浏览器侧的设计模式插件。它注册一个 `conversation.view` 标签页（`ued`），里面是原型列表加一个沙箱预览框；对 `agentPreset` 为 `ued` 的会话把自己声明为首选视图，并把 `chat` 作为同伴视图放回去。宿主侧没有任何行为：原型来自已有的 `documents` Remote 接口，收到 `documents/changed` 就重绘预览。

门开在预设上，不是文件类型上。否则任何会话只要工作区里有 HTML 就会拿到一个渲染入口，把这条"不可信内容"的边界从设计会话扩大到全部会话。

## 预览框

框里渲染的是模型写的文档——没有人审阅过的可执行标记——而且和宿主的 RPC 通道在同一个页面里。`src/client/sandbox.ts` 单独持有这层隔离，特意跟视图分开，好让它能被直接断言。决策与实测依据见 fork 的 [iframe 安全评审](../../../personal/docs/notes/proposed/2026-08-18-ued-preview-iframe-security.md)。

靠三件事撑住：

- **`sandbox="allow-scripts"`，绝不与 `allow-same-origin` 并列。** 两者并列会让框内文档落到宿主源上，从那里可以拿到 `parent.document`、删掉自己的 `sandbox` 属性再重载，取得完整权限。这件事错了预览看不出任何异样，所以测试对 token 集合做双向断言——授予的恰好是 `allow-scripts`，每一个会放宽边界的 token 都不在。
- **只用 `srcdoc`，绝不从宿主源提供。** 从本源提供的原型带着合法的同源 `Origin` 去调 `/api`，不管 iframe 属性怎么写都已经绕过去了。目前没有任何路由提供工作区文件，也不许为这件事新增。
- **注入一条 `Content-Security-Policy` meta。** `srcdoc` 文档继承嵌入方的策略，而本应用一条 CSP 都没有，所以策略必须随文档一起进去。它把 `ued` 提示段里只是"要求"模型做到的自包含、不加载网络资源变成强制，并且禁掉框内的每一种子资源来源。位置有讲究：meta 若排在 `<!doctype html>` 之前会把页面推进 quirks 模式，所以插在 `<head>` 之后，没有 head 就造一个。这是加固层，不是防线——就算标记形态让插入失效，沙箱仍然拦着。

预览框保留可见边框和"预览"角标。原型可以画一个像宿主设置页的界面，沙箱不解决这个问题。

## 刷新

设计线程在启动它的那一轮结束之后还在写，而且多个线程可能在同一秒里写。视图按 `documents/changed` 的尾沿重绘当前预览的路径，所以框里不会出现写到一半的文档。已经切走的原型即使回调迟到也直接丢弃，不会画到当前这份上面。

## Model Experience

None, as this package only renders documents the `documents` seam already owns; it registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **替换 `srcdoc` 会重载整个框** — 刷新后原型内部的滚动位置丢失。要恢复它就得往原型里注入脚本，与"保持自包含"冲突。
- **视图内不能编辑** — 这个视图只读原型；要改就走模型，这也是设计策略的要求。
