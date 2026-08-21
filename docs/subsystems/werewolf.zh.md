# 狼人杀

[English](werewolf.md) | 中文

由 [dsh-werewolf](../../packages/game/werewolf)（`ctx.werewolf`）承载的确定性、事件溯源的单机狼人杀运行时核心，经典角色、阶段与胜利定义位于 [dsh-werewolf-classic](../../packages/game/werewolf-classic)。引擎是角色分配、合法动作、效果应用、阶段转换与胜负判定的唯一权威；模型输出只是结构化输出边界上的不可信输入，该边界随阶段2的 Bot 集成交付。阶段1交付注册表、规则编译器、持久事件、reducer、阶段引擎与 Bot 连续性上下文；Bot 运行器、会话投影与专用游戏视图随[交付计划](../../.agents/notes/proposed/feature/2026-08-20-configurable-werewolf-mode.md)的后续阶段交付。

源码：[`packages/game/werewolf/src/`](../../packages/game/werewolf/src/)

## 规则集与定义注册表

`ctx.werewolf` 拥有四个可信同进程注册表——规则集、角色、阶段、胜利条件——以准确的 `{ id, version }`（规则集为 `{ id, revision }`）为键。注册是调用方 fiber 上的 effect；同一版本下的重复标识符在注册时失败。规则集是这些注册表之上的纯 JSON 配置（[`WerewolfRuleSetInputV1`](../../packages/game/werewolf/src/types.ts)）：以准确版本引用已注册定义、携带纯数据选项，并包含封闭联合策略（`voteTie`、`wolfTie`、`deadHuman`、`maxDays`、`speechMaxChars`）。配置中不含 JavaScript、选择器、回调或表达式语言；新机制以插件注册定义的形式到来，此后规则集无需修改引擎即可使用。

`resolveWerewolfRuleSet()` 是唯一解析注册表引用的操作：它通过各定义自己的解析器解析选项、校验跨字段不变量（牌组数量总和等于 `playerCount`、每个 required 角色绑定都有匹配的阶段出现、不可重复阶段不得在同一列表中重复），并返回带规范 JSON 稳定 SHA-256 摘要的不可变 `WerewolfCompiledRuleSetV1`。`werewolf/game-started` 记录完整规范化规则集、摘要与定义版本，因此恢复与 fork 回放已记录快照，而不会用新部署重新解释进行中的游戏。

## 持久游戏事件

父会话日志是权威游戏记录；每个狼人杀事件都是 log-only，绝不进入模型面或派生历史。九个事件类型覆盖完整生命周期——`game-started`、`phase-opened`、`human-action`、`bot-attempt-failed`（不改变修订）、`bot-decision`、`phase-resolved`、`game-paused`、`game-resumed` 与终止性的 `game-ended`。每个载荷以 `{ version, gameId, gameRevision }` 开头；会改变状态的修订连续且逐次加一。`werewolf/phase-resolved` 携带完整声明式结算（淘汰、保护、资源与角色状态替换、私密通知、公告、投票），因此 reducer 回放时只应用已记录效果，绝不重新运行角色或阶段插件。完整载荷声明位于 [`events.ts`](../../packages/game/werewolf/src/events.ts) 与[持久化事件目录](../persistence-catalog.md)。

## 引擎与生命周期

阶段引擎是纯函数：每一步计算下一批事件并用与回放相同的 reducer 折叠，因此实况对局与回放共用一条代码路径。一个周期按记录顺序遍历 `setup`、`night`、`day` 阶段列表；阶段以不可变动作计划（封闭动作规格词汇：`player-target`、`choice`、`text`、`compound`）开启或跳过；结算按固定记录顺序应用。平票策略由引擎拥有（`no-elimination`、`revote-once`、`seeded-random`），夜间击杀的平刀策略由阶段拥有。胜利在 setup 与每次结算后评估：条件按优先级提出主张，含主张的最低优先级获胜，相同结果合并证据，同一优先级上的分歧结果属于不变量失败。`maxDays` 耗尽仍无其他结果时以平局结束；只有 `abortGame` 能产生 `aborted` 结果。

## One-shot Bot 运行器与观察投影

`projectWerewolfBotObservation` 从折叠状态与已开启计划构造单次决策的授权视图：经注册角色投影器得到行动者角色与私有知识（仅当编译角色声明 `seesFactionTeammates` 时包含队友）、只含公开名册与配置数量的尾部时间线的公开状态、序列化的封闭动作规格，以及该行动者的先前连续性上下文。`runWerewolfBotDecision` 在配置的 provider 上通过 `ctx.subagents.start()` 启动全新子代理——由封闭规格词汇派生的对象根输出 schema、固定 Bot persona、`toolFilter: { allow: [] }`、委派深度上限，以及可选的逐子代理模型路由。结构化结果作为不可信信封先校验动作再校验增量；每次失败尝试以带准确类别（`provider-setup`、`result-rejected`、`timeout`、`invalid-output`、`illegal-action`、`invalid-context-delta`）的分离 `werewolf/bot-attempt-failed` 载荷出现，重试只携带简短诊断，重试耗尽后应用配置的兜底：带引擎生成上下文增量的确定性托管动作，或暂停请求。运行时经过校验的 `Config` 持有 provider 名、重试预算、超时、兜底策略、上下文限制与时间线上限。

## Bot 连续性上下文

每个座位在游戏事件流中拥有一份持久的主观 `WerewolfBotContextV1`——受配置字符与数组限制约束的判断、承诺、策略、记忆摘要与最近决策标识。上下文不是游戏事实：它不能让非法动作变合法，也不能把猜测变成已知信息。每个被接受的决策记录前一个上下文修订、动作、经校验的增量与完整计算的 `contextAfter`，因此每次决策都是独立检查点，增量则解释允许发生的变化。档案由游戏种子确定性分配，并在整局内不可变。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwerewolf--werewolfruntime"></a>

### `ctx.werewolf` — `WerewolfRuntime`

The Werewolf extension surface: registration of rule sets, roles, phases, and victory conditions, plus rule-set compilation against the current registry state.

```ts cordis-catalog
/**
 * The resolved bot runner settings the stage-2 runner consumes.
 *
 * @returns the deployment-resolved runner configuration.
 */
botRunnerConfig(): WerewolfBotRunnerConfigV1

/**
 * Register one role version on the calling fiber.
 *
 * @param definition - the role definition to register.
 * @returns a disposer removing exactly this registration.
 */
registerRole(definition: WerewolfRoleDefinition): () => void

/**
 * Register one phase version on the calling fiber.
 *
 * @param definition - the phase definition to register.
 * @returns a disposer removing exactly this registration.
 */
registerPhase(definition: WerewolfPhaseDefinition): () => void

/**
 * Register one victory-condition version on the calling fiber.
 *
 * @param definition - the victory-condition definition to register.
 * @returns a disposer removing exactly this registration.
 */
registerVictoryCondition(definition: WerewolfVictoryConditionDefinition): () => void

/**
 * Register one immutable `{ id, revision }` rule-set pair on the calling
 * fiber.
 *
 * @param input - the parsed rule-set input to register.
 * @returns a disposer removing exactly this registration.
 */
registerRuleSet(input: WerewolfRuleSetInputV1): () => void

/**
 * Compile one rule set against the current registries.
 *
 * @param input - the raw or parsed rule-set input.
 * @returns the immutable compiled rule set with its digest.
 */
resolveRuleSet(input: JsonValue): WerewolfCompiledRuleSetV1

/**
 * Every registered rule-set input, keyed `${id}@${revision}`.
 *
 * @returns the registered rule-set inputs.
 */
listRuleSets(): ReadonlyMap<string, WerewolfRuleSetInputV1>
```

Source: [`packages/game/werewolf/src/runtime.ts:63`](../../packages/game/werewolf/src/runtime.ts)
<!-- END GENERATED cordis-surface -->
