# Agent Note: 让桌面运行时压缩包同时装得下 macOS 双架构

Status: implemented

## 问题

用户报告 macOS 版启动即失败：`Cannot find the native Koffi module; did you bundle it correctly?`，插件装载链把整个运行时带崩（`dsh exited with code 1 before serving`）。

根因是**一个 zip 服务两个架构**：macOS 发布工作流跑在 arm64 runner 上，stage 的 `npm install` 只按宿主解析——koffi 3.x 的原生件是按平台+架构的子包（`@koromix/koffi-darwin-{arm64,x64}`），npm 只装宿主那份；sharp 同型（`@img/sharp-darwin-*` + `@img/sharp-libvips-darwin-*`）；node-pty 的 install 把宿主预编译拷进 `build/Release`，而它的加载顺序是 `build/Release` 优先于 tarball 自带的双架构 `prebuilds/`。随后**同一份** `dsh-runtime.zip` 被打进 arm64 和 x64 两个 dmg。x64 dmg 里的运行时是 x64 进程（Intel 直跑，或 Apple Silicon 上无后缀的 dmg 经 Rosetta 跑），找不到自己的原生件；koffi 是 fs-local、subprocess-local、session-persistence-jsonl 等核心插件的加载期依赖，一个失败全局退出。带 `-arm64` 后缀的 dmg 在 M 系列上是好的；Windows 不受影响（runner 与产物同为 x64）。

## 决策

**把 zip 做成双架构通用**，而不是按架构各装一次 stage：

- `npm install --cpu/--os` 的跨架构语义没有可靠验证途径（本机 Windows 模拟 darwin 时 optional 子包一个都没装、koffi 回落源码编译），不赌 CI 时长。
- node-pty 需要交叉编译或 lipo 的路线也一并省掉：它 1.1.0 的 tarball **自带双架构 prebuilds**，只要删掉宿主 `build/` 目录，加载器就回落到按进程架构选择的 `prebuilds/<plat>-<arch>`。

落成 `scripts/release/darwin-universal.ts`（副作用可注入，配 spec）：

1. 读 stage 里 koffi/sharp 的版本，`npm pack` 对应的 `@koromix/koffi-darwin-x64` / `@img/sharp-darwin-x64`，解到 loader 认的 `node_modules` 路径；
2. 读刚解出的 sharp 架构包自己的 `optionalDependencies`，把声明的库包（`@img/sharp-libvips-darwin-x64`）同样补入——不硬编码"darwin 要不要 libvips"这个事实；
3. 删 `node-pty/build`，回落双架构 prebuilds。

工作流 macOS job 在 stage 装完后、打 zip 前调用；npm 源与 packed 源两条路都覆盖。Windows job 不动。

### 代价

- zip 增大约 10–15MB（x64 的 koffi/sharp/libvips）。
- 依赖注册表上确实存在对应版本的 x64 子包——`stageVersion` 缺包时报错点名，`npm pack` 失败即断。
- spec 只钉包名/版本/路径推导与库包跟进；npm pack 与 tar 的真实行为靠本机端到端烟雾验证过（真实拉取并解出 `darwin_x64/koffi.node`、`sharp-libvips-darwin-x64`）。
