// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DocumentChange, DocumentOutlineEntry, DocumentReadResult } from '@deepseek-ai/dsh-documents/types'
import { WritingView, type WritingViewInjected } from '../src/client/WritingView.tsx'
import { zh } from '../src/client/locales.ts'

const SID = 'writing-session' as SessionId
const TestWritingView = WritingView as unknown as (
  props: WritingViewInjected & { sessionId: SessionId },
) => ReactElement

const entry: DocumentOutlineEntry = {
  id: 'heading:intro',
  kind: 'heading',
  title: '简介',
  locator: { unit: 'line', start: 1, end: 1 },
}

function setup(options: {
  readonly content?: string
  readonly entries?: readonly DocumentOutlineEntry[]
  /** Leave the tool panel closed, the way a freshly opened view has it. */
  readonly panelClosed?: boolean
} = {}) {
  let changed: ((change: DocumentChange) => void) | undefined
  const content = options.content ?? '# 简介\n\n初始内容'
  const outlineEntries = options.entries ?? [entry]
  const list = vi.fn(async (path?: string) => ({
    path: path ?? '',
    entries: path === 'docs'
      ? [
        { name: 'plan.md', path: 'docs/plan.md', kind: 'file' as const, format: 'markdown' as const },
        { name: 'result.md', path: 'docs/result.md', kind: 'file' as const, format: 'markdown' as const },
      ]
      : [
        { name: 'docs', path: 'docs', kind: 'directory' as const },
        { name: 'README.md', path: 'README.md', kind: 'file' as const, format: 'markdown' as const },
      ],
    truncated: false,
  }))
  const load = vi.fn(async (path: string): Promise<DocumentReadResult | { error: string }> => ({
    path,
    format: 'markdown' as const,
    version: 'v1',
    content,
    truncated: false,
  }))
  const save = vi.fn(async () => ({ version: 'v2' }))
  const outline = vi.fn(async () => outlineEntries)
  const search = vi.fn(async () => [{
    path: 'docs/result.md',
    title: '搜索结果',
    snippet: '匹配内容',
    score: 1,
    truncated: false,
  }])
  const subscribeChanged = vi.fn((listener: (change: DocumentChange) => void) => {
    changed = listener
    return () => { changed = undefined }
  })
  const view = render(
    <TestWritingView
      sessionId={SID}
      list={list}
      load={load}
      save={save}
      outline={outline}
      search={search}
      subscribeChanged={subscribeChanged}
      translate={key => zh[key]}
    />,
  )
  // The view opens with the rail collapsed, so a test about the tree, the
  // outline or search has to say so first — the same click a reader makes.
  if (options.panelClosed !== true) {
    fireEvent.click(view.getByRole('button', { name: zh['tools.document'] }))
  }
  return { view, list, load, save, outline, search, changed: () => changed }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

/**
 * Type a path into the tree filter and submit it.
 *
 * The sidebar's top field filters the loaded tree; submitting it opens the one
 * remaining match, or — as here, where the path names a file the fixture tree
 * never listed — the text itself. That fallback is what keeps a path outside
 * the loaded tree reachable at all.
 */
function openByPath(view: ReturnType<typeof render>, path: string): void {
  const field = view.getByLabelText(zh['filter.label'])
  fireEvent.change(field, { target: { value: path } })
  const form = field.closest('form')
  if (form === null) throw new Error('the filter field is not inside a form')
  fireEvent.submit(form)
}

/** Set the filter text without submitting it. */
function filterBy(view: ReturnType<typeof render>, text: string): void {
  fireEvent.change(view.getByLabelText(zh['filter.label']), { target: { value: text } })
}

/** Expand `docs` and wait for its listing, so the filter has it to work on. */
async function expandDocs(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await view.findByRole('button', { name: 'docs' }))
  await view.findByRole('button', { name: 'plan.md' })
}


describe('WritingView', () => {
  // A writing view opened with nothing loaded used to greet its reader with a
  // file browser filling a third of the width, and pay for the workspace
  // listing to fill it. The rail is where the tree lives; the first frame is
  // the document.
  it('opens with the tool panel closed and no listing fetched', async () => {
    const b = setup({ panelClosed: true })
    expect(b.view.queryByRole('tree', { name: zh['tree.label'] })).toBeNull()
    expect(b.list).not.toHaveBeenCalled()

    fireEvent.click(b.view.getByRole('button', { name: zh['tools.document'] }))
    expect(await b.view.findByRole('tree', { name: zh['tree.label'] })).toBeTruthy()
    expect(b.list).toHaveBeenCalled()
  })

  // The sidebar's top field used to take a path and open it. As a filter it
  // answers the far more common question — where is that file — without
  // making someone click through folders to ask it.
  it('filters the tree to the files whose names match', async () => {
    const b = setup()
    await b.view.findByRole('button', { name: 'README.md' })

    filterBy(b.view, 'readme')
    expect(b.view.getByRole('button', { name: 'README.md' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: 'docs' })).toBeNull()

    // Clearing puts the whole tree back.
    fireEvent.click(b.view.getByRole('button', { name: zh['filter.clear'] }))
    expect(b.view.getByRole('button', { name: 'docs' })).toBeTruthy()
  })

  // A folder that matches IS the answer, so its contents are not also a
  // question: filtering them would hide the very files the match points at.
  it('keeps a matched directory whole, children unfiltered', async () => {
    const b = setup()
    await expandDocs(b.view)

    filterBy(b.view, 'docs')
    expect(b.view.getByRole('button', { name: 'docs' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: 'plan.md' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: 'result.md' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: 'README.md' })).toBeNull()
  })

  // A folder kept only because a match sits under it is not itself the answer,
  // so it opens: leaving it shut would filter the tree down to a closed door.
  it('opens a folder it kept only to show a match inside it', async () => {
    const b = setup()
    await expandDocs(b.view)
    // Collapse it again, so the reveal is the filter's doing and not the click's.
    fireEvent.click(b.view.getByRole('button', { name: 'docs' }))
    expect(b.view.queryByRole('button', { name: 'plan.md' })).toBeNull()

    filterBy(b.view, 'result')
    expect(b.view.getByRole('button', { name: 'docs' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: 'result.md' })).toBeTruthy()
    expect(b.view.queryByRole('button', { name: 'plan.md' })).toBeNull()
    expect(b.view.queryByRole('button', { name: 'README.md' })).toBeNull()
  })

  // The filter only sees loaded directories, so "no match" has to say which
  // tree it searched — otherwise it reads as "this file does not exist".
  it('says what it searched when a filter matches nothing', async () => {
    const b = setup()
    await b.view.findByRole('button', { name: 'README.md' })

    filterBy(b.view, 'nothing-by-this-name')
    expect(b.view.getByText(zh['filter.empty'])).toBeTruthy()
  })

  // One match is unambiguous, so submitting opens it rather than the raw text.
  it('opens the single remaining match on submit', async () => {
    const b = setup()
    await expandDocs(b.view)
    b.load.mockClear()

    const field = b.view.getByLabelText(zh['filter.label'])
    fireEvent.change(field, { target: { value: 'plan' } })
    fireEvent.submit(field.closest('form')!)

    await waitFor(() => { expect(b.load).toHaveBeenCalledWith('docs/plan.md') })
  })

  it('loads the workspace tree automatically and keeps it open for quick document switching', async () => {
    const b = setup()
    await waitFor(() => { expect(b.list).toHaveBeenCalledWith(undefined) })
    expect(b.view.getByRole('tree', { name: '工作区文档目录' })).toBeTruthy()

    fireEvent.click(await b.view.findByRole('button', { name: 'docs' }))
    await waitFor(() => { expect(b.list).toHaveBeenCalledWith('docs') })
    fireEvent.click(await b.view.findByRole('button', { name: 'plan.md' }))

    await waitFor(() => { expect(b.load).toHaveBeenCalledWith('docs/plan.md') })
    await waitFor(() => {
      expect(b.list.mock.calls.filter(([path]) => path === 'docs')).toHaveLength(2)
    })
    expect(b.view.getByText('工作区文件')).toBeTruthy()
    expect(b.view.getByRole('treeitem', { name: 'plan.md' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(b.view.getByRole('button', { name: '重新载入' }))
    await waitFor(() => {
      expect(b.list.mock.calls.filter(([path]) => path === 'docs')).toHaveLength(3)
    })
    expect(b.view.getByRole('treeitem', { name: 'plan.md' })).toBeTruthy()
  })

  // A writing session creates its document and says so in the transcript. The
  // editor used to act only on changes to the file already open, so the one
  // the session just produced stayed closed behind a tree to go find it in.
  it('opens the document the session just created', async () => {
    const b = setup()
    await waitFor(() => { expect(b.list).toHaveBeenCalledWith(undefined) })

    act(() => {
      b.changed()?.({
        sessionId: SID,
        path: 'docs/新建产物.md',
        baseVersion: null,
        version: 'v1',
        patches: null,
      } as unknown as DocumentChange)
    })

    await waitFor(() => { expect(b.load).toHaveBeenCalledWith('docs/新建产物.md') })
  })

  // Following is for someone watching; an explicit open says they are not.
  // Pulling the editor off what they chose would be worse than not following.
  it('stops following once the person opens a document themselves', async () => {
    const b = setup()
    openByPath(b.view, 'docs/plan.md')
    await b.view.findByLabelText('文档预览')
    b.load.mockClear()

    act(() => {
      b.changed()?.({
        sessionId: SID,
        path: 'docs/其他产物.md',
        baseVersion: null,
        version: 'v1',
        patches: null,
      } as unknown as DocumentChange)
    })

    await waitFor(() => { expect(b.view.getByLabelText('文档预览')).toBeTruthy() })
    expect(b.load).not.toHaveBeenCalled()
  })

  // Reading is what opening a document usually is, and until now only markdown
  // got a reading view: a source file landed in a textarea, and a Word file
  // landed there as text pulled out of a zip.
  it('opens a code file in a reading view, and keeps the editor one click away', async () => {
    const b = setup()
    b.load.mockResolvedValueOnce({
      path: 'src/index.ts',
      format: 'code',
      version: 'v1',
      content: 'export const answer = 42\n',
      truncated: false,
    })
    openByPath(b.view, 'src/index.ts')

    const reader = await b.view.findByLabelText('文档预览')
    expect(reader.textContent).toContain('export const answer = 42')
    // Highlighted, not dumped: the grammar hint comes from the extension.
    expect(reader.querySelector('pre')).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: '编辑' }))
    const editor = await b.view.findByLabelText('文档编辑器') as HTMLTextAreaElement
    expect(editor.value).toContain('export const answer = 42')
  })

  it('reads an extracted Word document as prose rather than through the editor', async () => {
    const b = setup()
    b.load.mockResolvedValueOnce({
      path: 'docs/spec.docx',
      format: 'docx',
      version: 'v1',
      content: '第一段\n\n第二段',
      truncated: false,
    })
    openByPath(b.view, 'docs/spec.docx')

    const reader = await b.view.findByLabelText('文档预览')
    expect(reader.textContent).toContain('第一段')
    expect(reader.textContent).toContain('第二段')
  })

  // A plain text file has nothing to render that the editor does not already
  // show, so it opens in the editor and offers no mode switch at all.
  it('leaves a plain text file in the editor with no reading mode offered', async () => {
    const b = setup()
    b.load.mockResolvedValueOnce({
      path: 'notes.txt',
      format: 'text',
      version: 'v1',
      content: 'just words',
      truncated: false,
    })
    openByPath(b.view, 'notes.txt')

    const editor = await b.view.findByLabelText('文档编辑器') as HTMLTextAreaElement
    expect(editor.value).toBe('just words')
    expect(b.view.queryByRole('group', { name: '视图模式' })).toBeNull()
  })

  it('opens, edits, saves, and protects a dirty draft from an external change', async () => {
    const b = setup()
    openByPath(b.view, 'docs/plan.md')

    const preview = await b.view.findByLabelText('文档预览')
    expect(preview.textContent).toContain('初始内容')
    fireEvent.click(b.view.getByRole('button', { name: '编辑' }))
    let editor = await b.view.findByLabelText('文档编辑器') as HTMLTextAreaElement
    await waitFor(() => { expect(editor.value).toBe('# 简介\n\n初始内容') })
    fireEvent.change(editor, { target: { value: '# 简介\n\n手工修改' } })
    expect(b.view.getByText('有未保存修改')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '预览' }))
    expect(b.view.getByLabelText('文档预览').textContent).toContain('手工修改')
    fireEvent.click(b.view.getByRole('button', { name: '编辑' }))
    editor = b.view.getByLabelText('文档编辑器') as HTMLTextAreaElement
    fireEvent.click(b.view.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(b.save).toHaveBeenCalledWith('docs/plan.md', 'v1', '# 简介\n\n手工修改')
      expect(b.view.getByText('已保存')).toBeTruthy()
    })

    fireEvent.change(editor, { target: { value: '# 简介\n\n尚未保存的第二次修改' } })
    act(() => {
      b.changed()?.({
        sessionId: SID,
        path: 'docs/plan.md',
        baseVersion: 'v2',
        version: 'v3',
        patches: null,
      })
    })
    expect(b.view.getByText('检测到外部修改')).toBeTruthy()
    expect(editor.value).toContain('尚未保存')

    b.load.mockResolvedValueOnce({
      path: 'docs/plan.md',
      format: 'markdown',
      version: 'v3',
      content: '# 简介\n\n模型修改后的内容',
      truncated: false,
    })
    fireEvent.click(b.view.getByText('重新载入'))
    await waitFor(() => { expect(editor.value).toContain('模型修改后的内容') })
  })

  it('searches documents, navigates duplicate outline headings in preview and edit modes, and opens a second window', async () => {
    const secondEntry: DocumentOutlineEntry = {
      id: 'heading:intro-2',
      kind: 'heading',
      title: '简介',
      locator: { unit: 'line', start: 5, end: 5 },
    }
    const b = setup({
      content: '# 简介\n\n正文\n\n## 简介\n\n初始内容',
      entries: [entry, secondEntry],
    })
    fireEvent.click(b.view.getByRole('button', { name: '搜索' }))
    const searchInput = b.view.getByLabelText('搜索文档')
    fireEvent.change(searchInput, { target: { value: '结果' } })
    fireEvent.submit(searchInput.closest('form')!)
    await waitFor(() => { expect(b.search).toHaveBeenCalledWith('结果') })
    fireEvent.click(await b.view.findByRole('button', { name: /搜索结果/ }))
    await waitFor(() => { expect(b.load).toHaveBeenCalledWith('docs/result.md') })

    fireEvent.click(b.view.getByRole('button', { name: '大纲' }))
    const preview = b.view.getByLabelText('文档预览')
    const headings = preview.querySelectorAll('h1, h2, h3, h4, h5, h6')
    Object.defineProperties(preview, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, value: 0, writable: true },
    })
    preview.getBoundingClientRect = vi.fn(() => ({ top: 100 } as DOMRect))
    const secondHeading = headings[1] as HTMLElement
    secondHeading.getBoundingClientRect = vi.fn(() => ({ top: 900 } as DOMRect))
    const outlineButtons = b.view.getAllByRole('button', { name: /简介/ })
    fireEvent.click(outlineButtons[1]!)
    expect(b.view.getByLabelText('文档预览')).toBe(preview)
    expect(preview.scrollTop).toBe(776)

    fireEvent.click(b.view.getByRole('button', { name: '编辑' }))
    fireEvent.click(outlineButtons[1]!)
    const editor = await b.view.findByLabelText('文档编辑器') as HTMLTextAreaElement
    expect(editor.selectionStart).toBe(13)
    expect(editor.selectionEnd).toBe(15)

    const open = vi.fn()
    vi.stubGlobal('open', open)
    fireEvent.click(b.view.getByRole('button', { name: '在新窗口打开' }))
    expect(open).toHaveBeenCalledOnce()
    expect(String(open.mock.calls[0]?.[0])).toContain('path=docs%2Fresult.md')
  })

  it('surfaces document read failures without replacing the editor', async () => {
    const b = setup()
    b.load.mockResolvedValueOnce({ error: 'document unavailable' })
    openByPath(b.view, 'docs/missing.md')
    expect((await b.view.findByRole('alert')).textContent).toContain('document unavailable')
    expect(b.view.getByText('操作失败')).toBeTruthy()
    await waitFor(() => { expect(b.list).toHaveBeenCalledWith('docs') })
  })
})
