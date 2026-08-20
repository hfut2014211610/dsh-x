#!/usr/bin/env node
/**
 * 桥接进程的发布入口。
 *
 * 桥接本体在 `./bridge/main.ts`，这里只是把它放到仓库约定的 bin 位置上：
 * 每个包的可执行文件都发布为 `lib/bin.js`（`scripts/check-workspace-constraints.ts`
 * 按这条规则推导 `files`），而桥接不能改成从 `lib/bridge/` 下的散装 tsc 产物
 * 起——那要求发布时那一整棵目录都在。打成一个文件也更合它的本分：**桥接得在
 * dsh 挂了以后还能顶上**，少一个可能缺失的文件就少一种顶不上的方式。
 * @module @deepseek-ai/dsh-feishu/bin
 */

import './bridge/main.ts'
