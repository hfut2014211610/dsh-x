# @deepseek-ai/dsh-client-ui-ued

English | [中文](README.zh.md)

Browser design-mode plugin. It registers one `conversation.view` tab (`ued`) holding a prototype list and a sandboxed preview frame, declares itself the preferred view for sessions whose `agentPreset` is `ued`, and offers `chat` back as the companion view. Nothing runs on the host: the prototypes come from the existing `documents` Remote surface, and a `documents/changed` frame repaints the preview.

The gate is the preset, not the file type: it decides which sessions *open* on this view, so nothing renders a model-written page unless the session was started to design one. Be precise about what that gate is not — `conversation.view` has no per-session filter, so the tab itself is registered for every session, exactly as `ui-writing`'s is. A person in an ordinary chat session can still click Design and render HTML from that workspace. What the preset removes is the automatic path.

## The preview frame

The frame renders a document the model wrote — executable markup that no person reviewed — inside the same page as the host's RPC channel. `src/client/sandbox.ts` owns that isolation and is deliberately separate from the view so it can be asserted directly. The decisions and the measurements behind them are in the fork's [iframe security review](../../../personal/docs/notes/proposed/2026-08-18-ued-preview-iframe-security.md).

Three properties carry it:

- **`sandbox="allow-scripts"`, never beside `allow-same-origin`.** Together they put the framed document on the host's origin, from where it reaches `parent.document`, deletes its own `sandbox` attribute and reloads with full privileges. Nothing about the preview looks different when this is wrong, so the tests assert the token set both ways — the grant is exactly `allow-scripts`, and every widening token is absent.
- **`srcdoc`, never a host-origin route.** A prototype served from this origin would carry a valid same-origin `Origin` to `/api` and defeat the sandbox regardless of its attributes. No route serves workspace files, and none may be added for this.
- **An injected `Content-Security-Policy` meta.** A `srcdoc` document inherits the embedder's policy, and this app declares none, so the policy travels inside the document. It enforces what the `ued` prompt section only asks for — self-contained, no network-loaded assets — and denies the frame every subresource origin. Placement matters: a meta ahead of `<!doctype html>` drops the page into quirks mode, so the insert goes after `<head>` and manufactures one when the document has none. This is defence in depth; markup that defeats the insert is still confined by the sandbox.

The frame keeps a visible border and a preview badge. A prototype can draw something that looks like the host's own settings page, and the sandbox does not address that.

## Picking an element

Annotating a component means naming one element of a document the host cannot read. `sandbox="allow-scripts"` without `allow-same-origin` makes `contentDocument` null by design, so there is no host-side hit test to run: the pick happens inside the frame, in a script injected beside the policy, and the answer comes back over `postMessage`. `src/client/inspect.ts` owns both halves.

Three things about that channel carry the weight.

- **The reply cannot be authenticated by origin.** A document in an opaque origin posts with `event.origin === 'null'` — and so does every other sandboxed frame on the page, which makes the string worth nothing as a check. The host matches `event.source` against the very `Window` it framed, which is why `readInspectMessage` takes that window as an argument. Commands going the other way target `'*'` for the mirror-image reason: an opaque origin matches no other value.
- **The payload is untrusted.** The injected script shares a realm with the prototype, which can forge any message it likes. Injecting grants the prototype nothing new — `postMessage` to the embedder was never gated by `sandbox` — but the host now listens, so every field is rebuilt on arrival: capped, stripped of control characters, and used only as text. Nothing from the frame reaches a markup sink.
- **Occluded elements are the point.** `elementsFromPoint` returns the whole hit stack under the pointer rather than the topmost element alone, so a control behind an overlay is one row further down the list instead of unreachable. Hovering a row outlines that element back inside the frame.

The picker travels with the document rather than arriving when someone arms it. Injecting later would mean reloading the frame, and a prototype reloaded mid-annotation loses whatever state the person navigated it into — usually the state they wanted to point at. It is left out entirely when the host supplies no `annotate` callback, and `previewSrcdoc` leaves it out by default, so that function's plain form is still the prototype plus the policy and nothing else.

A confirmed pick lands in the session's composer draft through `conversation.input`, not in a sent message. A reference is not a request: the person still has to say what they want changed.

## Refresh

A design thread keeps writing after the turn that started it ends, and several threads can write within the same second. The view repaints on the trailing edge of a `documents/changed` burst for the previewed path, so the frame never shows a document caught mid-write. A late read for a prototype the person has already navigated away from is discarded rather than painted.

## Model Experience

None, as this package only renders documents the `documents` seam already owns; it registers no tool, prompt section, or result projection.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Replacing `srcdoc` reloads the frame** — scroll position inside the prototype is lost on refresh. The injected picker gives this a route it did not have before, since the frame could report and restore its own scroll, but nothing does that yet.
- **No in-view editing** — the view reads prototypes; changing one goes through the model, as the design policy requires.
- **A pick carries markup, not pixels** — the model gets the element’s selector and its own markup. What the element *looks like* is not in the annotation, and the sandbox gives the host no way to capture it; a screenshot would have to be drawn inside the frame.
- **The outline is an element in the prototype’s tree** — it hangs off `documentElement` rather than `body` to stay clear of the page’s own selectors, and it is removed on disarm, but a rule written against `html > *` would still see it.
- **The tab cannot be hidden per session** — `conversation.view` registrations are global, so Design appears beside Chat everywhere. Hiding it where it does not apply needs an availability resolver on `ctx.conversation`, beside the preferred- and companion-view ones.
