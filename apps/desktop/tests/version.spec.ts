// Version ordering, shared by the runtime picker and the update check. The
// prerelease rule is the one worth pinning: it decides whether an installed
// 0.4.0 is offered a "newer" 0.4.0-rc.1, and whether the npx cache prefers a
// release candidate over the release it led to.
import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/version.ts'

const ascending = (a: string, b: string): boolean => compareVersions(a, b) < 0

describe('compareVersions', () => {
  it('orders numeric segments by value, not as text', () => {
    expect(ascending('0.3.9', '0.3.10')).toBe(true)
    expect(ascending('0.9.0', '0.10.0')).toBe(true)
    expect(ascending('1.0.0', '2.0.0')).toBe(true)
  })

  it('treats missing trailing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(ascending('1.2', '1.2.1')).toBe(true)
  })

  // A prerelease leads to its release, so it must sort BEFORE it. Plain text
  // ordering gets this backwards, and the cost is real in both callers: an
  // installed 0.4.0 would be told 0.4.0-rc.1 is an update.
  it('sorts a prerelease before the release it leads to', () => {
    expect(ascending('0.4.0-rc.1', '0.4.0')).toBe(true)
    expect(ascending('0.1.0-rc.5', '0.1.0-rc.7')).toBe(true)
    expect(compareVersions('0.4.0', '0.4.0-rc.1')).toBeGreaterThan(0)
  })

  it('is equal on identical versions, prerelease included', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3-rc.1', '1.2.3-rc.1')).toBe(0)
  })

  // Both callers compare strings someone else wrote — a cache directory name,
  // a git tag — so garbage has to lose rather than throw mid-launch.
  it('sorts an unparseable version last and keeps the ordering total', () => {
    expect(ascending('nightly', '0.0.1')).toBe(true)
    expect(compareVersions('0.0.1', 'nightly')).toBeGreaterThan(0)
    expect(compareVersions('nightly', 'nightly')).toBe(0)
  })
})
