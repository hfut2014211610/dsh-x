// The About dialog's wording. What makes it worth a test is the runtime line:
// a shell that attached to someone else's `dsh web` behaves differently from
// one that started its own, and this is the only place that difference is
// ever said out loud.
import { describe, expect, it } from 'vitest'
import { aboutMessage, releaseDetail } from '../src/about.ts'

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

describe('releaseDetail', () => {
  // "What changed" is a question people ask exactly when they are being asked
  // to take an update, and the dialog that asks had no answer in it.
  it('carries the release notes under what the update will do', () => {
    const detail = releaseDetail('0.3.1', '- fixed the tray\n- faster startup')

    expect(detail).toContain('You are running 0.3.1')
    expect(detail).toContain('installs when you quit')
    expect(detail).toContain('- fixed the tray')
    expect(detail).toContain('- faster startup')
  })

  it('says only what the update does when the release published no notes', () => {
    expect(releaseDetail('0.3.1', '   \n  ')).toBe(
      'You are running 0.3.1. The update downloads in the background and installs when you quit.',
    )
  })

  // A dialog is not a document. The button is what the dialog is for, and a
  // release with pages of notes would push it off a short screen.
  it('elides notes long enough to bury the buttons', () => {
    const long = Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)}`).join('\n')

    const detail = releaseDetail('0.3.1', long)

    expect(detail).toContain('line 12')
    expect(detail).not.toContain('line 13')
    expect(detail.endsWith('…')).toBe(true)
  })
})
