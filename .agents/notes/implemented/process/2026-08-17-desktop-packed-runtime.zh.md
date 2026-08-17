# Agent Note: 桌面 packed runtime 来源与安装包 Release 上传

Status: implemented

[English](2026-08-17-desktop-packed-runtime.md) | 中文

## Problem

桌面发布工作流从 npm registry 安装内嵌的 dsh runtime（`@deepseek-ai/dsh@<version>`），前提是该版本已发布。本 fork 的 release 无法发布到 npm（`@deepseek-ai` scope 属于上游组织），因此 fork 的 release tag 永远产不出携带自身 runtime 的安装包：派发既有工作流只会解析到 registry 上游的最新构建，产物变成"本 fork 的壳 + 上游的 runtime"。工作流还只上传 workflow 产物，挂到 Release 上需要人工介入。

## Decision

`desktop-release.yml` 新增两个派发输入。`runtime` 选择 runtime 来源：`npm`（原有 registry 安装不变）或 `packed`——从同一提交打包 dsh 与 vendor 两个家族加 landlock entry 包，再从这些 tarball 安装 stage，即 `verify-packed-install` 的封闭消费者纪律，清单由 `scripts/release/desktop-runtime.ts` 计算。`release-tag` 非空时，每个打包 job 用 `gh release upload --clobber`（job 自带的 `GITHUB_TOKEN`）把安装包挂到该既有 Release 上。

`desktop-runtime.ts` 只映射 `@deepseek-ai/dsh` 的 @deepseek-ai 依赖闭包（依赖加 peer 依赖，传递求解）——绝不映射全部 tarball：家族里还有桌面壳与 web app，它们的依赖树会把 Electron 拖进 runtime stage。stage 安装的旗标与 registry 路径一致（`--omit=dev`、保留 optional）：koffi 与 landlock 的原生预编译以 optional 平台包分发，省略 optional 会触发源码构建（实测：无 CMake 时 koffi 失败）。

landlock entry 包（`@deepseek-ai/node-addon-landlock-run`，dsh-sandbox-local 的普通依赖）不属于任何一个打包家族；工作流单独构建其 TypeScript 并打包，与 `release.yml` 的 verify 步骤一致。

## Alternatives considered

**派发既有工作流并指定上游版本。** 否决：安装包会打着本 fork 的版本号、内嵌上游 runtime——Release 的头号特性（锚定预设位于 runtime 包内）恰恰会缺席它自己的安装包。

**在工作流里完全从源码构建。** 否决：壳本来就是从源码构建的，只有 runtime 来自 registry；packed 来源复用 release 家族自己的打包工具链，而不是发明第二套 runtime 构建。

**把全部 tarball 映射进 stage。** 否决（移植期间实测）：无闭包的映射会把桌面壳与 web app 的 tarball 当作 stage 依赖装进去，把 Electron 拖进 runtime 归档。

**stage 安装用 `--omit=optional`（`verify-packed-install` 的做法）。** 否决：koffi 的原生预编译以 optional 平台包分发，省略会触发无 CMake 机器上失败的源码构建；registry 路径也从不省略 optional。

## Consequences

- fork 的 release tag 可以产出 runtime 恰为该 tag 代码的安装包，全程不经过 npm 发布；`dsh-v0.2.0` 是第一个以此方式携带安装包的 Release。
- packed stage 的外部依赖与原生预编译仍从 npm registry 解析，因此封闭性只覆盖 `@deepseek-ai` 面——registry 故障或预编译被下架同样会使安装失败，与 npm 路径一致。
- `--clobber` 让同一 Release 的重复派发上传具有幂等性。
- runtime 闭包每次运行都从打包清单重新求解，新的家族成员只有通过依赖边才会进入 runtime，绝不默认进入。
