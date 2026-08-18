# @deepseek-ai/dsh-client-ui-ued

English | [中文](README.zh.md)

Browser design-mode plugin. It registers one `conversation.view` tab (`ued`) holding a prototype list and a sandboxed preview frame, declares itself the preferred view for sessions whose `agentPreset` is `ued`, and offers `chat` back as the companion view. Nothing runs on the host: the prototypes come from the existing `documents` Remote surface, and a `documents/changed` frame repaints the preview.

The gate is the preset, not the file type. Without it every session would acquire a render entry for any HTML in its workspace, which widens the untrusted-content boundary from design sessions to all of them.

## The preview frame

The frame renders a document the model wrote — executable markup that no person reviewed — inside the same page as the host's RPC channel. `src/client/sandbox.ts` owns that isolation and is deliberately separate from the view so it can be asserted directly. The decisions and the measurements behind them are in the fork's [iframe security review](../../../personal/docs/notes/proposed/2026-08-18-ued-preview-iframe-security.md).

Three properties carry it:

- **`sandbox="allow-scripts"`, never beside `allow-same-origin`.** Together they put the framed document on the host's origin, from where it reaches `parent.document`, deletes its own `sandbox` attribute and reloads with full privileges. Nothing about the preview looks different when this is wrong, so the tests assert the token set both ways — the grant is exactly `allow-scripts`, and every widening token is absent.
- **`srcdoc`, never a host-origin route.** A prototype served from this origin would carry a valid same-origin `Origin` to `/api` and defeat the sandbox regardless of its attributes. No route serves workspace files, and none may be added for this.
- **An injected `Content-Security-Policy` meta.** A `srcdoc` document inherits the embedder's policy, and this app declares none, so the policy travels inside the document. It enforces what the `ued` prompt section only asks for — self-contained, no network-loaded assets — and denies the frame every subresource origin. Placement matters: a meta ahead of `<!doctype html>` drops the page into quirks mode, so the insert goes after `<head>` and manufactures one when the document has none. This is defence in depth; markup that defeats the insert is still confined by the sandbox.

The frame keeps a visible border and a preview badge. A prototype can draw something that looks like the host's own settings page, and the sandbox does not address that.

## Refresh

A design thread keeps writing after the turn that started it ends, and several threads can write within the same second. The view repaints on the trailing edge of a `documents/changed` burst for the previewed path, so the frame never shows a document caught mid-write. A late read for a prototype the person has already navigated away from is discarded rather than painted.

## Model Experience

None, as this package only renders documents the `documents` seam already owns; it registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Replacing `srcdoc` reloads the frame** — scroll position inside the prototype is lost on refresh. Restoring it means injecting script into the prototype, which conflicts with keeping it self-contained.
- **No in-view editing** — the view reads prototypes; changing one goes through the model, as the design policy requires.
