// @vitest-environment jsdom
/**
 * What the design view shows: the prototypes it lists, the one it renders, and
 * the states in between. The isolation of the frame itself is asserted in
 * sandbox.client.spec.ts and again on the assembled app; here the frame is
 * only checked for carrying what the view decided.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DocumentChange, DocumentDirectoryListing, DocumentReadResult,
} from '@deepseek-ai/dsh-documents/types'
import { UedView } from '../src/client/UedView.tsx'
import type { UedViewInjected } from '../src/client/UedView.tsx'
import { en } from '../src/client/locales.ts'
import type { UedKey } from '../src/client/locales.ts'

afterEach(cleanup)

// jsdom implements neither pointer capture nor rAF scheduling, and the rail's
// separator needs both; without these the resize path is a no-op.
beforeEach(() => {
  const captured = new Set<number>()
  Element.prototype.setPointerCapture = function setPointerCapture(id: number) { captured.add(id) }
  Element.prototype.releasePointerCapture = function releasePointerCapture(id: number) { captured.delete(id) }
  Element.prototype.hasPointerCapture = function hasPointerCapture(id: number) { return captured.has(id) }
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

const t = (key: UedKey): string => en[key]

/**
 * The view's full prop set. Specs feed the injected half directly; the
 * framework half (`useSession` and its kin) is unused by this view.
 */
type ViewProps = React.ComponentProps<typeof UedView>

const props = (injected: Partial<UedViewInjected>): ViewProps => injected as unknown as ViewProps

/** One directory listing, in the shape the documents Remote returns. */
function listing(entries: DocumentDirectoryListing['entries']): DocumentDirectoryListing {
  return { entries } as DocumentDirectoryListing
}

function read(content: string): DocumentReadResult {
  return { content } as DocumentReadResult
}

const ROOT = listing([
  { kind: 'directory', name: 'pages', path: 'pages' },
  { kind: 'file', name: 'home.html', path: 'home.html' },
  // Not previewable: the rail lists prototypes, not every file in the folder.
  { kind: 'file', name: 'notes.md', path: 'notes.md' },
] as DocumentDirectoryListing['entries'])

function renderView(overrides: Partial<UedViewInjected> = {}) {
  const injected: UedViewInjected = {
    list: vi.fn(() => Promise.resolve(ROOT)),
    load: vi.fn(() => Promise.resolve(read('<p>hello</p>'))),
    subscribeChanged: vi.fn(() => () => {}),
    translate: t,
    ...overrides,
  }
  render(<UedView {...props(injected)} />)
  return injected
}

function frame(): HTMLIFrameElement {
  return screen.getByTitle(en['preview.label']) as HTMLIFrameElement
}

describe('UedView', () => {
  it('lists the folders and the prototypes, and leaves other files out', async () => {
    renderView()

    expect(await screen.findByRole('button', { name: 'home.html' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'pages' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'notes.md' })).toBeNull()
  })

  it('says the folder is empty rather than showing a bare list', async () => {
    renderView({ list: vi.fn(() => Promise.resolve(listing([]))) })

    expect(await screen.findByText(en['files.empty'])).toBeTruthy()
  })

  it('reports why the listing failed', async () => {
    renderView({ list: vi.fn(() => Promise.resolve({ error: 'no workspace' })) })

    expect(await screen.findByText('no workspace')).toBeTruthy()
  })

  it('walks into a folder and back out, listing each level', async () => {
    const list = vi.fn((path?: string) => Promise.resolve(
      path === undefined
        ? ROOT
        : listing([{ kind: 'file', name: 'detail.html', path: 'pages/detail.html' }] as DocumentDirectoryListing['entries']),
    ))
    renderView({ list })

    fireEvent.click(await screen.findByRole('button', { name: 'pages' }))
    expect(await screen.findByRole('button', { name: 'detail.html' })).toBeTruthy()
    expect(screen.getByText('/pages')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en['files.up'] }))

    expect(await screen.findByRole('button', { name: 'home.html' })).toBeTruthy()
    expect(list.mock.calls).toEqual([[undefined], ['pages'], [undefined]])
  })

  it('invites a choice before one is made', async () => {
    renderView()
    await screen.findByRole('button', { name: 'home.html' })

    expect(screen.getByText(en['preview.none'])).toBeTruthy()
  })

  it('renders the chosen prototype in the frame', async () => {
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'home.html' }))

    await waitFor(() => { expect(frame()).toBeTruthy() })
    expect(frame().getAttribute('srcdoc')).toContain('<p>hello</p>')
    // The stage names what it is showing, so the rail is not the only place
    // the answer exists.
    const stage = screen.getByRole('region', { name: en['preview.label'] })
    expect(within(stage).getByText('home.html')).toBeTruthy()
  })

  it('shows the directory beside the name only when the prototype is nested', async () => {
    const list = vi.fn(() => Promise.resolve(
      listing([{ kind: 'file', name: 'detail.html', path: 'pages/detail.html' }] as DocumentDirectoryListing['entries']),
    ))
    renderView({ list })

    fireEvent.click(await screen.findByRole('button', { name: 'detail.html' }))

    await waitFor(() => { expect(screen.getByText('pages/')).toBeTruthy() })
  })

  it('reports why the prototype could not be read', async () => {
    renderView({ load: vi.fn(() => Promise.resolve({ error: 'gone' })) })

    fireEvent.click(await screen.findByRole('button', { name: 'home.html' }))

    expect(await screen.findByText('gone')).toBeTruthy()
  })

  it('discards a late read for a prototype the person navigated away from', async () => {
    const replies = new Map<string, (result: DocumentReadResult) => void>()
    const load = vi.fn((path: string) => new Promise<DocumentReadResult>((resolve) => {
      replies.set(path, resolve)
    }))
    renderView({
      list: vi.fn(() => Promise.resolve(listing([
        { kind: 'file', name: 'a.html', path: 'a.html' },
        { kind: 'file', name: 'b.html', path: 'b.html' },
      ] as DocumentDirectoryListing['entries']))),
      load,
    })

    fireEvent.click(await screen.findByRole('button', { name: 'a.html' }))
    fireEvent.click(screen.getByRole('button', { name: 'b.html' }))
    await act(async () => {
      replies.get('b.html')?.(read('<p>b</p>'))
      replies.get('a.html')?.(read('<p>a</p>'))
      await Promise.resolve()
    })

    expect(frame().getAttribute('srcdoc')).toContain('<p>b</p>')
  })

  it('reloads the prototype on request', async () => {
    const injected = renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'home.html' }))
    await waitFor(() => { expect(frame()).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en['preview.reload'] }))

    await waitFor(() => { expect(injected.load).toHaveBeenCalledTimes(2) })
  })

  it('re-lists the folder on request', async () => {
    const injected = renderView()
    await screen.findByRole('button', { name: 'home.html' })

    fireEvent.click(screen.getByRole('button', { name: en['files.refresh'] }))

    await waitFor(() => { expect(injected.list).toHaveBeenCalledTimes(2) })
  })

  it('repaints once on the trailing edge of a burst of writes to the shown prototype', async () => {
    vi.useFakeTimers()
    let publish: ((change: DocumentChange) => void) | undefined
    const injected = renderView({
      subscribeChanged: vi.fn((fn: (change: DocumentChange) => void) => {
        publish = fn
        return () => { publish = undefined }
      }),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'home.html' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(injected.load).toHaveBeenCalledTimes(1)

    // Two writes inside the window collapse into one repaint; a write to a
    // prototype the frame is not showing is ignored outright.
    await act(async () => {
      publish?.({ path: 'home.html' } as DocumentChange)
      publish?.({ path: 'other.html' } as DocumentChange)
      publish?.({ path: 'home.html' } as DocumentChange)
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(injected.load).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  // The reason a stage exists: a thread writes its prototype and the stage
  // shows it. Before this the rail only reloaded when the person changed
  // directory, so a prototype written this turn was not even listed.
  it('opens a prototype the thread just wrote, and relists to find it', async () => {
    vi.useFakeTimers()
    let publish: ((change: DocumentChange) => void) | undefined
    const injected = renderView({
      subscribeChanged: vi.fn((fn: (change: DocumentChange) => void) => {
        publish = fn
        return () => { publish = undefined }
      }),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(injected.load).not.toHaveBeenCalled()

    await act(async () => {
      publish?.({ path: 'home.html' } as DocumentChange)
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(injected.load).toHaveBeenCalledWith('home.html')
    // The listing is refreshed too: the file may be new to it.
    expect(injected.list).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  // Following is for someone watching. Once they have opened something
  // themselves, taking the stage away is worse than not following at all.
  it('stops following once the person opens a prototype themselves', async () => {
    vi.useFakeTimers()
    let publish: ((change: DocumentChange) => void) | undefined
    const injected = renderView({
      subscribeChanged: vi.fn((fn: (change: DocumentChange) => void) => {
        publish = fn
        return () => { publish = undefined }
      }),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'home.html' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(injected.load).toHaveBeenCalledTimes(1)

    await act(async () => {
      publish?.({ path: 'pages/other.html' } as DocumentChange)
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(injected.load).toHaveBeenCalledTimes(1)
    expect(injected.load).not.toHaveBeenCalledWith('pages/other.html')
    vi.useRealTimers()
  })

  it('holds the frame at the viewport a prototype was written for', async () => {
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'home.html' }))
    await waitFor(() => { expect(frame()).toBeTruthy() })
    expect(frame().style.maxWidth).toBe('')

    fireEvent.click(screen.getByRole('button', { name: en['preview.width.mobile'] }))
    expect(frame().style.maxWidth).toBe('390px')

    fireEvent.click(screen.getByRole('button', { name: en['preview.width.auto'] }))
    expect(frame().style.maxWidth).toBe('')
  })

  it('moves the rail edge', async () => {
    renderView()
    await screen.findByRole('button', { name: 'home.html' })
    const handle = screen.getByRole('separator', { name: en['files.resize'] })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 160 })

    expect(handle.getAttribute('aria-valuenow')).toBe('300')
  })

  it('falls back to its own wording when the failure carried no message', async () => {
    renderView({
      list: vi.fn(() => Promise.resolve({ error: undefined as unknown as string })),
    })

    expect(await screen.findByText(en['files.error'])).toBeTruthy()
  })

  it('falls back to its own wording when the read failed without a message', async () => {
    renderView({ load: vi.fn(() => Promise.resolve({ error: undefined as unknown as string })) })

    fireEvent.click(await screen.findByRole('button', { name: 'home.html' }))

    expect(await screen.findByText(en['preview.error'])).toBeTruthy()
  })

  it('leaves the frame empty when the composition injected no reader', async () => {
    render(<UedView {...props({ list: () => Promise.resolve(ROOT), translate: t })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'home.html' }))

    // Selecting still moves the rail, but nothing can be read, so the stage
    // stays on its loading line rather than rendering an empty frame.
    expect(screen.getByText(en['preview.loading'])).toBeTruthy()
  })

  it('degrades to the raw keys and stays inert without the host callbacks', () => {
    render(<UedView {...props({})} />)

    // No translate, no list, no load: the view must still mount, because a
    // composition that failed to inject them is a wiring bug, not a crash.
    expect(screen.getByLabelText('files.label')).toBeTruthy()
    expect(screen.getByText('files.loading')).toBeTruthy()
  })
})
