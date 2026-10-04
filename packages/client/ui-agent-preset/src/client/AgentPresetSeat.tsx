/**
 * The agent-preset chip on the new-session screen, beside the workspace
 * picker.
 *
 * It lives here rather than in the composer because the choice is only
 * available before a conversation starts: once a turn has run, the session's
 * history was produced under that preset's tools and the host refuses to swap
 * them. A control that spends most of its life disabled belongs on the screen
 * where it still works.
 *
 * The menu opens on the staged choice, which starts as the deployment default.
 * Picking stages; the choice reaches a session when one becomes current.
 */

import { useEffect, useRef, useState } from 'react'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, IconWarningOutlineRegular, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSeatState } from './seat-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetSeat.module.css'

/** Registration-side business face for the hero chip. */
export interface AgentPresetSeatInjected {
  hooks: {
    /** Shared Developer tools preference; off hides the chip. */
    developerTools: ObservableSnapshot<boolean>
    /** Seat snapshot bound by the renderer as useAgentPresetSeat. */
    agentPresetSeat: SnapshotStore<AgentPresetSeatState>
  }
  /** Read the roster when the chip first renders. */
  load: () => Promise<void>
  /** Stage one preset for the next session; resolves to a refusal, or undefined. */
  select: (id: string) => Promise<string | undefined>
  /** Clear the one-shot introduce cue once the chip has played it. */
  introduced: () => void
}

/* Introduce timeline: the icon eases in first (the CSS animation shares this
   duration); the name's characters start fading up the moment it lands, each
   taking the fade duration to settle. The cue clears after the last one. The
   stagger is capped twice: per tick for short CJK names, and by one shared
   reveal window so a long Latin name finishes in the same time as its CJK
   counterpart instead of dragging the run out per character. */
const INTRO_TEXT_DELAY_MS = 150
const INTRO_CHAR_STAGGER_MS = 40
const INTRO_TEXT_REVEAL_MS = 200
const INTRO_CHAR_FADE_MS = 400

/** Duration of a selection-refusal banner, including a revision becoming unavailable during a pick. */
const REFUSAL_HOLD_MS = 8000

/**
 * Per-character start offset for the introduce reveal.
 * @param count - character count of the shown preset name.
 * @returns milliseconds between successive character starts.
 */
function introStaggerMs(count: number): number {
  if (count <= 1) return 0
  return Math.min(INTRO_CHAR_STAGGER_MS, INTRO_TEXT_REVEAL_MS / (count - 1))
}

/** Full component props. */
export type AgentPresetSeatProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSeatInjected>

/** Shared picker props used by the Hero seat and a still-blank session header. */
export type AgentPresetPickerProps = Pick<
  AgentPresetSeatProps,
  | 'sessionId'
  | 'useSessionRetainInfo'
  | 'load'
  | 'select'
  | 'introduced'
  | 'useAgentPresetSeat'
  | 't'
>

/**
 * Render the shared blank-session agent-preset picker.
 * @param props - composed slot props.
 * @returns the chip, or null outside the main view or before the roster
 *   provides a preset choice.
 */
export function AgentPresetPicker({
  sessionId, useSessionRetainInfo, load, select, introduced, useAgentPresetSeat, t,
}: AgentPresetPickerProps) {
  const state = useAgentPresetSeat(snapshot => snapshot)
  const main = useSessionRetainInfo(info => sessionId === undefined
    || (info?.retainedBy.mainView ?? 0) > 0)
  const [open, setOpen] = useState(false)
  // The seq keys the banner, so picking the same broken preset twice replays
  // it rather than leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const chosen = state.options.find(option => option.id === state.current)
  const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
  const label = chosenText?.name ?? state.current
  const ready = state.options.length > 0 && state.current !== ''

  // The introduce cue: the pick was staged from another screen (the settings
  // creator entry), so the chip announces it — the icon eases in and each
  // character of the name fades up on a stagger (CSS owns the motion; this
  // effect only arms it and acknowledges the cue once the run is over).
  const [introducing, setIntroducing] = useState(false)
  useEffect(() => {
    if (!state.introduce || !ready) return
    const characters = Array.from(label)
    if (characters.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      introduced()
      return
    }
    setIntroducing(true)
    const done = window.setTimeout(() => {
      setIntroducing(false)
      introduced()
    }, INTRO_TEXT_DELAY_MS + (characters.length - 1) * introStaggerMs(characters.length) + INTRO_CHAR_FADE_MS)
    return () => { window.clearTimeout(done) }
  }, [state.introduce, ready, label, introduced])

  // Nothing to choose between: the deployment composes no presets and every
  // session shares the host composition.
  if (!main || !ready) return null

  // One wrapper span: the chip is a flex row with a gap, so loose character
  // spans would each pick up the gap between them.
  const characters = Array.from(label)
  const stagger = introStaggerMs(characters.length)
  const shownLabel = introducing
    ? (
      <span className={css.introText}>
        {characters.map((character, index) => (
          <span
            key={index}
            className={css.introChar}
            style={{ animationDelay: `${INTRO_TEXT_DELAY_MS + index * stagger}ms` }}
          >
            {character}
          </span>
        ))}
      </span>
    )
    : label

  return (
    <>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={state.options.map((option) => {
          const text = presetDisplayText(option, t)
          return {
            id: option.id,
            // Name and description together: the id alone never says what a
            // preset does, which is why the roster carries display copy.
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{text.name}</span>
                <span className={css.itemDesc}>{text.description ?? t('noDescription')}</span>
              </span>
            ),
          }
        })}
        selectedId={state.current}
        onSelect={(id) => {
          setOpen(false)
          const picked = state.options.find(option => option.id === id)
          // The fallback is for the row shape `find` cannot promise; the menu's
          // items ARE `state.options`, so an emitted id is always one of them.
          /* v8 ignore next */
          const name = picked === undefined ? id : presetDisplayText(picked, t).name
          void select(id).then((refusal) => {
            // Announced only for a pick a person just made: `apply()` also runs
            // when a session becomes current, and a banner over that would
            // report a refusal nobody asked for.
            if (refusal === undefined) return
            toastSeq.current += 1
            setToast({ seq: toastSeq.current, text: t('switchRefused', { name, reason: refusal }) })
          })
        }}
        align="start"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open}
            title={state.error ?? t('seatHint')}
            disabled={state.busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconAgentPresetOutlineRegular className={introducing ? `${css.seatIcon} ${css.introIcon}` : css.seatIcon} />
            <span className={css.seatLabel}>{shownLabel}</span>
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card, which is the content column this chip sits
          // above rather than inside — hence a page query, not `closest`.
          // Absent, the banner centers on the window, which is off-center
          // whenever the sidebar is open.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}

/**
 * Render the root-scoped new-session preset seat.
 * @param props - composed slot props.
 * @returns the shared preset picker, or null with Developer tools off. The gate
 *   sits here rather than inside the picker so the picker unmounts with it: its
 *   disclosure state is discarded instead of revived by a later toggle, and the
 *   blank-session header keeps the same picker while tools are off.
 */
export function AgentPresetSeat(props: AgentPresetSeatProps) {
  const developerTools = props.useDeveloperTools(value => value)
  if (!developerTools) return null
  return <AgentPresetPicker {...props} />
}
