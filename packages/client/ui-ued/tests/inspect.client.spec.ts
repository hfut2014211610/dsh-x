/**
 * The element picker's host half. The frame is untrusted by construction —
 * the injected script shares a realm with the prototype — so what is asserted
 * here is what the host refuses, not what it accepts.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  annotationFor,
  draftWith,
  INSPECT_CHANNEL,
  INSPECT_SCRIPT,
  MAX_CANDIDATES,
  postInspectCommand,
  readInspectMessage,
} from '../src/client/inspect.ts'
import type { InspectCandidate } from '../src/client/inspect.ts'

/** Stand-in for the framed window; only its identity matters. */
const frame = {} as Window
const other = {} as Window

/** One well-formed picked message. */
function picked(candidates: unknown[]): unknown {
  return { source: INSPECT_CHANNEL, type: 'picked', candidates }
}

const BUTTON = { tag: 'button', label: 'button.primary', selector: 'body > button', text: 'Save', html: '<button class="primary">Save</button>' }

describe('readInspectMessage', () => {
  it('accepts a pick from the frame it was given', () => {
    const message = readInspectMessage(picked([BUTTON]), frame, frame)
    expect(message).toEqual({
      type: 'picked',
      candidates: [{ depth: 0, ...BUTTON }],
    })
  })

  it('refuses a message from any other window', () => {
    // The check that matters: a sandboxed frame posts with origin 'null', and
    // so does every other one on the page, so origin cannot tell them apart.
    // Identity can.
    expect(readInspectMessage(picked([BUTTON]), other, frame)).toBeUndefined()
  })

  it('refuses everything before the frame exists', () => {
    expect(readInspectMessage(picked([BUTTON]), null, null)).toBeUndefined()
  })

  it('refuses traffic that is not this protocol', () => {
    expect(readInspectMessage({ type: 'picked', candidates: [BUTTON] }, frame, frame)).toBeUndefined()
    expect(readInspectMessage({ source: 'other', type: 'picked', candidates: [BUTTON] }, frame, frame)).toBeUndefined()
    expect(readInspectMessage('picked', frame, frame)).toBeUndefined()
    expect(readInspectMessage(null, frame, frame)).toBeUndefined()
  })

  it('refuses a pick that carries no usable candidate', () => {
    expect(readInspectMessage(picked([]), frame, frame)).toBeUndefined()
    expect(readInspectMessage(picked(['button']), frame, frame)).toBeUndefined()
    expect(readInspectMessage({ source: INSPECT_CHANNEL, type: 'picked' }, frame, frame)).toBeUndefined()
    // A candidate with no tag is not an element description.
    expect(readInspectMessage(picked([{ label: 'x' }]), frame, frame)).toBeUndefined()
  })

  it('caps how deep a stack the frame can declare', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 6 }, () => BUTTON)
    const message = readInspectMessage(picked(many), frame, frame)
    expect(message?.type).toBe('picked')
    expect(message?.type === 'picked' ? message.candidates.length : 0).toBe(MAX_CANDIDATES)
  })

  it('numbers depth by position in the stack, not by what the frame claims', () => {
    const message = readInspectMessage(picked([BUTTON, { ...BUTTON, depth: 99 }]), frame, frame)
    const depths = message?.type === 'picked' ? message.candidates.map(entry => entry.depth) : []
    expect(depths).toEqual([0, 1])
  })

  it('strips control characters and caps every string', () => {
    const message = readInspectMessage(picked([{
      tag: 'div',
      label: `a${String.fromCharCode(0)}b${String.fromCharCode(27)}c${String.fromCharCode(127)}`,
      selector: 'x'.repeat(1000),
      text: 'y'.repeat(1000),
      html: 'z'.repeat(1000),
    }]), frame, frame)
    const candidate = message?.type === 'picked' ? message.candidates[0] : undefined
    expect(candidate?.label).toBe('abc')
    expect(candidate?.selector.length).toBeLessThanOrEqual(240)
    expect(candidate?.text.length).toBeLessThanOrEqual(120)
    expect(candidate?.html.length).toBeLessThanOrEqual(600)
  })

  it('keeps the whitespace that markup legitimately contains', () => {
    const message = readInspectMessage(picked([{ ...BUTTON, html: '<p>\n\tone\n</p>' }]), frame, frame)
    const candidate = message?.type === 'picked' ? message.candidates[0] : undefined
    expect(candidate?.html).toBe('<p>\n\tone\n</p>')
  })

  it('passes the two stateless signals through', () => {
    expect(readInspectMessage({ source: INSPECT_CHANNEL, type: 'ready' }, frame, frame)).toEqual({ type: 'ready' })
    expect(readInspectMessage({ source: INSPECT_CHANNEL, type: 'cancelled' }, frame, frame)).toEqual({ type: 'cancelled' })
    expect(readInspectMessage({ source: INSPECT_CHANNEL, type: 'other' }, frame, frame)).toBeUndefined()
  })
})

describe('postInspectCommand', () => {
  it('addresses the opaque frame the only way it can be addressed', () => {
    const postMessage = vi.fn()
    postInspectCommand({ postMessage } as unknown as Window, { type: 'arm' })
    // '*' is not laxness: the frame's origin is opaque, so no other target
    // value would ever match it.
    expect(postMessage).toHaveBeenCalledWith({ source: INSPECT_CHANNEL, type: 'arm' }, '*')
  })

  it('does nothing before the frame mounts', () => {
    expect(() => { postInspectCommand(null, { type: 'disarm' }) }).not.toThrow()
  })
})

describe('the injected script', () => {
  it('cannot close its own script element', () => {
    // It is embedded verbatim between <script> tags; a closing sequence
    // anywhere inside would end the element early and spill the rest into the
    // prototype's body as text.
    expect(INSPECT_SCRIPT.toLowerCase()).not.toContain('</script')
  })

  it('reads the whole hit stack rather than the topmost element', () => {
    // The occluded-element requirement in one call: elementFromPoint would
    // return only what is on top.
    expect(INSPECT_SCRIPT).toContain('elementsFromPoint')
    expect(INSPECT_SCRIPT).not.toContain('elementFromPoint(')
  })

  it('answers only its embedder', () => {
    expect(INSPECT_SCRIPT).toContain('event.source !== parent')
  })
})

describe('annotationFor', () => {
  const candidate: InspectCandidate = { depth: 1, ...BUTTON }

  it('names the prototype and the element, then quotes the markup', () => {
    expect(annotationFor('pages/home.html', candidate))
      .toBe('pages/home.html · body > button\n```html\n<button class="primary">Save</button>\n```\n')
  })

  it('falls back to the display label when there is no selector', () => {
    expect(annotationFor('home.html', { ...candidate, selector: '' }))
      .toContain('home.html · button.primary')
  })
})

describe('draftWith', () => {
  it('keeps what the person already typed', () => {
    expect(draftWith('make it narrower', 'REF\n')).toBe('make it narrower\nREF\n')
  })

  it('does not double the separator', () => {
    expect(draftWith('typed\n', 'REF\n')).toBe('typed\nREF\n')
  })

  it('starts an empty draft with the reference alone', () => {
    expect(draftWith('', 'REF\n')).toBe('REF\n')
  })
})
