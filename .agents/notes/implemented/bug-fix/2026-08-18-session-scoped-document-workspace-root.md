# Agent Note: Session-scoped document workspace roots

Status: implemented

English | [中文](2026-08-18-session-scoped-document-workspace-root.zh.md)

## Problem

The local document provider resolved every document request against one root captured from the Host process at startup. A browser development Host often starts inside the intended project and concealed the defect, while the packaged desktop runtime starts inside the installed application and exposed Electron resources instead of the selected session workspace. One global root also cannot serve sessions attached to different workspaces in the same Host.

## Decision

[`@deepseek-ai/dsh-documents-local`](../../../../packages/writing/documents-local/README.md) resolves the workspace root for every operation from the authoritative live session named by `request.sessionId`. The provider reads `ctx.sessions.get(sessionId)?.header.cwd`, resolves relative document paths against that directory, and enforces containment against the same directory before filesystem access. The provider has no root configuration; Host process cwd and browser payloads do not select a document workspace.

An unknown session or a session without `header.cwd` fails with `DOCUMENT_IO_ERROR`. Directory listing, read, outline, search, create, and edit all use this same session lookup, so their roots cannot diverge.

## Verification

The provider test mounts the real session store and local filesystem, assigns two sessions different cwd values, and proves the second session lists only its own root. The suite also pins failure for unknown and cwd-less sessions. The assembled web configuration no longer supplies a process-wide document root.

## Alternatives considered

**Set the desktop sidecar child cwd or `DSH_CWD` to the selected project.** Rejected because one process cwd still cannot represent several live workspaces, and persisted sessions can select a workspace after the Host starts.

**Send the workspace path from the browser with every document request.** Rejected because the browser is not the authority for Host filesystem containment; the session header already records the canonical project cwd.

## Consequences

Document access follows the selected session in browser and desktop deployments, including Hosts serving multiple workspaces. A document operation requires the session to be attached and to carry a project cwd; callers receive an explicit failure instead of falling back to the Host installation or launch directory.
