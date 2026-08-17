/**
 * Writing view for Phase 1.
 * @module @deepseek-ai/dsh-client-ui-writing/WritingView
 */

import { useEffect, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DocumentReadResult } from '@deepseek-ai/dsh-documents/types'

/** Injected document actions supplied by the writing plugin. */
export interface WritingViewInjected {
  load: (path: string) => Promise<DocumentReadResult | { error: string }>
  save: (path: string, baseVersion: string, content: string) => Promise<{ version: string } | { error: string }>
  outline: (path: string) => Promise<readonly { id: string; kind: string; title: string }[]>
  search: (query: string) => Promise<readonly { path: string; title: string; snippet: string }[]>
  subscribeChanged: (fn: () => void) => () => void
}

/**
 * Phase 1 writing surface: a textarea editor backed by the documents Remote,
 * with a simple search overlay and outline rail.
 */
export function WritingView(
  { sessionId, useSessions, load, save, outline, search, subscribeChanged }: ConvViewProps & WritingViewInjected,
) {
  const agentPreset = useSessions(s => s.byId[sessionId]?.agentPreset)
  const [path, setPath] = useState('')
  const [draft, setDraft] = useState('')
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<readonly { id: string; kind: string; title: string }[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly { path: string; title: string; snippet: string }[]>([])

  useEffect(() => subscribeChanged(() => {
    if (path !== '') void handleLoad(path)
  }), [subscribeChanged, path])

  const handleLoad = async (targetPath = path) => {
    setError(null)
    const result = await load(targetPath)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setPath(targetPath)
    setDraft(result.content)
    setVersion(result.version)
    setEntries(await outline(targetPath))
  }

  const handleSave = async () => {
    setError(null)
    const result = await save(path, version, draft)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setVersion(result.version)
  }

  const handleSearch = async () => {
    setError(null)
    setHits(await search(query))
  }

  const openInNewWindow = (targetPath: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('session', sessionId)
    url.searchParams.set('path', targetPath)
    window.open(url.toString(), '_blank')
  }

  return (
    <div data-writing-view={sessionId} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
        <span>Writing mode — {agentPreset ?? 'unknown preset'}</span>
        <span style={{ marginLeft: 12 }}>
          <input
            aria-label="Document path"
            value={path}
            onChange={event => setPath(event.target.value)}
            placeholder="workspace/relative/path.md"
            style={{ width: 180 }}
          />
          <button type="button" onClick={() => handleLoad()}>Load</button>
          <button type="button" onClick={handleSave}>Save</button>
          <button type="button" onClick={() => openInNewWindow(path)}>New window</button>
        </span>
      </header>
      {error !== null && <div role="alert" style={{ padding: '4px 12px', background: '#fdd' }}>{error}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '4px 12px', borderBottom: '1px solid #eee' }}>
            <input
              aria-label="Search documents"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search workspace"
              style={{ width: 200 }}
            />
            <button type="button" onClick={handleSearch}>Search</button>
          </div>
          {hits.length > 0 && (
            <ul style={{ margin: 0, padding: '4px 12px', listStyle: 'none', maxHeight: 120, overflow: 'auto' }}>
              {hits.map(hit => (
                <li key={hit.path}>
                  <button type="button" onClick={() => handleLoad(hit.path)}>{hit.title}</button>
                  <span> — {hit.snippet}</span>
                </li>
              ))}
            </ul>
          )}
          <textarea
            aria-label="Document editor"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Open a document to begin editing."
            style={{ flex: 1, margin: 12, padding: 8, fontFamily: 'monospace' }}
          />
        </div>
        <aside style={{ width: 180, borderLeft: '1px solid #ccc', padding: 8, overflow: 'auto' }}>
          <strong>Outline</strong>
          <ul>
            {entries.map(entry => (
              <li key={entry.id}>{entry.title}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
