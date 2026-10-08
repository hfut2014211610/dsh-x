# @deepseek-ai/dsh-tool-bash-windows

[English](README.md) | 中文

## Summary

`tool-bash-windows` 用与官方持久 bash **同名**（`bash`）、描述与 Minimal 兼容的方式注册一个 `bash` 工具，但它走跨平台的 subprocess 接缝而不是 PTY。

本 harness 自带的 PTY 接缝在其本地实现里只支持 linux/darwin，因此持久 shell 无法服务 Windows。通过普通 subprocess 接缝启动 Git Bash，保留了 schema 锚定而不依赖 PTY。

## Table of Contents

- [Summary](#summary)
- [Table of Contents](#table-of-contents)
- [Use this package](#use-this-package)
  - [Row order](#row-order)
  - [Configuration](#configuration)
  - [Mount-time preflight](#mount-time-preflight)
- [Understand the implementation](#understand-the-implementation)
  - [Executable discovery](#executable-discovery)
  - [One command per call](#one-command-per-call)
  - [Exit codes](#exit-codes)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
  - [The bash tool](#the-bash-tool)
  - [Token effect](#token-effect)
  - [KV Cache effect](#kv-cache-effect)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [No Windows sandbox confinement](#no-windows-sandbox-confinement)
  - [State does not persist](#state-does-not-persist)
  - [No published invariant](#no-published-invariant)

## Use this package

### Row order

在 Windows 部署上，用它**替代**而不是与持久 bash 行并存。两者都注册为 `bash`，同时挂载的话结果取决于注册顺序。

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash-windows'
```

### Configuration

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `bashPath` | 自动发现 | Git Bash `bash.exe` 的绝对路径。覆盖全部发现出的候选。 |
| `maxOutputBytes` | `64000` | 每个输出流的字节上限。 |

未知键在该行挂载时报错。

### Mount-time preflight

bash 可执行文件在工具**发布之前**就被解析并验证，因此找不到 Git Bash 的部署会在挂载时以可修复的报错失败，而不是发布一个每次调用都会失败的工具。

解析顺序：

1. 配置的 `bashPath`
2. 相对 PATH 解析出的 `git` 的三个候选——其安装根的 `bin`、其自身目录、以及其父目录的 `bin`
3. 约定根目录：`Program Files`、`Program Files (x86)`、`LOCALAPPDATA\Programs`，以及 Scoop shim
4. `PATH` 上的裸 `bash`

配置路径解析不到时，报错会点名该字段。其他所有失败聚合成一个 `AggregateError` 并指名 Git for Windows。

## Understand the implementation

### Executable discovery

带路径分隔符的 `git` 会产出它的相对候选；裸的 PATH 名不产出，因为其安装位置未知。每个根都用该根本身使用的路径风格拼接，因此 Windows 盘符路径和 POSIX 路径都能得到正确结果，整表在保持发现顺序的前提下去重。

解析走一个单方法接缝而不是整个 subprocess 服务，这正是让这些发现规则无需搭起 provider 就能测试的原因。

### One command per call

每次调用在全新进程中启动 `bash -c <command>`，并显式给出工作目录——spawn 接缝不应用任何默认值，所以工具要么传入自己选定的目录，要么传入会话的 cwd。两个流都在配置的上限内收集，然后按顺序合并。

某个后端可能让收集到的读取器不可用；读不到的流贡献为空，而不是让一条已经跑过的命令失败。

### Exit codes

退出码为 0 时返回合并后的流；若命令没有任何输出，则返回 `exit code: N (no output)`。非零退出作为工具失败上报并携带同样的文本，因此模型看到的是命令自己的输出和退出状态，而不是一个不透明的异常。spawn 层面的失败则以独立信息上报，因为那意味着可执行文件本身没有启动。

## Further Exploration

- subprocess 接缝：`packages/subprocess/subprocess`
- 让 `bash` 保持常驻的 tool bootstrap：`packages/tool/tool-bootstrap`
- 本包在 Windows 上替代的官方持久 bash：`packages/shell/tool-bash-persistent`

## Model Experience

### The bash tool

模型看到的是一个描述形状与 Minimal 一致的 `bash` 工具：运行一条 shell 命令，调用之间不保留任何状态。描述直白说明：通过它没有联网能力、状态不在调用之间存活、以及在 Windows 上该命令在没有 OS 沙箱约束的情况下运行。

### Token effect

工具描述大约八行短句，且在整个会话常驻，因此它的成本每个请求付一次。输出默认每个流上限 64KB，这限制了单次调用能增加的内容。

### KV Cache effect

除工具 schema 常驻之外没有影响。无状态的 `bash -c` 调用只把输出加入该请求的消息，而不改变前缀。

## Known Limitations and Deferred Work

### No Windows sandbox confinement

本 harness 自带的沙箱后端是 linux- 和 ACL 范围的，因此 Windows 上的命令不受任何约束。工具描述说明了这一点，但忽略描述的模型并不会被任何机制阻止。

### State does not persist

每次调用都是全新的 shell：没有 `cd`、没有导出变量、没有后台进程存活。这与官方 bash 工具的无状态契约一致，也是让一个请求的前缀保持稳定的原因；但这也意味着多步 shell 工作必须自己重述目录。

### No published invariant

该插件解析一个可执行文件、缓存它、注册一个工具。不存在能与该缓存路径产生分歧的第二份观测，因此不发布 `./invariant` 源码；解析本身的正确性归 subprocess 接缝负责。