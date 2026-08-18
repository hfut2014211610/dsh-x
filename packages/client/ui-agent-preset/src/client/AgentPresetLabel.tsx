/**
 * The session header's agent-preset surface.
 *
 * A blank session retains the shared preset picker when a preferred view moves
 * it out of the Hero. Once its conversation starts, the surface becomes the
 * original read-only label because the host refuses composition switches.
 */

import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSettingsState } from './settings-store.ts'
import type { AgentPresetSeatState } from './seat-store.ts'
import { AgentPresetPicker } from './AgentPresetSeat.tsx'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header label. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
    /** Shared new-session picker state, used while this session remains blank. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  load: () => Promise<void>
  /** Read the selectable roster for the blank-session picker. */
  loadSeat: () => Promise<void>
  /** Select another composition while the session is still blank. */
  select: (id: string) => Promise<void>
  /** Clear the picker's one-shot introduction cue. */
  introduced: () => void
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render a blank-session picker or the running session's preset name.
 * @param props - composed slot props.
 * @returns the label, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, useAgentPresetSeat,
  load, loadSeat, select, introduced, t,
}: AgentPresetLabelProps) {
  const summary = useSessions(state => state.byId[sessionId])
  if (summary?.agentPreset === undefined) return null
  if (summary.blank) {
    return (
      <AgentPresetPicker
        load={loadSeat}
        select={select}
        introduced={introduced}
        useAgentPresetSeat={useAgentPresetSeat}
        t={t}
      />
    )
  }
  return <RunningPresetLabel preset={summary.agentPreset} useAgentPresets={useAgentPresets} load={load} t={t} />
}

type RunningPresetLabelProps = Pick<
  AgentPresetLabelProps,
  'useAgentPresets' | 'load' | 't'
> & { preset: string }

/** Read-only preset label for a session whose first turn has started. */
function RunningPresetLabel({ preset, useAgentPresets, load, t }: RunningPresetLabelProps) {
  const options = useAgentPresets(state => state.options)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    void load()
  }, [preset, load])

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  return (
    <span className={css.label} title={text?.description ?? t('headerHint')}>
      <IconAgentPresetOutline16 size={14} className={css.icon} />
      {text?.name ?? preset}
    </span>
  )
}
