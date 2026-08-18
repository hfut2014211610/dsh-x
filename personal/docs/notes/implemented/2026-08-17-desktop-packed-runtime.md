# Agent Note: 桌面 packed runtime 来源与安装包 Release 上传

Status: implemented

## 问题

桌面发布工作流会从 npm registry 装内嵌的 dsh runtime（`@deepseek-ai/dsh@<version>`），前提是那个版本已经发出去了。本 fork 的 release 发不到 npm 上（`@deepseek-ai` 这个 scope 属于上游组织），所以 fork 打的 release tag 永远产不出带自己 runtime 的安装包：直接派发现有工作流，只会解析到 registry 上游的最新构建，做出来的东西是"本 fork 的壳 + 上游的 runtime"。工作流还只上传 workflow 产物，要挂到 Release 上得人工再来一趟。

## 决策

`desktop-release.yml` 加了两个派发输入。`runtime` 用来选 runtime 从哪来：`npm` 就是原来那条 registry 安装的路，不变；`packed` 则从同一个提交打包 dsh 与 vendor 两个家族外加 landlock entry 包，再从这些 tarball 装出 stage，也就是 `verify-packed-install` 那套封闭安装的纪律，清单由 `scripts/release/desktop-runtime.ts` 算出来。`release-tag` 非空时，每个打包 job 用 `gh release upload --clobber`（用 job 自带的 `GITHUB_TOKEN`）把安装包挂到那个已有的 Release 上。

`desktop-runtime.ts` 只映射 `@deepseek-ai/dsh` 那条 @deepseek-ai 依赖闭包（依赖加 peer 依赖，传递求解），绝不把全部 tarball 都映进去：家族里还有桌面壳和 web app，它们的依赖树会把 Electron 一起拖进 runtime stage。stage 安装的旗标和 registry 那条路保持一致（`--omit=dev`，optional 保留）：koffi 与 landlock 的原生预编译按 optional 平台包分发，省掉 optional 就会走源码构建（实测：机器上没有 CMake 时 koffi 直接失败）。

landlock entry 包（`@deepseek-ai/node-addon-landlock-run`，是 dsh-sandbox-local 的普通依赖）不属于任何一个打包家族，工作流单独编译它的 TypeScript 再打包，和 `release.yml` 的 verify 步骤一致。

## 备选方案

**直接派发现有工作流，指定一个上游版本。** 否决：安装包会挂着本 fork 的版本号，里面装的是上游的 runtime——这次 Release 的头号特性（锚定预设就在 runtime 包里）恰好会在它自己的安装包里缺席。

**工作流里整个从源码构建。** 否决：壳本来就是从源码构建的，只有 runtime 来自 registry；packed 这条路复用 release 家族自己的打包工具链，不用再发明第二套 runtime 构建。

**把全部 tarball 都映射进 stage。** 否决（移植时实测过）：不算闭包直接映，会把桌面壳和 web app 的 tarball 当成 stage 依赖装进去，Electron 就被拖进 runtime 归档了。

**stage 安装也用 `--omit=optional`（`verify-packed-install` 的做法）。** 否决：koffi 的原生预编译按 optional 平台包分发，省掉它会触发源码构建，在没有 CMake 的机器上会失败；registry 那条路也从来不省 optional。

## 后果

- fork 的 release tag 能产出 runtime 恰好就是该 tag 代码的安装包，全程不用发 npm；`dsh-v0.2.0` 是第一个这样带上安装包的 Release。
- packed stage 的外部依赖和原生预编译仍然从 npm registry 解析，所以封闭的只有 `@deepseek-ai` 这一面：registry 出故障、预编译被下架，照样装不上，这一点和 npm 那条路一样。
- `--clobber` 让同一个 Release 反复派发上传是幂等的。
- runtime 闭包每次运行都从打包清单重新求解，新的家族成员只有通过依赖边才会进 runtime，不会默认进去。
- win32 上清单读取器按绝对路径去找 SYSTEM 的 bsdtar：PATH 里的 `tar` 可能是 GNU tar，它会把 `D:` 这样的盘符参数当成远程主机语法拒掉。在 Windows runner 上这曾经让闭包那一步悄无声息地死掉（pwsh 遇到原生命令非零退出不会中断），结果把一个空的 runtime 打进了安装包。现在两个平台的装配步骤都会先确认 stage 里有 `node_modules/@deepseek-ai/dsh/package.json`，再打包。
