# 狼人杀

[English](werewolf.md) | 中文

确定性、事件溯源的单机狼人杀运行时由 [dsh-werewolf](../../packages/game/werewolf)（`ctx.werewolf`）承载，经典定义位于 [dsh-werewolf-classic](../../packages/game/werewolf-classic)，通用 Session Host 位于 [dsh-game](../../packages/game/game)（`ctx.games`）。角色、合法动作、效果、阶段与胜负只由引擎裁决；模型输出始终是不可信结构化输入。已交付模式包含确定性核心、每个非真人座位一个整局固定且保留上下文的 Bot Agent、每局一个专用 Host Agent 和 Session、原子命令批次、类型化 Host 方法、真人授权投影、终局回放与专用 Web 游戏视图。

源码：[`packages/game/werewolf/src/`](../../packages/game/werewolf/src/)

## 规则集与定义注册表

`ctx.werewolf` 拥有四个可信同进程注册表——规则集、角色、阶段、胜利条件——以准确的 `{ id, version }`（规则集为 `{ id, revision }`）为键。注册是调用方 fiber 上的 effect；同一版本下的重复标识符在注册时失败。规则集是这些注册表之上的纯 JSON 配置（[`WerewolfRuleSetInputV1`](../../packages/game/werewolf/src/types.ts)）：以准确版本引用已注册定义、携带纯数据选项，并包含封闭联合策略（`voteTie`、`wolfTie`、`deadHuman`、`maxDays`、`speechMaxChars`）。配置中不含 JavaScript、选择器、回调或表达式语言；新机制以插件注册定义的形式到来，此后规则集无需修改引擎即可使用。

`resolveWerewolfRuleSet()` 是唯一解析注册表引用的操作：它通过各定义自己的解析器解析选项、校验跨字段不变量（牌组数量总和等于 `playerCount`、每个 required 角色绑定都有匹配的阶段出现、不可重复阶段不得在同一列表中重复），并返回带规范 JSON 稳定 SHA-256 摘要的不可变 `WerewolfCompiledRuleSetV1`。`werewolf/game-started` 记录完整规范化规则集、摘要与定义版本，因此恢复与 fork 回放已记录快照，而不会用新部署重新解释进行中的游戏。

## 持久游戏事件

父会话日志是权威游戏记录；每个狼人杀事件都是 log-only，绝不进入模型面或派生历史。九个事件类型覆盖完整生命周期——`game-started`、`phase-opened`、`human-action`、`bot-attempt-failed`（不改变修订）、`bot-decision`、`phase-resolved`、`game-paused`、`game-resumed` 与终止性的 `game-ended`。每个载荷以 `{ version, gameId, gameRevision }` 开头；会改变状态的修订连续且逐次加一。`werewolf/phase-resolved` 携带完整声明式结算（淘汰、保护、资源与角色状态替换、私密通知、公告、投票），因此 reducer 回放时只应用已记录效果，绝不重新运行角色或阶段插件。完整载荷声明位于 [`events.ts`](../../packages/game/werewolf/src/events.ts) 与[持久化事件目录](../persistence-catalog.zh.md)。

## 引擎与生命周期

阶段引擎是纯函数：每一步计算下一批事件并用与回放相同的 reducer 折叠，因此实况对局与回放共用一条代码路径。一个周期按记录顺序遍历 `setup`、`night`、`day` 阶段列表；阶段以不可变动作计划（封闭动作规格词汇：`player-target`、`choice`、`text`、`compound`）开启或跳过；结算按固定记录顺序应用。平票策略由引擎拥有（`no-elimination`、`revote-once`、`seeded-random`），夜间击杀的平刀策略由阶段拥有。胜利在 setup 与每次结算后评估：条件按优先级提出主张，含主张的最低优先级获胜，相同结果合并证据，同一优先级上的分歧结果属于不变量失败。`maxDays` 耗尽仍无其他结果时以平局结束；只有 `abortGame` 能产生 `aborted` 结果。

## 固定 Bot Agent 与观察投影

`projectWerewolfBotObservation` 首先证明请求仍匹配折叠状态中的游戏标识与修订、已开启阶段与动作计划、编译规则摘要、待决策行动者及其准确的当前连续性上下文，再构造授权视图：经注册角色投影器得到行动者角色与私有知识（仅当角色声明 `seesFactionTeammates` 时包含队友），公开状态包含玩家 id 与名册事实，合法动作与先前上下文均取自权威状态。第一次决策携带配置数量的尾部时间线；固定 Session 的后续决策只携带该 Bot 上一次已提交决策后新增的公开记录。`WerewolfGameModule.initializeAgents()` 会在 `start` 返回前为每个非真人座位创建一个确定性、禁用工具的 Bot Agent Session。不可变 persona 在整局内固定座位、角色、阵营与性格；可选 `botReasoningEffort` 会在创建 Agent 时固定，并应用于其后每次模型请求。后续每次决策都按 FIFO 送入同一个 Agent Session，因此先前请求与回答持续留在模型上下文中。这些游戏自有 Session 记录 Host 父标识，但不带通用子代理 origin descriptor，所以不会出现在普通子代理目录或弹窗中。结构化结果仍是不可信输入，依次校验动作与上下文增量。每条 prompt 只允许 `action` 与 `contextDelta` 两个根键，明确当前阶段准确的动作对象，把文本动作的 `value` 映射为公开发言，并把增量限制为发生变化的主观字段。显式且合法的 `publicSpeech` 字符串可以恢复格式错误的文本动作，并成为它的规范 `value`；常规动作与发言校验仍会执行阶段和长度限制。失败尝试保留准确类别并在同一 Bot Session 上重试，重试会追加拒绝诊断并重复这份精简输出约定，而不重新发送观察。重试耗尽后执行确定性托管动作或暂停游戏。`GameAiExecutor` 补入操作 signal，执行 `maxConcurrentBots`，保持结果顺序，且绝不调用 Host 模型。

## Session Host、命令与真人投影

`WerewolfGameModule` 是注册到 `ctx.games` 的薄领域适配器。`start` 在 Host 存在前校验准确规则集修订。通用 provider 创建 `game-<GameId>`，原子提交 `game/command-receipt` 与 `werewolf/game-started`，创建固定 Bot Agent，并返回已初始化投影。随后狼人杀的后台自动调度经同一局串行队列逐个发布阶段或 Bot 决策单元，每个单元都会使真人投影失效。`seat-order-public` 阶段每次只结算尚未发言的首个存活座位；该发言记录前下一座位不能行动，已接受文本的 `action.value` 会成为可见公开发言，全部计划发言完成前投票阶段不能开启。`submitAction`、`resume`、`abortGame` 携带调用方 request id 与 expected revision。相同 payload 的重复请求返回当前视图；同一键配另一 payload 会冲突，新请求携带过期修订则拒绝。

`Session.appendBatch()` 在改变实时日志前，针对影子前缀校验 JSON、完整 surface 转换和同步注册不变量。拒绝时事件、surface、观察者与修订均不改变。成功时完整批次先变得可见，再按顺序发布事件。通用回执与狼人杀事件均为 log-only。

`WerewolfGameGateway` 暴露类型化 `getLobby`、`start`、`getView`、`getReplay`、`submitAction`、`resume`、`abortGame`。Host Agent 继承部署当前的 `agentDefaultModel` 路由，因此未配置逐局覆盖时，固定 Bot Agent 也能继承完整的 provider/model。`getLobby` 通过 `ctx.games.listViews()` 按新到旧返回本地主体的运行中与已暂停对局。Gateway 在内部解析版本1本地主体；请求不能选择 Session、participant、player 或座位。`WerewolfHumanViewV1` 投影公开事实，以及仅属于绑定真人的角色、获授权队友、资源、通知与当前表单。最终视图在结果产生后揭示角色。`getReplay` 拒绝活跃游戏，并返回授权检查点而非原始事件、Bot 上下文或子代理 prompt。

## 独立应用窗口

`@deepseek-ai/dsh-client-ui-werewolf` 注册 `sidebar.footer.action` 入口，打开带 `dshMode=werewolf` 的具名窗口。只有该 URL 会选择插件的 `shell.surface` 条目，因此主窗口保留当前会话，而游戏窗口不挂载 preset 切换器、Session 侧边栏、会话区、详情区或通用覆盖层。所选 `gameId` 保留在窗口 URL 中；未选择对局时，大厅会从 Host 列出运行中与已暂停对局。游戏 Host Session 不进入普通工作区导航。注入面包装生成的 `ctx.remote.werewolfGame` 命名空间——`getLobby`、`start`、`getView`、`submitAction`、`resume`、`abortGame`、`getReplay`——并订阅转发的 `game/projection-invalidated` 事件，忽略其他游戏并通过 `getView` 重读。白天讨论时，视图会显示当前发言人、已完成/总发言数，以及按公开顺序记录的每条发言或明确过麦，并说明最后一席完成后才进入投票。获授权可见的队友会得到图标和文字标识，但不会揭示其角色。表单只渲染封闭规格词汇（`player-target`、`choice`、`text`、`compound`）；浏览器不会收到 Bot 上下文、Agent prompt 或原始秘密事件。不存在斜杠命令或狼人杀 agent preset，只有类型化游戏动作能改变游戏状态。

## Bot 连续性上下文

每个座位在游戏事件流中拥有一份持久的主观 `WerewolfBotContextV1`——受配置字符与数组限制约束的判断、承诺、策略、记忆摘要与最近决策标识。上下文不是游戏事实：它不能让非法动作变合法，也不能把猜测变成已知信息。每个被接受的决策记录前一个上下文修订、动作、经校验的增量与完整计算的 `contextAfter`，因此每次决策都是独立检查点，增量则解释允许发生的变化。档案由游戏种子确定性分配，并在整局内不可变。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgames--gameservice-abstract-seam"></a>

### `ctx.games` — `GameService` (abstract seam)

Shared game Host contract implemented by the default Session provider.

```ts cordis-catalog
/**
 * Register one exact module version as a caller-owned effect.
 * @param module - domain adapter to register.
 * @returns disposer that removes this exact registration.
 */
abstract registerModule(module: GameModule): () => void

/**
 * Resolve the version-1 loopback principal.
 * @returns authenticated local principal.
 */
abstract resolvePrincipal(): LocalGamePrincipalV1

/**
 * Create a dedicated Host, commit start atomically, initialize fixed Agents, and schedule automatic advancement.
 * @param request - module, idempotency key, initial revision, and module input.
 * @returns projection after foreground advancement, or after initialization when the module schedules in the background.
 */
abstract start<TView>(request: { moduleId: string requestId: GameRequestId expectedGameRevision: 0 input: JsonValue }): Promise<GameProjection<TView>>

/**
 * List every game of one module authorized for the principal, newest first.
 * @param moduleId - exact registered module id.
 * @param principalId - authenticated caller.
 * @returns authorized projections ordered by Host creation time.
 */
abstract listViews<TView>(moduleId: string, principalId: PrincipalId): Promise<GameProjection<TView>[]>

/**
 * Return the current authorized view. Reading is a side-effectful kick for a
 * background-scheduling module: uninitialized fixed Agents plus a running
 * game schedule one automatic advancement.
 * @param gameId - game to read.
 * @param principalId - authenticated caller.
 * @returns current authorized projection.
 */
abstract getView<TView>(gameId: GameId, principalId: PrincipalId): Promise<GameProjection<TView>>

/**
 * Return the authorized module replay.
 * @param gameId - game to replay.
 * @param principalId - authenticated caller.
 * @returns module-defined authorized replay.
 */
abstract getReplay<TReplay>(gameId: GameId, principalId: PrincipalId): Promise<TReplay>

/**
 * Commit one human action and schedule automatic advancement.
 * @param request - authorized compare-and-set action.
 * @returns projection after foreground advancement, or after the action when the module schedules in the background.
 */
abstract submitAction<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number action: JsonValue }): Promise<GameProjection<TView>>

/**
 * Resume one paused game and schedule automatic advancement.
 * @param request - authorized compare-and-set resume request.
 * @returns projection after foreground advancement, or after resume when the module schedules in the background.
 */
abstract resume<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number }): Promise<GameProjection<TView>>

/**
 * Record an aborted terminal result.
 * @param request - authorized compare-and-set abort request.
 * @returns terminal authorized projection.
 */
abstract abortGame<TView>(request: { gameId: GameId principalId: PrincipalId requestId: GameRequestId expectedGameRevision: number }): Promise<GameProjection<TView>>

/**
 * Resolve one game to its dedicated live Host Session.
 * @param gameId - game to inspect.
 * @returns indexed Host Session, when known to this process.
 */
abstract getHostSession(gameId: GameId): Session | undefined
```

Types: [Session](session.zh.md)

Source: [`packages/game/game/src/service.ts`](../../packages/game/game/src/service.ts)

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

Source: [`packages/game/werewolf/src/runtime.ts`](../../packages/game/werewolf/src/runtime.ts)

<a id="ctxwerewolfgame--werewolfgamegateway"></a>

### `ctx.werewolfGame` — `WerewolfGameGateway`

Registers the Werewolf module and exposes the UI-facing typed methods.

```ts cordis-catalog
/**
 * List registered rule sets and resumable games for the local lobby.
 * @returns rule-set options plus authorized running and paused games.
 */
@Remote('getLobby') async getLobby(): Promise<WerewolfLobbyViewV1>

/**
 * Start one local single-player game.
 * @param request - rule selection, seed, and caller idempotency key.
 * @returns current human-authorized projection.
 */
@Remote('start') async start(request: WerewolfStartRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Read the current view for the locally authenticated principal.
 * @param request - game identity.
 * @returns current human-authorized projection.
 */
@Remote('getView') async getView(request: { gameId: string }): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Read the terminal authorized replay.
 * @param request - game identity.
 * @returns replay containing authorized checkpoints.
 */
@Remote('getReplay') async getReplay(request: { gameId: string }): Promise<WerewolfReplayV1>

/**
 * Submit one action for the current human form.
 * @param request - phase-bound compare-and-set action.
 * @returns current human-authorized projection after automatic advancement.
 */
@Remote('submitAction') async submitAction(request: WerewolfSubmitActionRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Resume one paused game.
 * @param request - compare-and-set resume request.
 * @returns current human-authorized projection after automatic advancement.
 */
@Remote('resume') async resume(request: WerewolfHostMutationRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>

/**
 * Abort one running or paused game.
 * @param request - compare-and-set abort request.
 * @returns terminal human-authorized projection.
 */
@Remote('abortGame') async abortGame(request: WerewolfHostMutationRequestV1): Promise<GameProjection<WerewolfHumanViewV1>>
```

Source: [`packages/game/werewolf/src/host.ts`](../../packages/game/werewolf/src/host.ts)

<a id="game-events"></a>

### `game/*` events

<a id="gameprojection-invalidated--emit"></a>

#### `game/projection-invalidated` — emit

Announce that authorized readers must re-read one game projection. The event deliberately carries no identity or hidden view data.

```ts cordis-catalog
/**
 * Announce that authorized readers must re-read one game projection.
 * The event deliberately carries no identity or hidden view data.
 * @param gameId - changed game.
 * @param gameRevision - committed domain revision.
 * @mode emit
 */
'game/projection-invalidated'(gameId: GameId, gameRevision: number): void
```

Source: [`packages/game/game/src/types.ts`](../../packages/game/game/src/types.ts)
<!-- END GENERATED cordis-surface -->
