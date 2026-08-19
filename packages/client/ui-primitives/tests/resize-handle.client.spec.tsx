// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResizeHandle } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// jsdom implements neither pointer capture nor rAF scheduling the way a browser
// does: without these the drag path never reports, and every assertion below
// would be about a no-op.
beforeEach(() => {
  const captured = new Set<number>()
  Element.prototype.setPointerCapture = function setPointerCapture(id: number) { captured.add(id) }
  Element.prototype.releasePointerCapture = function releasePointerCapture(id: number) { captured.delete(id) }
  Element.prototype.hasPointerCapture = function hasPointerCapture(id: number) { return captured.has(id) }
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

const drag = (element: HTMLElement, from: number, to: number): void => {
  fireEvent.pointerDown(element, { pointerId: 1, clientX: from })
  fireEvent.pointerMove(element, { pointerId: 1, clientX: to })
  fireEvent.pointerUp(element, { pointerId: 1, clientX: to })
}

describe('ResizeHandle', () => {
  it('reports the dragged width and exposes the range it moves in', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={240} min={160} max={520} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })
    expect(handle.getAttribute('aria-valuenow')).toBe('240')
    expect(handle.getAttribute('aria-valuemin')).toBe('160')
    expect(handle.getAttribute('aria-valuemax')).toBe('520')

    drag(handle, 100, 190)
    expect(onResize).toHaveBeenLastCalledWith(330)
  })

  it('clamps to the bounds instead of reporting a width the pane cannot take', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={240} min={160} max={300} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })

    drag(handle, 100, 500)
    expect(onResize).toHaveBeenLastCalledWith(300)
    drag(handle, 100, 0)
    expect(onResize).toHaveBeenLastCalledWith(160)
  })

  it('moves by keyboard and ignores keys that are not a horizontal step', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={240} min={160} max={520} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(256)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(224)
    onResize.mockClear()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onResize).not.toHaveBeenCalled()
  })

  // Release while a frame is still pending: the queued report is cancelled and
  // the release reports once, so a fast drag cannot paint a stale width after
  // the pointer is already up.
  it('cancels a pending frame on release and reports the final width once', () => {
    const queued: FrameRequestCallback[] = []
    const cancelled: number[] = []
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { queued.push(fn); return queued.length })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { cancelled.push(id) })
    const onResize = vi.fn()
    render(<ResizeHandle width={240} min={160} max={520} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 })
    expect(onResize).not.toHaveBeenCalled()
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 })
    expect(cancelled).toHaveLength(1)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenLastCalledWith(290)
  })

  // A press and release with no movement in between: nothing is queued, so the
  // release takes the no-pending-frame path and reports the unchanged width.
  it('reports the unchanged width when the handle is clicked without dragging', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={240} min={160} max={520} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 })
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenLastCalledWith(240)
  })

  // side="right": the sized column sits AFTER the handle, so the same leftward
  // travel that shrinks a left-hand rail widens this one. Both input paths read
  // the travel, so both are asserted against the same distance.
  it('widens a right-hand column as the pointer travels left', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={360} min={320} max={720} side="right" onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })

    drag(handle, 500, 400)
    expect(onResize).toHaveBeenLastCalledWith(460)
    drag(handle, 500, 560)
    expect(onResize).toHaveBeenLastCalledWith(320)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(376)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(344)
  })

  // A move or release the gesture does not own must not report: a pointer that
  // never captured is another device crossing the handle mid-drag.
  it('ignores pointer events outside its own capture', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={240} min={160} max={520} onResize={onResize} label="Resize" />)
    const handle = screen.getByRole('separator', { name: 'Resize' })

    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 400 })
    fireEvent.pointerUp(handle, { pointerId: 9, clientX: 400 })
    expect(onResize).not.toHaveBeenCalled()
  })
})
