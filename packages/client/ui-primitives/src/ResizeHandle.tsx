/**
 * In-flow vertical resize separator for a two-column pane.
 *
 * Distinct from the app frame's own handle, which is an overlay positioned
 * against the frame and wired to its column solver and stored preferences.
 * This one sits BETWEEN the two columns it separates and reports a width, so a
 * view can make its rail adjustable without owning any of that. It sizes the
 * column on either side of itself — see `side`.
 */

import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import css from './ResizeHandle.module.css'

/** How far one arrow-key press moves the edge. */
const KEY_STEP = 16

export interface ResizeHandleProps {
  /** Current width of the sized column, in pixels. */
  width: number
  /** Smallest width the column may take. */
  min: number
  /** Largest width the column may take. */
  max: number
  /** Receives the new width, already clamped to [min, max]. */
  onResize: (width: number) => void
  /** Accessible name, e.g. "Resize the prototype list". */
  label: string
  /**
   * Which neighbour the reported width belongs to. 'left' (the default) sizes
   * the column before the handle, so dragging right widens it; 'right' sizes
   * the column after it, where the same gesture reads the other way round.
   */
  side?: 'left' | 'right'
}

/**
 * A draggable separator that reports its sized neighbour's new width.
 *
 * Pointer capture rather than window listeners: the gesture keeps receiving
 * moves when the pointer leaves the thin hit area, which it does constantly.
 * Moves coalesce into one animation frame so a fast drag reports once per
 * paint instead of once per event.
 * @param props - see {@link ResizeHandleProps}.
 * @returns the separator element.
 */
export function ResizeHandle({ width, min, max, onResize, label, side = 'left' }: ResizeHandleProps): React.ReactElement {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const base = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const report = useRef(onResize)
  report.current = onResize

  // A right-hand column grows as the pointer travels left, so its gesture and
  // its arrow keys both read the travel with the opposite sign.
  const direction = side === 'right' ? -1 : 1
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    base.current = width
    setDragging(true)
  }, [width])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      report.current(clamp(base.current + (latest.current - origin.current) * direction))
    })
  }, [clamp, direction])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    report.current(clamp(base.current + (latest.current - origin.current) * direction))
    setDragging(false)
  }, [clamp, direction])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const travel = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0
    if (travel === 0) return
    event.preventDefault()
    report.current(clamp(width + travel * direction))
  }, [clamp, direction, width])

  return (
    <div
      className={css.handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}
