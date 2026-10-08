# Agent Note: 上游 0.2.0-rc.2 冷树构建失败

Status: implemented

## 问题

合并 `upstream/master`（`dsh-v0.2.0-rc.2`）之后，`pnpm run build:lib:host` 在冷树上必然失败，于是 `pnpm run typecheck`、`pnpm run build`、`pnpm run build:official` 以及所有依赖它们的门禁与发布流程全部不可用。

失败点固定在根工程：

```
ERROR Error: [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

机理链条，每一环都单独验证过：

1. 根 `tsdown.config.ts` 的 host 面把 `lib/types/{index,invariant,startup}.js` 声明为入口。
2. 树里**没有任何 tsc 工程会产出根的 `lib/types`**：根 `tsconfig.json` 是 `"files": []` 的 solution 根，不参与编译；`tsconfig.host.json` 是 `"noEmit": true` 的纯检查聚合；被 reference 的包各自产出各自的 `lib/types`。
3. 仓库根**没有 `src/` 目录**，而 `packages/typert/generator/src/analyzer.ts:2876` 的约定把 `lib/types/X.d.mts` 映射回 `<包>/src/X.ts`——根没有对应源。
4. 把 entry 改成 `[]` 只会换一个错误：`[@deepseek-ai/dsh-root] No input files`。根工程两种方式都过不去。
5. 上游 CI 也是冷树直跑（`.github/workflows/release.yml:149` → `build:official` → `build:lib` → `build:lib:host`），前面只有 `pnpm install --frozen-lockfile` 与 `release:verify`，没有任何生成根 `lib/types` 的步骤。
6. 这不是 0.2.0 引入的：`ddefc45fbc`（0.1.6）的同一行 entry 与 workspace 列表逐字相同，tsdown 版本也一样。

**影响范围**：tsdown 阶段失败即中止，全树没有任何包产出 `lib/index.js`。但 `tsc -b tsconfig.host.json` 本身正常——326 个包的 `lib/types` 都产出了。所以**源码平面可用，产物平面全断**：单测、类型检查、`oxlint`、约束门禁都能跑，打包与发布不能。

## 决策

**A：不改上游，接受这条基线发不出版本。** 当前可用版本仍是 `dsh-v0.1.6-alpha.2-x.0.14`。

理由：

- 根 `tsdown.config.ts` 与 `tsconfig.host.json` 都是上游跟踪文件，fork 边界不允许改。改一行就能恢复的诱惑很大，但那会让 fork 与上游在同一处永久分叉，且下次同步仍要人工处理。
- 补根 `src/`（方案 B）是替上游补它自己缺的文件，后续每次同步都要处理冲突。
- 这条基线既然产不出安装包，就不该发版；发一个未经打包链验证的版本比不发更糟。

## 后果

- 0.2.0-rc.2 上的开发以「源码平面」为单位推进：类型、单测、lint、静态门禁。
- 打包、打包态冒烟、`pnpm run hygiene`（依赖构建产物）、`pnpm run build:official` 全部要等上游修复后才能恢复。
- 上游修复后需要验证的两件事：根 `lib/types` 的产出方是否补上；fork 新增的九个包是否随 tsdown 正常打包。

## 连带发现：局部 `tsc -b` 会污染依赖包的 `src/`

与上游缺陷无关，是本次迁移自己踩的坑，已固化为固定检查。

用 `tsc -b <单个包>/tsconfig.json` 做局部类型检查时，产物被吐进依赖包的源码目录——`packages/fs/fs/src/index.js`、`packages/sandbox/sandbox/src/index.js` 等共 14 个文件。`packages/sandbox/sandbox/src/index.js` 的存在让 vite 把目录解析到了错误入口，于是**全树 vitest 解析崩溃**（`Failed to resolve entry for package "@deepseek-ai/cordis"`），所有包一起挂，看起来像大面积回归。

只改用聚合 `tsc -b tsconfig.host.json`（该聚合尊重每个包自己的 `outDir`）即可。现在每次构建后都断言 `/src/` 下无 `.js`/`.d.ts` 残留。

## 连带发现：Windows 检出把符号链接物化成文本

`core.symlinks=false`，git 以 mode 120000 跟踪的 13 个符号链接全部被检出为「装着目标路径的文本文件」。其中 `apps/cli/tests/profiles/acp/cordis.yml` 的内容是：

```
../../../../../snapshots/acp/escalation-approved/cordis.yml
```

`pnpm run verify-cordis-config` 因此在第一个 fixture 就中止（`root must be a Loader entry array`），无法覆盖任何 bundle。这是检出环境限制，与本次改动无关，在合并提交上同样失败。

绕过方式：用仓库自己的 `scripts/cordis-yaml.ts` 加载器直接校验受影响的 patch 文件——解析、检查裸插件名、检查包名是否在 `apps/cli` 与 bundle manifest 的依赖并集里。