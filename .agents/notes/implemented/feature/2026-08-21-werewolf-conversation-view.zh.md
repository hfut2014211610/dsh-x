# Agent Note: 狼人杀阶段4——专用会话视图

Status: implemented

[English](2026-08-21-werewolf-conversation-view.md) | 中文

## 问题

阶段 1–3 交付了确定性引擎、初版 Bot 运行器与带类型化 Gateway 的会话 Host——但进入游戏的唯一入口是测试夹具。提案要求一个专用视图，承载大厅、遮盖式身份揭示、游戏桌、通用真人动作表单、观战、暂停/恢复、结算与复盘，不注册斜杠命令，也没有 Chat 输入框的变更路径。该视图还必须让 Host 模型置身游戏输入之外：任何点击都不得产生父模型请求。

## 决策

阶段4新增 `@deepseek-ai/dsh-client-ui-werewolf`——一个 ui-writing 血统的浏览器插件——以及装载它的组合：

1. **视图是投影消费者，不是状态持有者。** `WerewolfView` 的全部值与动词都经槽位注入面获得：该面包装生成的 `ctx.remote.werewolfGame` 命名空间（`getLobby`、`start`、`getView`、`submitAction`、`resume`、`abortGame`、`getReplay`），把 `RemoteResult` 解包为视图值或抛出诊断并以内联可重试错误呈现。修订检查会拒绝旧响应，同阶段刷新则保留展示局部的草稿与选择。重试复用原变更的幂等键；若协调读取表明阶段已经推进，则不再提供过期重试。
2. **刷新只依赖一个转发事件。** `game/projection-invalidated` 加入 `API_REMOTE_FORWARDED_EVENTS`；视图在首次读取前订阅，忽略其他游戏的 id，并通过 `getView` 重读。事件不携带秘密字段，授权完全保留在 Host 投影器中。
3. **大厅需要局前列表。** Gateway 增加附加的 `getLobby` 远端方法，返回按 `{ id, revision }` 排序的已注册规则集选项——这是大厅在游戏尚不存在时唯一可调用的宿主面。
4. **客户端安全迫使三处小型宿主重构。** `@deepseek-ai/dsh-game/types` 不再引用 Agent 或 subagent 类型（执行器契约移入宿主侧 `executor.ts` 模块）；`@deepseek-ai/dsh-werewolf/types` 改为从永不导入引擎或运行器类的模块再导出线类型；投影的注册表依赖改为结构化的 `WerewolfRuleSetSource`。没有这些改动，导入生成的 remote 声明会把宿主专用模块拖进客户端编译面。
5. **表单只渲染封闭词汇。** `player-target`、`choice`、`text` 与 `compound` 分别映射为座位按钮、选项单选、受限文本域与嵌套 fieldset；复合文本字段各自保留草稿，必填子字段控制提交，可见的“过/弃票”发送显式 null 动作。`buildAction` 与 `fieldChoices` 仍是权威阶段规格的纯函数，包括未来角色可能合法选择、但当前名册状态不同的目标。
6. **组合与 Host 导航是数据。** web-app bundle 新增宿主行（`dsh-game`、`dsh-werewolf`、`dsh-werewolf-classic`、`dsh-werewolf/host`）与浏览器视图行。`werewolf` agent preset 贡献 Host persona。`GameModule.hostAgentPreset` 标记专用 `game-<GameId>` Host Session，因此成功开始后会打开该 Session，重新进入时也会直接恢复游戏投影。
7. **私密发现仍由投影持有。** 只有当 `view.self.notices` 含有匹配目标时，浏览器才把座位标记为已知；座位控件与私有栏打开同一条已授权记录。内置预言家通知包含来源天数且只揭示阵营，不推断具体角色；配置化通知类型使用通用键值展示。七个内联中性徽记用于区分座位，不编码角色或阵营。
8. **游戏持有自己的常规输入。** composer chain 接收 Host 确认的 `agentPreset`；狼人杀条目在优先级更高的提问与审批接管之后，为 `werewolf` 会话选择空替代项。因此游戏动作表单是唯一的常规输入，待处理的系统交互仍可回答，其他 preset 则保留默认输入框。
9. **Bot 身份与白天顺序是显式运行时状态。** 游戏开始时为每个非真人座位创建一个整局固定、禁用工具的 Agent Session；该座位后续每次决策和重试都沿用同一个 FIFO 上下文。游戏 Bot Session 保留 Host 父标识，但不写入通用子代理 origin descriptor，因此原生子代理导航不会列出或打开它们。`seat-order-public` 讨论每次只提交一席发言；真人投影公开当前发言人和进度，视图在投票开放前依次呈现全部已完成发言或明确过麦。只有白天阶段结算的投票记录会进入公开时间线，因此私密夜间选人不会被误显示为提前投票。

## 后果

- 八个产品状态全部由 jsdom 行为测试覆盖。桌面/820px/390px DOM 快照固定确定性座位顺序与无障碍结构；由于 jsdom 不计算 CSS 布局，响应式几何与对比度仍需在真实浏览器中评审。
- 无障碍是结构性的：支持方向键选择、Escape 清除并带 `aria-checked` 的单选组，实时状态与错误区域、非颜色座位提示、44px 目标、可见焦点，以及已提交阶段切换后的阶段标题焦点恢复。
- 发现档案测试固定已知座位派生、详情切换、来源天数渲染、通用通知兜底，以及在不扩大授权投影的前提下返回私有身份栏。
- composer 选择测试固定狼人杀接受与非狼人杀拒绝，并覆盖插件 dispose 后移除条目。
- Bot 决策不会调用 Host 模型，游戏自有 Bot Session 也不会出现在原生子代理弹窗中。因此视图包的 Model Experience 段仍记录为“不产生父模型请求”。
- 复盘仍是检查点索引；按天/阶段 scrub 与展示 store 已推迟并记录在包 README 的限制中。

## 备选方案

**把视图接到会话投影。** 阶段4否决：游戏住在自己的 Host 会话里，`SessionProjectionMap` 键需要阶段3 Host 并未发布的逐会话绑定；类型化 remote 加一个转发事件是更小、更诚实的 seam。

**在 Host 里派生真人表单。** Host 已校验一切；渲染与 Bot prompt 序列化使用同一封闭规格，在宿主侧再建一个表单构造器会为相同数据增加第二个所有者。

**斜杠命令兜底。** 提案否决：玩家必须记忆语法，私有资源不直观，游戏发言也会与助手对话混在一起。
