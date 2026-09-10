# Agent Note: Windows preset 的 Git Bash 预校验

Status: implemented

[English](2026-08-25-preset-git-bash-preflight.md) | 中文

## 问题

随附 `minimal` 与 `anchored-standard` preset 中的 Windows `custom-bash` 插件会先发布 `bash` 工具，之后才解析可执行文件。宿主通过 Git for Windows 常见的 `cmd` 目录使用 Git 时，即使裸 `bash` 不在 `PATH`，这两个 preset 仍能挂载并暴露该工具；直到模型首次调用工具才发现可执行文件缺失。这种延迟失败会为 preset 无法提供的能力浪费一个模型步骤，而且 PATH 解析还可能选中 WSL shim，而非 Git Bash。

## 决定

两个自包含 preset 副本都会在异步插件加载期间、注册工具之前解析并验证 Bash。非空的显式 `bashPath` 具有决定权。未提供时，解析器先从 PATH 解析出的 `git` 推导候选项，再检查 Git for Windows 常见的全局、逐用户和 Scoop 安装目录，最后才回退到提供方对裸 `bash` 的查找。所有候选项都在子进程提供方的执行环境中验证，而不是由宿主文件系统验证。

候选顺序沿用社区 `dsh-anchored-standard` 的解析器。社区源在首次工具调用时延迟解析；本 harness 适配版在插件加载期间执行同样的发现，因为缺少有效 Bash 可执行文件时，组合无法提供其声明的引导工具。

每次 preset 挂载都会保留解析后的可执行文件路径，供后续全部工具调用使用。dispose（资源释放）会通过子进程解析器的 signal 中止正在进行的查找。如果所有候选项都失败，插件加载会带着列明安装方式和 `bashPath` 修正方法的聚合诊断拒绝，并且不会发布不可用工具。这仍是挂载期依赖检查，而不是 preset 名单健康检查，与[损坏 preset 决策](../../archived/bug-fix/2026-08-09-broken-preset-roster-rows.md)一致：发现过程验证组装文件，挂载过程解析运行时依赖，并在失败时回滚组装。

## 验证

Windows shell 组合套件使用受控子进程提供方加载两个随附插件副本。测试证明：裸 `bash` 不可用时会选择 Git 安装目录中的候选项；执行时会复用规范路径，不再重复查找；所有查找都失败时会在工具注册前拒绝。随附 Web 组合 e2e 测试在 `git` 位于 `PATH`、而 `bash` 不在其中的 Windows 宿主上运行 `anchored-standard`，随后成功执行其引导阶段的 `bash`。工具名称、schema、描述和成功结果都没有变化，因此快照无需修改。

## 考虑过的替代方案

**加载时只解析裸 `bash` 并改进错误信息。** 拒绝，因为 Git for Windows 常见的 `cmd` PATH 条目已经证明已安装的 shell 可用，即使其二进制目录没有全局暴露。

**在 `bash` 工具名下回退到 `pwsh`。** 拒绝，因为命令语言将不再符合已发布的 schema，而且锚定 preset 的首次请求依赖真实 Minimal `bash` schema 与语义。

**把发现延迟到首次工具调用。** 本 harness 适配版不采用，因为可执行文件缺失时，已声明的引导能力不可用，而且需要浪费一个模型步骤后才报告配置失败。安装或移动 Git Bash 后重新挂载插件即可重新发现。

## 后果

Git Bash 确实缺失时，preset 会在挂载阶段失败，而不是等模型选择工具后才失败。只把 `git.exe` 而没有把 `bash.exe` 暴露到 `PATH` 的安装方式无需修改进程环境即可工作。缓存路径意味着挂载后移动或删除 Git Bash 会在执行时以 spawn 失败暴露，并且需要重新挂载才能再次解析。两个插件文件继续保持重复，以便复制出的 preset 自包含；后续修改可执行文件策略时必须同步两个副本。
