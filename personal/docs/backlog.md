# Backlog

滚动记录。编号沿用最早提出的顺序，新增项接着排字母。**只看清单的话看下面两张表就够了。**

最后整理：2026-08-20（第二轮）。

## 待做

| # | 事项 | 状态 | 落点 |
|---|---|---|---|
| L | DSH_HOME 写锁：第二个 runtime 该拒绝启动，而不是让后来者去杀先到者 | 待做 | 是 #G 的病根。会话 JSONL 写入侧**没有**跨进程保护，#G 的修复只补了读取侧 |
| K | 插件挂了如何自救 | 🟡 孤儿那半已修 | 被直接杀掉的桥接留下的 lark-cli 消费者现在下次启动会被回收（`c20d926567`，pid + EventKey 双证据）。剩下的是**插件本身**的自救：意图记住了、退避重启还没做，现在还是要人去设置页 off→on |
| 9 | UED 预览支持标注组件 / 加入对话；层叠元素可选中被遮挡项 | ⏸ 需定范围（大件） | iframe 是 `allow-scripts` 且不与 `allow-same-origin` 同列，宿主拿不到里面的 DOM。要注入受控拾取脚本 + postMessage，且不能破坏现有隔离断言 |
| N | `test:web` 在 Windows 上过不去 | 🟡 断言那半已修 | 直接断言工具目录的两个文件（`shipped-composition`、`web-agent-presets`）已改成认平台，本机全绿。剩下的是**重放夹具**那一类：录制时模型调的是 `bash`，win32 上目录里没有这个名字，于是「unknown tool」。要治得让这条 lane 把 shell 钉死成 POSIX 那只——而 shell 的选择在 preset 里，scaffold 的 patch 够不着 preset 子树 |
| O | 安装包不带 `personal/` | 待做 | `scripts/release/families.ts:311` 只 glob `packages/*/*/package.json` 与 `apps/*/package.json`。飞书通道、model-tuning 装完就没有 |
| Q | `personal/plugins/` 下两份模型中心旧副本 | ⏸ 卡在迁移 | **`headless` profile 正在用旧副本**（它的 `dsh.profile.bundles` 里就有），删了会直接坏掉。`web` profile 不受影响（走 web-app bundle 里毕业后的那个）。两边插件名同为 `dsh-x-model-hub`、settings 段同为 `dsh-x-model-hub:`，所以**不需要迁移设置**；但毕业后的包没有 `cordis.patch.yml`，当不了 bundle，headless 得改用 `dsh plugin --profile headless add`。这是动你本机 profile，等你点头 |

## 部分完成

| # | 事项 | 已做的 | 还差的 |
|---|---|---|---|
| B | 加「关于」菜单，呈现更新日志 + 版本更新操作 | 桌面托盘有「关于」了：版本、运行时版本与来源、附着还是自起、窗口指向的 origin | **web 端入口没有**；**更新日志没有**（托盘另有一条「检查更新」，但不在「关于」里） |
| C | 合并预览与编辑窗口，在预览状态下直接编辑 | 点一块就地改它的源文（`8dc3293d17`），围栏代码与展示公式也可点（`42b22d1223`）；Cmd/Ctrl+Enter 或点开落定，Esc 丢弃 | 「**弱化代码性、强调内容**」那半没做——改的仍是 Markdown 源文，不是所见即所得 |

## 搁置

| # | 事项 | 为什么搁置 |
|---|---|---|
| U | A/B 两种飞书接入模式同时生效（身份走 A、事件来源走 B） | 用户 2026-08-20 决定暂不考虑。真要做得把 `mode` 拆成两个独立维度，动配置结构 |

## 已完成

| # | 事项 | 落点 |
|---|---|---|
| 1 | 启动卡顿 | `apps/desktop/src/main.ts` 主进程同步阻塞 |
| 2 | 启动页应更优雅 | `apps/desktop/loading.html` / `loading.js` |
| 3 | 助手栏拖宽后 composer 宽度不跟 `dca2a3520c` | `ConversationSession.tsx` 改驱动 `--dsh-companion-width` |
| 4 | 连接器菜单飞书接入 | ①按 bundle 挂上 ②RPC+开关 ③settings 命名空间 + 读透式 |
| 4-profile | personal 插件仅 bundles | model-hub / ui-model-hub 已被上游收编 → 移除；model-tuning 装回；feishu 新挂 |
| 5 | 助手栏输出不换行、超出屏幕 `dca2a3520c` | 缺 `min-width: 0` + 统计行 `nowrap` 不可压缩 |
| 6 | 写作模式阅读器不支持 Word 预览 `a6ccfc0a33` | `ui-writing`、`packages/writing/documents*` |
| 6b | 写作工具无法生成合法 docx `43197c3349` | 从零构造 OOXML 包；OPC 读取器验证通过 |
| 7 | 代码类文件阅读展示优化 `a6ccfc0a33` | `ui-writing` 预览 / `ui-primitives` markdown |
| 8 | 产物不自动在预览窗打开 `b28a0f1bab` | `ui-ued` / `ui-writing` 对 `documents/changed` 的处理 |
| E | 写作模式支持多标签 `02cb4c7a5e` | 标签存的是缓冲区不是路径，切走切回不重读文件 |
| F | 点「打开配置文件」提示无法打开 `4a88358a16` | Windows 对 `.yaml` 无关联；补 Notepad 兜底 |
| G | 历史加载失败：seq 重号 `b408fb6208` | **只修了读取侧**，写入侧的病根见 #L |
| H | 模型名长时按钮被盖掉 `9083ed62bd` | 右组刚性 → 左组被压到 4px |
| I | 文件侧栏输入框改为实时过滤 `a99665a916` | 命中目录整棵子树不过滤 |
| J | 飞书扫码登录 + 权限开通页 `8dde542909` `473a2367a9` | 宿主 `feishuAuth/*` + 卡片面板 |
| M | 写作模式沙箱围栏漏洞 `674d487be1` | `.docx`/`.xlsx` 编辑路径绕过围栏直接 `node:fs` 写 |
| P | 打包速度优化 `a1228e7841` | 并发打包 + `--reuse-runtime`；完整 97s / 桌面 40s |
| V | 版本方案：上游版本号 + fork 后缀 `b1945091dc` | 224 个 manifest 与上游一致；fork 身份在 `electron-builder.yml` |
| T | 飞书端到端 | ✅ 用户实测通了（2026-08-20）。dsh 侧的出站身份、桥接配置、连接器卡片见本会话前半段 |
| A | 写作产物落进受管目录 `75c7056c24` | `writing` 与 `ued` 的 policy 现在说了产物落哪：用户指定处或工作区根，不进项目自有的文档树/源码树 |
| D | 写作 / UED 默认不展开文件目录 `e62eda2bb8` `dd52743cda` | 写作面板默认折起，第一份非人工打开的产物到达时自己出来；设计栏在有原型前干脆不存在 |
| R | 写作模式笔记状态订正 `HEAD` | 九条验收逐条核过并写进笔记；第九条缺的那半——组装后的写作会话零断言——本轮补上了 |

---

# 笔记

## #L 的病根，以及我先前的判断错在哪

2026-08-20 我一度判定 #L 无事可做，理由是把 DSH_HOME 下的写入方逐个查过——settings 与 credentials 走 `withFileLock` + 原子重命名，anonymous-user-id 走 `wx` 独占创建，profile 脚手架写的是幂等模板，桌面壳已有 `requestSingleInstanceLock`。

**漏了会话日志。** `packages/session/session-persistence-jsonl/src/` 里没有任何跨进程写保护，而 #G 记录的正是这条路上出的事：两个 runtime 共用同一 session 目录，3 个事件被编号两次，18075 条记录一度读不出来。`b408fb6208` 修的是**读取侧**——让读取区分「重号」与「缺号」，把日志救回来——写入侧仍然允许两个 runtime 往同一个目录里编号。

所以 #L 不是预防一个假想问题，是预防一个**已经发生过一次**的问题。范围也因此清楚了：不是给某个文件加锁，是**第二个 runtime 发现同一个 DSH_HOME 已被占用时应当拒绝启动**，而不是像现在这样让后来者去杀先到者。

代价要一起看：这台机器的用法是 `pnpm dsh web` 常驻 + CLI 随手跑。一刀切的独占锁会挡住这种用法。可能需要按「谁在写会话目录」而不是按「谁持有 DSH_HOME」来划边界。

## #B 只做了一半

桌面托盘的「关于」回答的是「窗口背后到底是哪个 dsh」——附着到别人已经在服务的实例、和自己拉起一个，从里面看一模一样，直到某个行为落后一个版本；附着那种情况会明说退出本壳不会带走它。措辞是纯函数带测试（`apps/desktop/src/about.ts`），因为 `main.ts` 没有单测。

原始诉求里还有两件没做：**web 端入口**（浏览器里用的人根本看不到托盘）和**更新日志**（现在只有版本号，没有「这版改了什么」）。后者需要发布流程产出 changelog 并让 updater 能取到。

## #C 的上游补丁：没有绕过方案，但补丁面已压到最小

在预览里直接编辑要知道「点到的这块对应源文哪几个字符」。mdast 节点本来带 `position`，渲染时全丢了。

**唯一干净的绕过路被构建门挡死。** 让 `ui-writing` 直接 import 上游的 parser 与 renderer（两边共用同一份代码、零漂移）会撞上 client bundle purity gate：`CLIENT_EXTERNALS` 是精确字符串匹配，`@deepseek-ai/dsh-client-ui-primitives/src/markdown/render.tsx` 不等于平台模块 `@deepseek-ai/dsh-client-ui-primitives`，直接抛错。门的理由在这里完全成立——深导入会把整个 markdown 渲染器连同它的 CSS class map 与语法注册表**再内联一份**。

另一条路是 `ui-writing` 自己装 mdast 依赖重解一遍。门不拦它，但**失败方式是静默的**：语法跟上游漂了不会报错，只会把改动写到错的块上。

所以补丁留下，但压到最小：

- `render.tsx` **与上游逐字节相同**（`git diff upstream/master` 为空）。它是带 parity 契约、也最可能被上游改动的那个文件，而「标位置」本来就不是它的职责，是某个调用方事后对它的结果做的事。
- 标位置的代码进了 `source-positions.tsx` —— 上游永远不会有这个文件，新文件不会冲突。
- 留在上游文件上的只有 `MarkdownText.tsx` 的一条 import、一个参数、一个分支。
- 开关默认关，默认 DOM 一字节没变——`render.tsx` 的 parity fixture 是拿它跟被替换掉的 react-markdown 管线逐字节比对的，无条件加属性就是漂移。
- 围栏代码块与展示公式渲染成组件与 Fragment，没有元素能挂属性，于是走一个 `display: contents` 的包装元素——它不生成盒子，布局与没有它时一致，代价是读几何量要穿到里面那一层。裸 HTML 仍不标：它渲染成裸字符串，包起来会改变相邻字面文本的合并方式，而那正是 parity fixture 钉的东西。

取舍全文见[笔记](notes/implemented/2026-08-20-markdown-source-positions.md)。

## #N：`test:web` 与 win32

15 个文件红，`shipped-composition.e2e.ts` 的断言把根因说穿了：期望的工具集里有 `bash`，本机给的是 `pwsh`。这是为 POSIX 写的 golden 撞上 Windows 的 shell 选择，不是回归——`AGENTS.md` 层面上游 CI 只用 `check:windows-wine` 覆盖 Windows。

要么让 golden 认平台，要么把这条 lane 标成 POSIX-only 并在文档里说清。在做出选择之前，**这台机器上 `test:web` 的红不构成信号**，容易掩盖真正的回归。

本会话修的那一个（`agent-preset-selection.e2e.ts`）不属于这一类：它从 `a99665a916`（写作侧栏改成实时过滤）起就脏着，是改了源没刷 golden。
