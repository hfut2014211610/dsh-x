# Agent Note: 会话级文档 workspace 根目录

Status: implemented

[English](2026-08-18-session-scoped-document-workspace-root.md) | 中文

## Problem

本地文档 provider 将每个文档请求解析到 Host 进程启动时捕获的同一个根目录。浏览器开发 Host 通常从目标项目内启动，因此掩盖了该缺陷；打包后的桌面运行时从应用安装目录启动，所以展示了 Electron 资源而不是所选会话的 workspace。同一个全局根目录也无法服务同一 Host 中附加到不同 workspace 的多个会话。

## Decision

[`@deepseek-ai/dsh-documents-local`](../../../../packages/writing/documents-local/README.md) 每次操作都从 `request.sessionId` 指向的权威实时会话解析 workspace 根目录。provider 读取 `ctx.sessions.get(sessionId)?.header.cwd`，以该目录解析文档相对路径，并在访问文件系统前以同一目录执行包含检查。provider 不再提供根目录配置；Host 进程 cwd 和浏览器请求都不能选择文档 workspace。

未知会话或没有 `header.cwd` 的会话以 `DOCUMENT_IO_ERROR` 失败。目录列举、读取、大纲、搜索、新建和编辑都使用这一次会话查询，因此各操作的根目录不会分离。

## Verification

provider 测试挂载真实会话存储与本地文件系统，为两个会话分配不同的 cwd，并证明第二个会话只列出自己的根目录。测试也固定了未知会话和无 cwd 会话的失败行为。组装后的 Web 配置不再传入进程级文档根目录。

## Alternatives considered

**把桌面 sidecar 子进程的 cwd 或 `DSH_CWD` 设置为所选项目。** 未采用，因为一个进程 cwd 仍然不能表示多个实时 workspace，而且持久化会话可以在 Host 启动后选择 workspace。

**让浏览器随每个文档请求发送 workspace 路径。** 未采用，因为浏览器不是 Host 文件系统包含检查的权威来源；会话头已经记录了规范项目 cwd。

## Consequences

浏览器与桌面部署中的文档访问都跟随所选会话，包括服务多个 workspace 的 Host。文档操作要求会话已附加且携带项目 cwd；调用方会收到显式失败，而不是退回 Host 的安装目录或启动目录。
