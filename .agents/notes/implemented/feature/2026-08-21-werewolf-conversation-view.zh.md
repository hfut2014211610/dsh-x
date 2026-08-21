# Agent Note: 狼人杀阶段4——专用会话视图

Status: implemented

[English](2026-08-21-werewolf-conversation-view.md) | 中文

## 问题

阶段 1–3 交付了确定性引擎、one-shot Bot 运行器与带类型化 Gateway 的会话 Host——但进入游戏的唯一入口是测试夹具。提案要求一个专用视图，承载大厅、遮盖式身份揭示、游戏桌、通用真人动作表单、观战、暂停/恢复、结算与复盘，不注册斜杠命令，也没有 Chat 输入框的变更路径。该视图还必须让模型置身游戏输入之外：任何点击都不得产生父模型请求。

## 决策

阶段4新增 `@deepseek-ai/dsh-client-ui-werewolf`——一个 ui-writing 血统的浏览器插件——以及装载它的组合：

1. **视图是投影消费者，不是状态持有者。** `WerewolfView` 的全部值与动词都经槽位注入面获得：该面包装生成的 `ctx.remote.werewolfGame` 命名空间（`getLobby`、`start`、`getView`、`submitAction`、`resume`、`abortGame`、`getReplay`），把 `RemoteResult` 解包为视图值或抛出诊断并以内联可重试错误呈现。每次变更后，响应投影直接替换当前投影；客户端仅存的展示局部状态是揭示步骤、草稿、选择与复盘面板。
2. **刷新只依赖一个转发事件。** `game/projection-invalidated` 加入 `API_REMOTE_FORWARDED_EVENTS`；视图在首次读取前订阅，忽略其他游戏的 id，并通过 `getView` 重读。事件不携带秘密字段，授权完全保留在 Host 投影器中。
3. **大厅需要局前列表。** Gateway 增加附加的 `getLobby` 远端方法，返回按 `{ id, revision }` 排序的已注册规则集选项——这是大厅在游戏尚不存在时唯一可调用的宿主面。
4. **客户端安全迫使三处小型宿主重构。** `@deepseek-ai/dsh-game/types` 不再引用 Agent 或 subagent 类型（执行器契约移入宿主侧 `executor.ts` 模块）；`@deepseek-ai/dsh-werewolf/types` 改为从永不导入引擎或运行器类的模块再导出线类型；投影的注册表依赖改为结构化的 `WerewolfRuleSetSource`。没有这些改动，导入生成的 remote 声明会把宿主专用模块拖进客户端编译面。
5. **表单只渲染封闭词汇。** `player-target`、`choice`、`text` 与 `compound` 分别映射为座位按钮、选项单选、受限文本域与嵌套 fieldset；`buildAction` 与 `fieldChoices` 是规格的纯函数，投票确认、发言边界与跳过可见性全部由权威阶段数据派生。
6. **组合是数据。** web-app bundle 新增宿主行（`dsh-game`、`dsh-werewolf`、`dsh-werewolf-classic`、`dsh-werewolf/host`），复用基础 bundle 的 `spawn` provider；浏览器行为视图；`werewolf` agent preset 只贡献一个 persona：preset 会话仍是普通活跃 Agent，其伴随面即游戏视图。

## 后果

- 八个产品状态全部由 jsdom 行为测试覆盖；桌面/820px/390px 布局快照固定了确定性座位顺序、粘性阶段状态与移动端座位轮播。
- 无障碍是结构性的：带 `aria-checked` 的单选组、`role="status"`/`role="alert"` 区域、非颜色座位提示、44px 目标与提交后可恢复焦点的阶段标题。
- Bot 子代理面未变：阶段4不增加任何模型可见的父输入，因此视图包的 Model Experience 段以“不存在”作为契约记录。
- 复盘仍是检查点索引；按天/阶段 scrub 与展示 store 已推迟并记录在包 README 的限制中。

## 备选方案

**把视图接到会话投影。** 阶段4否决：游戏住在自己的 Host 会话里，`SessionProjectionMap` 键需要阶段3 Host 并未发布的逐会话绑定；类型化 remote 加一个转发事件是更小、更诚实的 seam。

**在 Host 里派生真人表单。** Host 已校验一切；渲染与 Bot prompt 序列化使用同一封闭规格，在宿主侧再建一个表单构造器会为相同数据增加第二个所有者。

**斜杠命令兜底。** 提案否决：玩家必须记忆语法，私有资源不直观，游戏发言也会与助手对话混在一起。
