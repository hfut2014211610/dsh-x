# dsh-client-ui-werewolf

[English](README.md) | 中文

专用狼人杀会话视图：带准确 `{ id, revision }` 规则集卡片的大厅、刻意的遮盖式身份揭示、含公开时间线与真人私有栏的昼/夜游戏桌、封闭规格词汇之上的通用动作表单、观战状态、带确认保护的暂停/恢复、全身份揭示的结算，以及授权复盘。本插件不注册任何命令，也没有 Chat 输入框的变更路径——视图是唯一受支持的游戏入口。

## 它做什么

- **视图注册** —— 注入 `conversation.view` 槽条目 `werewolf`（顺序 6）并带双语标签；对 `agentPreset` 为 `werewolf` 的会话声明首选视图，但不覆盖用户持久化的 tab 选择。
- **类型化 Remote 动词** —— 注入面包装 `ctx.remote.werewolfGame`（`getLobby`、`start`、`getView`、`submitAction`、`resume`、`abortGame`、`getReplay`），把 `RemoteResult` 解包为视图值或抛出诊断，前端以内联可重试错误呈现。
- **失效刷新** —— 首次读取前订阅转发的 `game/projection-invalidated` 宿主事件，忽略其他游戏的事件并通过 `getView` 重读；变更响应直接替换投影，因此客户端除展示偏好外不持有任何游戏状态。
- **交互状态** —— 大厅、遮盖揭示（两步交互，不依赖翻牌动画）、以图标/文字/样式共同表达座位状态并有粘性阶段标题的游戏桌、带隐私提示的夜间聚焦、带字数上限文本编辑器的白天发言、带单选组选择与粘性确认的投票、观战标注，以及带复盘检查点的结算。
- **通用动作表单** —— 只渲染封闭规格词汇：`player-target`、`choice`、`text`、`compound`；字段 id 稳定，文本草稿受 `maxChars` 限制，仅当 `allowSkip` 允许时出现跳过。配置无法携带 HTML、CSS、回调或组件名。
- **无障碍** —— 座位以文字公告状态，键盘按 DOM 顺序可达所有控件，单选组使用 `role="radio"` 与 `aria-checked`，忙碌与错误区域使用 `role="status"`/`role="alert"`，阶段标题带 `tabindex={-1}` 以便提交后恢复焦点。

## 模型体验

None, as the game view renders host-authorized projections in the browser; view actions create no parent model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## 已知限制与遗留工作

- **尚无展示 store** —— 草稿、侧栏状态与动画开关仍是组件局部的；跨刷新的注册客户端展示 store 随打磨阶段交付。
- **复盘按检查点索引** —— 复盘列出授权修订，尚无按天/阶段 scrub；scrub 式复盘随阶段5文档批次到来。
- **无装饰性卡图** —— 身份牌刻意使用中性背纹；图片加载失败时整局游戏仍完整可理解。
