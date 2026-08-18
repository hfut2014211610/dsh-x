/**
 * Make every agent this process creates join a named preset, by wrapping the
 * agent registry's `create` so the preset mount happens inside
 * `CreateAgentOptions.setup`.
 *
 * WHY THE SETUP HOOK AND NOTHING EARLIER OR LATER. The study only cares about
 * the FIRST model request, so the preset has to be bound before that request
 * is assembled. Two other seams were tried and measured:
 *
 *  - Copying the preset's rows into a launcher `--patch` overlay fails at
 *    load: `@deepseek-ai/dsh-persona` registers `deployment:persona`, which
 *    the host-plane `system-prompt` row already owns. A preset composition is
 *    agent-plane by construction, and the error says so.
 *  - Mounting the real preset from an `agent/created` listener loads fine and
 *    even records `agent-preset/selected`, but lands too late: that event is
 *    dispatched synchronously and a listener's returned promise is
 *    deliberately not awaited, so the first request goes out with the host
 *    composition. Measured: `header#0` carried all 25 standard tools and only
 *    `header#1` was anchored. See `mount-preset.mjs` for the full record.
 *
 * `setup` runs "after minting `agentCtx` but BEFORE inserting or announcing
 * either ... and the first prompt assembly", which is exactly the window.
 * Only the caller of `agents.create()` can pass it, and for the `headless`
 * profile that caller is `packages/bundle/headless/src/index.ts` — an upstream
 * file this fork does not edit. Wrapping the registry method reaches the same
 * seam from a plugin, so the upstream runner keeps working unmodified and
 * there is no second copy of its logic to drift.
 *
 * The wrapper preserves the caller's own setup, including the optional
 * synchronous commit it may return. The preset is mounted BEFORE that setup
 * runs, so the caller's registrations land in a context whose scope parent is
 * already the preset's standing mount.
 *
 * VERIFY, DO NOT ASSUME. After a run the session must satisfy the preset's
 * phase contract:
 *
 *   node --import tsx/esm personal/probe/analyze-session.ts --latest
 *
 * `bootstrap-catalog` is the check that proves the mount beat the first
 * request. If it fails, this row ran too late and every number collected
 * under it is void.
 *
 * CONFIG:
 *  - `preset`: preset id to mount (required, e.g. `anchored-standard`).
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'probe-preset-setup'

/** Both services must exist before any agent is created. */
export const inject = ['agents', 'agentPresets']

export function apply(ctx, config) {
  const preset = config?.preset
  if (typeof preset !== 'string' || preset.length === 0) {
    throw new TypeError(`${name}: config.preset must be a non-empty preset id`)
  }

  const agents = ctx.agents
  const original = agents.create

  ctx.effect(() => {
    agents.create = function wrappedCreate(options) {
      const callerSetup = options?.setup
      const patched = {
        ...options,
        setup: async (agentCtx) => {
          const mounted = await ctx.agentPresets.mount(agentCtx, preset)
          const commit = await callerSetup?.(agentCtx)
          // Recorded the way the Web surface records it, so the probe's
          // grouping and the phase contract read the same evidence they read
          // for an ordinary session.
          queueMicrotask(() => {
            try {
              agentCtx.agent?.session?.append('agent-preset/selected', { agentPreset: mounted?.id ?? preset })
            } catch {
              // The label is reporting convenience; the header timeline is the
              // real evidence and does not depend on it.
            }
          })
          return commit
        },
      }
      return original.call(this, patched)
    }
    return () => {
      agents.create = original
    }
  }, 'probe-preset-setup.wrap')
}
