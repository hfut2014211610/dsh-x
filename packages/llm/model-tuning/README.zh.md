# @deepseek-ai/dsh-model-tuning

[English](README.md) | 中文

每模型采样参数默认值：补上官方 `llm-pi-ai` 刻意不收的那块配置面（每模型 `temperature` / `maxTokens` / `stop` / `reasoningEffort`）。

## 原理

- 注册 `dsh-x-model-tuning` settings 命名空间。cordis patch 的 `config:` 是组合基座，`$DSH_HOME/settings.yaml` 的 `dsh-x-model-tuning:` 段是用户层，两者按 key 合并，改动下一次请求生效。
- 在 `agent/request` waterfall 上按 `provider/model` 匹配条目并替换生效配置——这是官方认可的请求配置改写点，`packages/core/agent/src/model-selection.ts` 用的是同一套机制。值会进入 request header 日志，这正是「model-visible ⟺ logged」不变量所要求的。
- 斜杠命令 `/model-tuning` 经 settings seam 写入，校验、持久化、热重载都是白拿的。

## 加载

Web bundle 默认挂载本包；`profiles` 为空即休眠，不产生任何开销。要挂到别的组合上：

```sh
# One run (overlay):
pnpm dsh web --patch ./packages/llm/model-tuning/cordis.patch.yml

# Persistent: append the insert rows from cordis.patch.yml to
# ~/.dsh/profiles/<name>/cordis.patch.yml
```

## 配置

```yaml
dsh-x-model-tuning:
  profiles:
    deepseek/deepseek-chat:      # key = provider/model, split at the first /
      temperature: 0.6           # 0..2
      maxTokens: 8192            # positive integer
      reasoningEffort: high      # off|minimal|low|medium|high|xhigh|max
      stop: ["<END>"]            # an empty array means no opinion
```

条目声明了的字段覆盖到该模型的每个请求；没声明的字段原样透传，所以界面上选的思考等级除非条目自己声明，否则不会被动。键形不合法（没有 `/`、或某一侧为空）在写入时就被拒并点名。模型不支持所配 effort 时，适配器抛 `UNSUPPORTED_REASONING_EFFORT`，请求失败得很响。

## 命令

```
/model-tuning                                          show the current entries
/model-tuning set <provider/model> <field> <value>     set one field (stop takes space-separated values)
/model-tuning unset <provider/model> [field]           drop one field, or the whole entry
```

## 测试

```sh
pnpm exec vitest run packages/llm/model-tuning
```

## 边界

- 只管 `LlmCallConfig` 那四个字段。协议、endpoint、上下文窗口、思考等级词汇属于官方 `llm-pi-ai` 段。
- 厂商私有的 body 参数（`top_p`、`enable_search` 之类）不在官方请求词汇表里，本包注入不了。真要用得自己写一个 `LlmAdapter`，那是大得多的工程。
