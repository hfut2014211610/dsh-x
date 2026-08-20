// The About dialog's wording. What makes it worth a test is the runtime line:
// a shell that attached to someone else's `dsh web` behaves differently from
// one that started its own, and this is the only place that difference is
// ever said out loud.
import { describe, expect, it } from 'vitest'
import { aboutMessage } from '../src/about.ts'

const VERSIONS = { electron: '33.2.0', chrome: '130.0.6723.44', node: '20.18.0' }

describe('aboutMessage', () => {
  it('names the attached instance as one this shell does not own', () => {
    const about = aboutMessage({
      appVersion: '0.1.0-rc.7-x.0.4',
      runtime: { source: 'serving-instance', version: '0.1.0-rc.7' },
      url: 'http://127.0.0.1:13080',
      versions: VERSIONS,
    })

    expect(about.message).toBe('DeepSeek Harness 0.1.0-rc.7-x.0.4')
    expect(about.detail).toContain('dsh 0.1.0-rc.7')
    expect(about.detail).toContain('attached')
    expect(about.detail).toContain('leave it running')
    expect(about.detail).toContain('http://127.0.0.1:13080')
  })

  it('distinguishes a runtime the shell started for itself', () => {
    const about = aboutMessage({
      appVersion: '0.1.0-rc.7-x.0.4',
      runtime: { source: 'bundled', version: '0.1.0-rc.7' },
      url: 'http://127.0.0.1:3080',
      versions: VERSIONS,
    })

    expect(about.detail).toContain('bundled with this app')
    expect(about.detail).not.toContain('attached')
  })

  // Opening About while the shell is still looking for a runtime is exactly
  // when someone wants to know what it found, so the dialog says "not yet"
  // rather than leaving the line off and reading as though there is none.
  it('says discovery is still running rather than omitting the runtime', () => {
    const about = aboutMessage({ appVersion: '0.1.0-rc.7', versions: VERSIONS })

    expect(about.detail).toContain('still being discovered')
    expect(about.detail).toContain('Electron 33.2.0')
    expect(about.detail).not.toContain('Serving')
  })
})
