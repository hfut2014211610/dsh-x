# Agent Note: 消灭无控制台进程闪出的命令行窗口

Status: implemented

## 问题

验收反馈：点开飞书卡片后会弹出一个短暂消失的命令行弹窗。

机理是 Windows 的一条硬规则：**GUI 子系统进程（桌面壳、ELECTRON_RUN_AS_NODE 下的 sidecar）没有控制台；它 spawn 一个控制台子系统子进程且不带 `windowsHide: true` 时，系统给子进程分配新控制台——一个闪现的黑窗**，子进程（一条 lark-cli 调用、一条 bash 工具调用、一次 taskkill）退出，窗口随之消失。已在真机验证：GUI 子系统 exe 不带 `windowsHide` spawn `cmd.exe` 会新建 conhost（实验 A），带上则窗口隐藏（实验 B，conhost 仍在但不可见——进程级探测分不出可见性，可见性以用户报告与 Windows 文档为准）。

点卡片的具体链路：卡片按钮（允许/停止）恢复挂起的回合 → agent 在本进程内跑工具 → `subprocess-local` 的 spawn 没带 `windowsHide` → 闪窗。同一类缺陷还散布在另外八处，桌面端启动（tar 解压、PATH 探活、sidecar 的 cmd 包装、退出时的 taskkill）、桥接的出站 lark-cli 调用与拉起 dsh、web 服端的浏览器打开器、SDK 客户端。

## 决策

**统一补上 `windowsHide: true`**，共九处：

| 位置 | 触发时机 |
|---|---|
| `packages/subprocess/subprocess-local/src/spawn.ts` | 每条非持久子进程（bash/pwsh 工具、ripgrep、LSP、workflow worker、custom-bash 预设）——用户报的那一下 |
| `packages/channel/feishu/src/bridge/lark.ts` | 桥接每次发消息/更新卡片 |
| `packages/channel/feishu/src/bridge/main.ts` | 桥接拉起 dsh（`detached` 在 Windows 上显式给子进程自己的控制台，不藏必闪） |
| `apps/desktop/src/process-tree.ts` ×2 | sidecar 的 cmd 包装（不藏则打包版整个会话旁边蹲一个 cmd 窗）、退出的 taskkill |
| `apps/desktop/src/main.ts` ×3 | 首次解压 tar、PATH 探活、taskkill |
| `packages/bundle/web-app/src/index.ts` | `dsh web --open` 的浏览器打开器 |
| `packages/sdk/client/src/client.ts` | SDK 客户端拉起运行时 |

`windowsHide` 只影响子进程**新建**控制台时的可见性，继承父控制台的场合（终端里跑 `dsh`）无感，POSIX 上被忽略。持久终端（node-pty/ConPTY）本来就不建窗口，不动。

断言按仓库先例（`native-path-opener.spec` 断 `windowsHide`）接进三处单测：`subprocess-local/tests/windows-hide.spec.ts`（新文件，mock `node:child_process`）、`feishu/tests/lark.spec.ts`（larkApi，mock 带 `util.promisify.custom`——不带的话 promisify 把回调参数解析成数组而不是 `{stdout}`）、`apps/desktop/tests/process-tree.spec.ts`（win32 分支，`it.runIf` 守护）。

## 代价

- `lark.ts` 的 launchDsh 与 web-app 打开器两处只有修复没有专测：前者的 Bridge 类无既有测试缝，后者的 spawn 不导出；两处与已测三处同一行改动，风险接受。
- conhost 进程在 `windowsHide` 下仍然创建（隐藏控制台），Windows 上无法完全免掉；无可见窗口即达成验收目标。
