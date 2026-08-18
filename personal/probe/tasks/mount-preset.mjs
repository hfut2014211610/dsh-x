/**
 * Mount a named agent preset onto every agent this process creates.
 *
 * WHY THIS EXISTS. The outcome study needs the `headless` profile to run under
 * a chosen preset, and headless has no preset selection: it composes the agent
 * flat and never touches `agentPresets`. The obvious workaround — replicate
 * the preset's rows in a launcher `--patch` overlay — does not work, and the
 * failure is by design rather than incidental:
 *
 *   `@deepseek-ai/dsh-persona` registers the `deployment:persona` prompt
 *   section, which the host-plane `system-prompt` row already owns. Mounted on
 *   the host plane it collides ("prompt section already registered ... for a
 *   per-agent override, register through that agent's `agent.ctx` instead").
 *   A preset composition is AGENT-PLANE: it is legal only under a per-agent
 *   scope, which is what `agentPresets` establishes.
 *
 * Since the persona is the one lever local measurement found load-bearing,
 * an overlay that cannot reproduce it cannot serve as the study's anchored
 * arm at all. So this row does what the Web surface does — `recompose` the
 * agent's own scope onto the preset — instead of imitating its contents.
 *
 * Compared with the overlay this replaces, the conditions are not merely
 * close: the agent runs the SAME composition the preset ships, so there is no
 * separate copy to keep in sync.
 *
 * TIMING IS THE OPEN QUESTION, and it is settled empirically rather than by
 * reading: `recompose` must land before the first model request or the whole
 * point is lost. `personal/probe/analyze-session.ts` answers that — if the
 * first `request/header` does not carry the bootstrap pair, this row ran too
 * late and the arm is invalid.
 *
 * ============================================================
 * MEASURED RESULT: THIS APPROACH DOES NOT WORK. Kept as evidence
 * so the next person does not spend the same afternoon on it.
 *
 * `agent/created` is dispatched SYNCHRONOUSLY and a listener's returned
 * promise is deliberately NOT awaited (packages/core/agent/src/index.ts —
 * "Returned-promise rejection happens after this synchronous boundary"), so
 * the async `recompose` lands AFTER the agent's first model request. The
 * phase contract caught it exactly as intended:
 *
 *   [FAIL] bootstrap-catalog  header#0 tools = [25 standard tools],
 *                             expected exactly [bash, str_replace_editor]
 *   [FAIL] minimal-system     system = "You are an AI agent powered by ..."
 *   [FAIL] clean-first-request injected: agent-instructions, skill-catalog
 *   [PASS] resident-promotion header#1 = the anchored resident set
 *
 * The preset took effect from request #2 — which is precisely the request the
 * study does not care about.
 *
 * The correct seam is `CreateAgentOptions.setup`, which runs "after minting
 * agentCtx but BEFORE inserting or announcing either ... and the first prompt
 * assembly". Only the caller of `agents.create()` can pass it, and for this
 * profile that is `packages/bundle/headless/src/index.ts` — an upstream file
 * this fork does not patch. Its own comment states the limitation: "This
 * bundle composes no preset roster ... A deployment that DOES configure one
 * has to join it here first."
 * ============================================================
 *
 * CONFIG:
 *  - `preset`: preset id to mount (required, e.g. `anchored-standard`).
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'probe-mount-preset'

/** The roster must exist before any agent is created. */
export const inject = ['agentPresets']

export function apply(ctx, config) {
  const preset = config?.preset
  if (typeof preset !== 'string' || preset.length === 0) {
    throw new TypeError(`${name}: config.preset must be a non-empty preset id`)
  }

  ctx.on('agent/created', async ({ agent }) => {
    try {
      const mounted = await ctx.agentPresets.recompose(agent.ctx, preset)
      // Recorded exactly as the Web surface records it, so the probe's
      // grouping and the phase contract see the same evidence they see for a
      // real session.
      agent.session.append('agent-preset/selected', { agentPreset: mounted.id })
    } catch (error) {
      // Failing loudly matters more than continuing: a study arm that
      // silently ran the wrong composition is worse than one that did not run.
      ctx.logger.error(`${name}: failed to mount preset "${preset}": ${String((error && error.message) || error)}`)
      throw error
    }
  })
}
