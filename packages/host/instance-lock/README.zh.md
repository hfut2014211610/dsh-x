# @deepseek-ai/dsh-host-instance-lock

[English](README.md) | 中文

同一个 harness home 已经有一个 `dsh` runtime 时，拒绝再起第二个。

`$DSH_HOME` 底下所有归 runtime 所有的东西，写的时候都当自己是独一份。settings 文档每次写会拿写者锁，但会话目录一个日志只有一条序列，且完全没有锁。两个 runtime 在那里不会争抢文件——它们会**交错编号**，一份 18000 条事件的对话就是这么变得读不出来的：第二个 runtime 打开了第一个还在写的日志，判定那个回合被中断了，于是在第一个正要用的序号上写了三条收尾。读取侧后来被教会从这种情况里恢复；但没有任何东西阻止它再次发生。

## 这把刀是故意钝的

让会话所有权跨进程可见才是彻底的答案，也是大得多的一件事：它需要一套所有权协议，写者是谁、什么时候释放、崩溃后谁清理都得定死。而拒绝起第二个 runtime 是把这个局面**消掉**，不是去管理它。

不挂这一行的一次性命令——`dsh plugin`、`dsh --dump-config`——不受影响：它们不是 runtime，也不写会话。

## 拒绝走 `ctx.appExit`

不是在 `apply` 里抛异常。插件抛异常只会让自己那个条目失败，其余照常起来——而这恰恰是守卫绝不能有的结果：runtime 起来了，守卫没了，而这个 home 正被别人占着。`ctx.appExit` 是启动器那条有界退出：它拆掉整棵树然后停。

## 字条是个文件，只在它记的 pid 还活着时算数

harness home 下的 `instance.json` 里记着 pid、启动的 profile，以及一个只给人看的开始时间戳。**光有 pid 不构成身份**：操作系统会重用 pid，断电的机器留下的字条记的那个号现在可能属于任何东西。所以死掉的字条被**接管**而不是被遵守——为一张崩溃留下的字条拒绝启动，比它本要预防的那次冲突更糟。

这些判断全在 `src/claim.ts` 里，是一个纯函数：输入是解析后的字条、本进程 pid、一个存活判定谓词。文件系统和进程表归调用方，这正是每个分支都能脱离两者被测到的原因。

## 配置

| 键 | 默认 | 作用 |
|---|---|---|
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 守哪个 home。 |
| `profile` | `unknown` | 拒绝时报出来的 profile 名，让消息指得到一个真实存在的东西。 |
| `enforce` | `true` | 关掉是给那种确实想在一个 home 上跑两个 runtime、并接受共享会话日志后果的部署用的。 |

## Model Experience

None, as this package guards process startup and registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **字条是劝告，不是锁** — 从读到已有字条到写下自己那张之间，同一瞬间启动的第二个 runtime 会通过同一次检查。这个窗口只有一次文件写那么宽，而它防的是人手快点了两次，不是竞态；要真正关上它，就得做本包存在的意义正是为了避免的那套所有权协议。
- **别的机器上活着的 pid 在这里也读作活着** — 字条里没有机器身份，所以一个共享的网络 home 会遵守一张 pid 恰好撞上本地某个进程的字条。harness home 本来是本地的；共享的话得加一个 host 字段。
- **拒绝的粒度是整个 home** — 边界画在 harness home 而不是会话目录上，所以两个永远不会碰同一个会话的 runtime 也照样被拒。把边界画到会话目录上，就是上面说的那个大得多的答案。
