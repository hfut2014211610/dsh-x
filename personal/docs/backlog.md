# Backlog

滚动记录。编号沿用最早提出的顺序，新增项接着排字母。**只看清单的话看下面两张表就够了。**

最后整理：2026-08-20（第三轮）。

## 待做

| # | 事项 | 状态 | 落点 |
|---|---|---|---|
| N | `test:web` 在 Windows 上过不去 | **保持现状（你定的）** | 直接断言工具目录的两个文件已改成认平台；剩下 14 个是重放夹具——录制时模型调 `bash`，win32 目录里没这个名字。**本机 `test:web` 的红不构成信号**，别拿它判断回归 |

## 部分完成

| # | 事项 | 已做的 | 还差的 |
|---|---|---|---|
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
| O | 安装包不带 `personal/` `3a0615f5e0` `bd88a4b505` | 每模型采样默认值进 `packages/llm/model-tuning`，飞书通道进 `packages/channel/feishu`（新建的 channel 组，下一个渠道往这儿放），两个都由 web bundle 默认挂载。桥接作为 `dsh-feishu-bridge` bin 随包发。settings 段名不变（是插件自己声明的，跟条目 id 无关），所以已有配置照用。`personal/plugins/` 已空并删除 |
| B2 | 纯浏览器用户看不到版本信息 | 你 2026-08-20 决定不做——浏览器里也更新不了任何东西 |
| L | 两个 runtime 同时写一份会话日志 `462b3b3a51` | 按你说的走钝刀：`dsh-host-instance-lock` 在 `$DSH_HOME` 留一份 claim，第二个 runtime 直接拒绝启动（走 `ctx.appExit`，不是抛异常——抛了只会让这一个条目失败、其余照常起来）。claim 只在它记的 pid 还活着时算数，断电留下的字条会被接管。一次性命令不挂这个 bundle，不受影响
| Q | 清掉模型中心旧副本 | 两份都删了；`headless` profile 改指 `@deepseek-ai/dsh-model-hub`（毕业后的包没有 cordis.patch.yml，当不了 bundle，所以进了 profile 自己的 patch 层），`--dump-config` 验过能组合。settings 段照旧是 `dsh-x-model-hub:`——那是插件自己声明的命名空间，跟条目 id 无关
| B | 关于菜单 + 更新入口 `038cde540f` `65e0446907` `dd87238950` | 窗口菜单栏「帮助 → 检查更新 / 关于」（之前挂的是 Electron 默认那个开发菜单，带 Reload 和 DevTools）；关于说清窗口背后是哪个 dsh；更新日志取自 release 自己的 notes，截断 12 行进「有新版本」对话框 |
| K | 插件挂了自救 `c20d926567` `168238882b` | 两半：被杀掉的桥接留下的 lark-cli 消费者下次启动回收（pid + EventKey 双证据）；开关还开着但 fiber 失败的条目自动 off→on 拉起，十分钟内三次、退避到一分钟，然后停手并说明 |
| T | 飞书端到端 | ✅ 用户实测通了（2026-08-20）。dsh 侧的出站身份、桥接配置、连接器卡片见本会话前半段 |
| A | 写作产物落进受管目录 `75c7056c24` | `writing` 与 `ued` 的 policy 现在说了产物落哪：用户指定处或工作区根，不进项目自有的文档树/源码树 |
| D | 写作 / UED 默认不展开文件目录 `e62eda2bb8` `dd52743cda` | 写作面板默认折起，第一份非人工打开的产物到达时自己出来；设计栏在有原型前干脆不存在 |
| 9 | UED 预览标注组件 / 加入对话；层叠可选被遮挡项 | 拾取只能在框内做（宿主读 `contentDocument` 是 `null`），所以注入脚本 + `postMessage`。回话**不按 origin 验**——沙箱框的 origin 全是 `'null'`——改按 `event.source` 对象身份认；载荷一律当敌意文本重构一遍，不进任何标记渲染口。层叠靠 `elementsFromPoint` 取整条栈。脚本随文档进去而不是按下标注时才注入（晚注入要重载框，会丢掉人正要指的那个状态），`previewSrcdoc` 默认仍不注入。确认后经 `sessions.scope` → `input.setDraft` 落进草稿，不直发 |
| R | 写作模式笔记状态订正 `HEAD` | 九条验收逐条核过并写进笔记；第九条缺的那半——组装后的写作会话零断言——本轮补上了 |

---

# 笔记

## #L 的病根，以及我先前的判断错在哪

2026-08-20 我一度判定 #L 无事可做，理由是把 DSH_HOME 下的写入方逐个查过——settings 与 credentials 走 `withFileLock` + 原子重命名，anonymous-user-id 走 `wx` 独占创建，profile 脚手架写的是幂等模板，桌面壳已有 `requestSingleInstanceLock`。

**漏了会话日志。** `packages/session/session-persistence-jsonl/src/` 里没有任何跨进程写保护，而 #G 记录的正是这条路上出的事：两个 runtime 共用同一 session 目录，3 个事件被编号两次，18075 条记录一度读不出来。`b408fb6208` 修的是**读取侧**——让读取区分「重号」与「缺号」，把日志救回来——写入侧仍然允许两个 runtime 往同一个目录里编号。

所以 #L 不是预防一个假想问题，是预防一个**已经发生过一次**的问题。范围也因此清楚了：不是给某个文件加锁，是**第二个 runtime 发现同一个 DSH_HOME 已被占用时应当拒绝启动**，而不是像现在这样让后来者去杀先到者。

代价要一起看：这台机器的用法是 `pnpm dsh web` 常驻 + CLI 随手跑。一刀切的独占锁会挡住这种用法。可能需要按「谁在写会话目录」而不是按「谁持有 DSH_HOME」来划边界。

## #L 的窗口在哪一行

上一轮只说到「会话日志写入侧没有跨进程保护」。这一轮定位到了具体位置，结论比原来更细，也更不适合我自己动手改。

**进程内已经是对的。** `coordinator.ts:981` 那条 `loadLiveSnapshot`：本进程有一个会话正开着回合时，`load` 直接拒绝——「cannot load session while its live turn is open」。这条保护问的是 `this.ctx.sessions.get(id)`，**只能看见自己进程里的会话**。

**跨进程只剩一层 TOCTOU。** `commitPrepared`（`coordinator.ts:943`）的顺序是：

1. `isPreparedSourceCurrent(source)` —— 读一次磁盘上的 revision，跟准备时看到的比；
2. 相同就 `commitRepair(...)` —— 截断torn tail、写合成的回合结束事件。

两步之间那一瞬，另一个进程只要追加了一批事件，第 2 步写下去的 seq 就跟对方的重号了。#G 里被重号的正好是 3 个事件（2706–2708）。

**所以 #L 不是「加一把 DSH_HOME 锁」，而是「让会话的所有权跨进程可见」**：写方在整个 attach 期间在磁盘上留下所有权凭证，`commitPrepared` 在别人持有时拒绝修复——就像 `loadLiveSnapshot` 在本进程内拒绝那样。

**我没有直接改。** 这是 `packages/session/session-persistence`，上游包，而且是仓库里最不能猜错的一块：改错的代价是丢对话。它需要的是一个想清楚的所有权协议（谁写凭证、什么时候释放、崩溃后谁清理），不是在 TOCTOU 中间塞一次重读——那只是把窗口变窄，不是关上。等你要做的时候这份定位可以直接用。

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

## 毕业包欠的门债：已清

写 #9 时把仓库的门跑全了（`run-gates ci-static`，36 道），发现上一轮毕业的三个包欠了六道。**上一轮我报「九个门全绿」时跑的是更窄的一组，这六道没在里面。**

| 门 | 欠的是什么 |
|---|---|
| `verify-export-jsdoc` | 飞书 27 处导出缺 `@param` / `@returns` |
| `verify-package-invariants` | 三个 `invariant.ts` 写的是「No runtime invariant.」，门认的是带冒号的 `No runtime invariant:` |
| `verify-package-readme-limitations` | 飞书、model-tuning 缺这一节；instance-lock 整个 README 都没有 |
| `verify-package-readme-model-experience` | 同上，另需在门自己的审计表里登记（`ui-writing`/`ui-ued` 早有先例） |
| `constraints` | 飞书的 bin 指着 `lib/bridge/main.js`，仓库约定是 `lib/bin.js`——补了 `src/bin.ts` 与 `tsdown.config.ts`，桥接现在打成一个文件（也更合它的本分：dsh 挂了它得顶上，少一个可能缺失的文件就少一种顶不上的方式） |
| `doc graphs` | 事件矩阵没重生成：`model-tuning` 是 `agent/request` 的消费者、`feishu` 是 `approval/request` 的消费者，两条都缺 |

这些门只扫 `packages/` 与 `apps/`——包还在 `personal/` 底下时它们根本看不见，一毕业就全部到期。这是「从 `personal/` 毕业」的真实成本，下次搬包前先跑一遍 `ci-static`。

**还红着但不是本轮的**：`knip` 115 条未列依赖、`verify-client-domain-graph` 27 条，改动前后逐条相同，全在上游包里。

## #9 借鉴外部实现：看过 dsh-openpencil

`ZSeven-W/dsh-openpencil` 做的是 OpenPencil（矢量设计工具）的通道，预览是 headless 导出器渲的 PNG，选择发生在另外挂的只读 Web SDK 画布里，回到模型靠模型**主动调工具** `openpencil_selection`。

**不能借**：渲 PNG 是因为 `.op` 非用导出器不可；HTML 原型换成 PNG 是纯损失——交互没了，而要指的常常正是交互出来的那个状态。它的文档也完全没提层叠遮挡。

**值得记**：选择用「拉」不用「推」。模型随时能问「现在选中什么」，人选一下直接说「改窄」就行，不需要「加入对话」这个动作。障碍是真的：选择状态在浏览器、工具在宿主，现有 Remote 面只有浏览器调宿主这一个方向。视图里已经存着确认过的候选，将来接工具不用推翻现有结构。


## #N：`test:web` 与 win32

15 个文件红，`shipped-composition.e2e.ts` 的断言把根因说穿了：期望的工具集里有 `bash`，本机给的是 `pwsh`。这是为 POSIX 写的 golden 撞上 Windows 的 shell 选择，不是回归——`AGENTS.md` 层面上游 CI 只用 `check:windows-wine` 覆盖 Windows。

要么让 golden 认平台，要么把这条 lane 标成 POSIX-only 并在文档里说清。在做出选择之前，**这台机器上 `test:web` 的红不构成信号**，容易掩盖真正的回归。

本会话修的那一个（`agent-preset-selection.e2e.ts`）不属于这一类：它从 `a99665a916`（写作侧栏改成实时过滤）起就脏着，是改了源没刷 golden。
