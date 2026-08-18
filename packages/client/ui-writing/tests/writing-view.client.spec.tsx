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
  return { view, list, load, save, outline, search, changed: () => changed }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('WritingView', () => {
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

  it('opens, edits, saves, and protects a dirty draft from an external change', async () => {
    const b = setup()
    fireEvent.change(b.view.getByLabelText('工作区相对路径'), { target: { value: 'docs/plan.md' } })
    fireEvent.click(b.view.getByRole('button', { name: '打开文档' }))

    const preview = await b.view.findByLabelText('Markdown 预览')
    expect(preview.textContent).toContain('初始内容')
    fireEvent.click(b.view.getByRole('button', { name: '编辑' }))
    let editor = await b.view.findByLabelText('文档编辑器') as HTMLTextAreaElement
    await waitFor(() => { expect(editor.value).toBe('# 简介\n\n初始内容') })
    fireEvent.change(editor, { target: { value: '# 简介\n\n手工修改' } })
    expect(b.view.getByText('有未保存修改')).toBeTruthy()
    fireEvent.click(b.view.getByRole('button', { name: '预览' }))
    expect(b.view.getByLabelText('Markdown 预览').textContent).toContain('手工修改')
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
    const preview = b.view.getByLabelText('Markdown 预览')
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
    expect(b.view.getByLabelText('Markdown 预览')).toBe(preview)
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
    fireEvent.change(b.view.getByLabelText('工作区相对路径'), { target: { value: 'docs/missing.md' } })
    fireEvent.click(b.view.getByRole('button', { name: '打开文档' }))
    expect((await b.view.findByRole('alert')).textContent).toContain('document unavailable')
    expect(b.view.getByText('操作失败')).toBeTruthy()
    await waitFor(() => { expect(b.list).toHaveBeenCalledWith('docs') })
  })
})
