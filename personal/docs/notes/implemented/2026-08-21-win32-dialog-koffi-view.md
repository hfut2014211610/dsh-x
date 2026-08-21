# Agent Note: 目录选择器在打包桌面版里原生崩溃

Status: implemented

## 问题

用户报告 Windows 打包版点「打开文件夹」报错：`directory picker failed: win32 folder dialog worker exited before reporting a result`。

本机用打包 exe（ELECTRON_RUN_AS_NODE）拉起真实 worker 复现：`showing` 后打 `FATAL ERROR: Error::New napi_get_last_error_info`，JS 栈落在 `readUtf16`——读取所选文件夹路径的那一步。

机理：`readUtf16` 用 `koffi.view(地址, 32768)` 把原生内存包成**外部背衬的 ArrayBuffer** 再拷出字符串。打包桌面版的运行时跑在 Electron 的 node 上，**Electron 的 V8 开着内存沙箱，拒绝外部背衬的 ArrayBuffer，直接 napi fatal**；系统 node 没有沙箱，所以源码运行与单测从未暴露。最小探针（alloc + view / decode 各一试）在两个运行时下复现了完整分界：`decode(指针, 偏移, 'uint16')` 两边都安全，`view` 只在打包 exe 崩。

## 决策

**`readUtf16` 改为逐 `uint16` 解码**：`koffi.decode(address, offset, 'uint16')` 循环读到 NUL——与 bindings 里既有的 vtable 槽位读法（指针 + 偏移 + 基元类型）完全同型，不经过任何 ArrayBuffer。路径长度几百字符，几百次 decode 的开销可忽略。`Koffi` 接口里的 `view` 成员随之删除；假 koffi 的 spec 补了三参 `uint16` 分支、删了无人再用的 `view`/`str16`。

### 代价

- 逐字解码比一次 view 慢（微秒级 × 路径字符数），只在用户选完目录后走一次，可忽略。
- 崩溃依赖 Electron 沙箱，单测（系统 node）原则上复现不了；打包环境的行为靠本机端到端验证兜住：打包 exe + 新 worker，对话框真实弹出，SendKeys 回车后收到 `done` 与路径、退出码 0。
