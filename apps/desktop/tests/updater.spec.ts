// The update path, with the network and the disk as seams. The cases that
// matter are the ones where a wrong answer is worse than no answer: a tag
// shape a stock updater cannot read, a release that publishes two files with
// the same extension, and a download whose bytes do not match what was
// published.
import { describe, expect, it, vi } from 'vitest'
import {
  checkForUpdate, downloadUpdate, sha512FromChannel, versionFromTag,
  type UpdateCheck, type UpdaterDeps, type UpdateFeed,
} from '../src/updater.ts'

const FEED: UpdateFeed = { repository: 'owner/repo', currentVersion: '0.3.1', platform: 'win32' }

const RELEASE = {
  tag_name: 'dsh-v0.4.0',
  html_url: 'https://github.com/owner/repo/releases/tag/dsh-v0.4.0',
  assets: [
    { name: 'DeepSeek Harness 0.4.0.exe', browser_download_url: 'https://example.invalid/portable.exe' },
    { name: 'DeepSeek Harness Setup 0.4.0.exe', browser_download_url: 'https://example.invalid/setup.exe' },
    { name: 'DeepSeek Harness-0.4.0.dmg', browser_download_url: 'https://example.invalid/mac.dmg' },
  ],
}

function deps(overrides: Partial<UpdaterDeps> = {}): UpdaterDeps {
  return {
    fetchImpl: async () => new Response(JSON.stringify(RELEASE), { status: 200 }),
    download: async () => 0,
    sha512: async () => 'unset',
    downloadDir: '/tmp/dl',
    ...overrides,
  }
}

describe('versionFromTag', () => {
  // The whole reason this module does not use a stock updater's tag parser:
  // the release tooling in this repository tags `dsh-v0.3.1`, and a parser
  // that only strips a leading `v` reads that as no version at all.
  it('reads the version out of this repository\'s tag shape', () => {
    expect(versionFromTag('dsh-v0.3.1')).toBe('0.3.1')
    expect(versionFromTag('v0.3.1')).toBe('0.3.1')
    expect(versionFromTag('0.3.1')).toBe('0.3.1')
    expect(versionFromTag('desktop-v0.1.0-rc.5')).toBe('0.1.0-rc.5')
  })

  it('reports no version rather than guessing one', () => {
    expect(versionFromTag('nightly')).toBeUndefined()
    expect(versionFromTag('')).toBeUndefined()
  })
})

describe('sha512FromChannel', () => {
  const CHANNEL = [
    'version: 0.4.0',
    'files:',
    '  - url: DeepSeek%20Harness%20Setup%200.4.0.exe',
    '    sha512: c2V0dXA=',
    '    size: 157736935',
    '  - url: DeepSeek%20Harness%200.4.0.exe',
    '    sha512: cG9ydGFibGU=',
    '    size: 157534582',
    'path: DeepSeek%20Harness%20Setup%200.4.0.exe',
    'sha512: c2V0dXA=',
    'releaseDate: 2026-08-19T01:30:04.000Z',
  ].join('\n')

  it('matches the entry for the requested file, not the first one listed', () => {
    expect(sha512FromChannel(CHANNEL, 'DeepSeek Harness 0.4.0.exe')).toBe('cG9ydGFibGU=')
    expect(sha512FromChannel(CHANNEL, 'DeepSeek Harness Setup 0.4.0.exe')).toBe('c2V0dXA=')
  })

  it('reports absence rather than a wrong checksum', () => {
    expect(sha512FromChannel(CHANNEL, 'something-else.exe')).toBeUndefined()
    expect(sha512FromChannel('', 'DeepSeek Harness 0.4.0.exe')).toBeUndefined()
  })

  // The three names the same installer carries, taken from real artifacts:
  // electron-builder writes spaces on disk, records hyphens in the channel
  // file, and GitHub serves dots because it rejects spaces in asset names.
  // Comparing any two verbatim never matches, and the cost of the miss is a
  // download that reports itself as having no checksum to verify against —
  // silently unverified rather than loudly refused.
  it('matches the same installer across the disk, channel, and GitHub name forms', () => {
    const channel = [
      'version: 0.3.2',
      'files:',
      '  - url: DeepSeek-Harness-Setup-0.3.2.exe',
      '    sha512: c2V0dXA=',
      '  - url: DeepSeek-Harness-0.3.2.exe',
      '    sha512: cG9ydGFibGU=',
      'path: DeepSeek-Harness-Setup-0.3.2.exe',
    ].join('\n')

    // As GitHub serves it.
    expect(sha512FromChannel(channel, 'DeepSeek.Harness.Setup.0.3.2.exe')).toBe('c2V0dXA=')
    expect(sha512FromChannel(channel, 'DeepSeek.Harness.0.3.2.exe')).toBe('cG9ydGFibGU=')
    // As it sits on disk.
    expect(sha512FromChannel(channel, 'DeepSeek Harness Setup 0.3.2.exe')).toBe('c2V0dXA=')
    expect(sha512FromChannel(channel, 'DeepSeek Harness 0.3.2.exe')).toBe('cG9ydGFibGU=')
  })

  // Collapsing separators must not collapse the words: the installer and the
  // portable build differ by `Setup`, and confusing them would verify a
  // download against another file's checksum.
  it('still tells the installer apart from the portable build', () => {
    const channel = [
      'files:',
      '  - url: DeepSeek-Harness-0.3.2.exe',
      '    sha512: cG9ydGFibGU=',
    ].join('\n')
    expect(sha512FromChannel(channel, 'DeepSeek.Harness.Setup.0.3.2.exe')).toBeUndefined()
  })
})

describe('checkForUpdate', () => {
  // Windows publishes an installer and a portable build with the same
  // extension. Only the installer can replace an installed app in place, so
  // picking the first match would stage a file that cannot update anything.
  it('picks the installer over the portable build of the same platform', async () => {
    const found = await checkForUpdate(FEED, deps())
    expect(found.status).toBe('available')
    expect(found.status === 'available' && found.assetUrl).toBe('https://example.invalid/setup.exe')
    expect(found.status === 'available' && found.version).toBe('0.4.0')
  })

  it('reports current when the published release is not ahead', async () => {
    const found = await checkForUpdate({ ...FEED, currentVersion: '0.4.0' }, deps())
    expect(found.status).toBe('current')
  })

  // An unattended check must never turn a plane flight into an error dialog.
  it('reports unavailable rather than throwing when the feed cannot be reached', async () => {
    const found = await checkForUpdate(FEED, deps({
      fetchImpl: (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch,
    }))
    expect(found.status).toBe('unavailable')
    expect(found.detail).toContain('unreachable')
  })

  it('reports unavailable when the feed rate-limits the check', async () => {
    const found = await checkForUpdate(FEED, deps({
      fetchImpl: (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch,
    }))
    expect(found.status).toBe('unavailable')
    expect(found.detail).toContain('403')
  })

  it('reports unavailable for a platform with no published installer', async () => {
    const found = await checkForUpdate({ ...FEED, platform: 'linux' }, deps())
    expect(found.status).toBe('unavailable')
    expect(found.detail).toContain('linux')
  })

  it('reports unavailable when the release publishes nothing for this platform', async () => {
    const found = await checkForUpdate(FEED, deps({
      fetchImpl: (async () => new Response(JSON.stringify({ ...RELEASE, assets: [] }), { status: 200 })) as unknown as typeof fetch,
    }))
    expect(found.status).toBe('unavailable')
    expect(found.detail).toContain('no .exe installer')
  })
})

describe('downloadUpdate', () => {
  const AVAILABLE: Extract<UpdateCheck, { status: 'available' }> = {
    status: 'available',
    version: '0.4.0',
    assetName: 'DeepSeek Harness Setup 0.4.0.exe',
    assetUrl: 'https://example.invalid/setup.exe',
    releaseUrl: 'https://example.invalid/release',
    detail: '',
  }
  const CHANNEL = 'files:\n  - url: DeepSeek%20Harness%20Setup%200.4.0.exe\n    sha512: Z29vZA==\n'

  it('verifies the download against the published checksum', async () => {
    const download = vi.fn(async () => 10)
    const staged = await downloadUpdate(AVAILABLE, FEED, deps({
      fetchImpl: (async () => new Response(CHANNEL, { status: 200 })) as unknown as typeof fetch,
      download,
      sha512: async () => 'Z29vZA==',
    }), () => {})

    expect(download).toHaveBeenCalledWith(AVAILABLE.assetUrl, '/tmp/dl/DeepSeek Harness Setup 0.4.0.exe', expect.any(Function))
    expect(staged.path).toBe('/tmp/dl/DeepSeek Harness Setup 0.4.0.exe')
    expect(staged.detail).toContain('verified')
  })

  // Refusing is the only safe answer: the next step hands this file to the
  // operating system to execute with the user's privileges.
  it('refuses an installer whose bytes do not match what was published', async () => {
    await expect(downloadUpdate(AVAILABLE, FEED, deps({
      fetchImpl: (async () => new Response(CHANNEL, { status: 200 })) as unknown as typeof fetch,
      sha512: async () => 'YmFk',
    }), () => {})).rejects.toThrow('does not match its published checksum')
  })

  // Releases cut before the channel file was published have nothing to verify
  // against. The download still proceeds, and the log has to say which of the
  // two happened.
  it('says so when the release published no checksum to verify against', async () => {
    const staged = await downloadUpdate(AVAILABLE, FEED, deps({
      fetchImpl: (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch,
    }), () => {})
    expect(staged.detail).toContain('no checksum')
  })

  it('reports progress as the download advances', async () => {
    const seen: number[] = []
    await downloadUpdate(AVAILABLE, FEED, deps({
      fetchImpl: (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch,
      download: async (_url, _target, onProgress) => { onProgress(5, 10); onProgress(10, 10); return 10 },
    }), received => seen.push(received))
    expect(seen).toEqual([5, 10])
  })
})
