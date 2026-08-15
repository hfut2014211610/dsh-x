# @personal/dsh-x-model-tuning

每模型采样参数默认值插件：补官方 `llm-pi-ai` 刻意不收的配置面（每模型 `temperature` / `maxTokens` / `stop` / `reasoningEffort` 默认值）。

## 原理

- 注册 `dsh-x-model-tuning` settings 命名空间：cordis patch 的 `config:` 是组合基座，`$DSH_HOME/settings.yaml` 的 `dsh-x-model-tuning:` 段是用户层，按 key 合并，改动下一请求生效。
- 在 `agent/request` waterfall（官方推荐的请求配置改写点，`packages/core/agent/src/model-selection.ts` 同款机制）上按 `provider/model` 匹配条目并替换生效配置；值进入 request header 日志，满足"model-visible ⟺ logged"不变量。
- 斜杠命令 `/model-tuning` 经 settings seam 写入（带校验、持久化、热重载）。

## 加载

```sh
# 临时（overlay）：
pnpm dsh web --patch ./personal/plugins/dsh-x-model-tuning/cordis.patch.yml

# 持久：把 cordis.patch.yml 里的 insert 行追加到 ~/.dsh/profiles/web/cordis.patch.yml
```

无安装步骤：`@deepseek-ai/*` 导入经仓库根 tsconfig paths 解析到源码（`pnpm dsh` 的 tsx 启动与本目录 vitest 都走同一映射），与宿主共享模块实例。

## 配置

```yaml
dsh-x-model-tuning:
  profiles:
    deepseek/deepseek-chat:      # 键 = provider/model（第一个 / 分隔）
      temperature: 0.6           # 0..2
      maxTokens: 8192            # 正整数
      reasoningEffort: high      # off|minimal|low|medium|high|xhigh|max
      stop: ["<END>"]            # 空数组 = 无意见（schema 物化缺失数组所致）
```

语义：条目声明的字段覆盖每个请求；未声明字段透传。键形不合法（无 `/`、单侧为空）在写入时被拒并点名。模型不支持所配 effort 时适配器抛 `UNSUPPORTED_REASONING_EFFORT`。

## 命令

```
/model-tuning                                             查看当前条目
/model-tuning set <provider/model> <字段> <值>             设置（stop 的值为空格分隔多个）
/model-tuning unset <provider/model> [字段]                移除某字段或整条
```

## 测试

```sh
# 在仓库根目录（需 Node ^22.19 || >=24）：
pnpm exec vitest run --config personal/plugins/dsh-x-model-tuning/vitest.config.ts
```

`tsconfig.json` 供编辑器使用；命令行 `tsc -p` 会对 vendor/cordis 源码报与插件无关的诊断（仓库按 project-references 分面编译，vendor 面设置不同），不做为门禁。

## 边界

- 只管 `LlmCallConfig` 四字段；协议/endpoint/contextWindow/思考等级词汇用官方 `llm-pi-ai` 段（见 `personal/model-config.example.yaml`）。
- 任意厂商 body 参数（top_p、enable_search 等）不在官方请求词汇表内，本插件无法注入；需要时走自有 LlmAdapter（重型方案，见会话内计划文档）。
