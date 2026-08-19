/**
 * Version ordering shared by the two places that need it: discovery, which
 * picks the newest cached runtime, and the updater, which decides whether a
 * published release is ahead of the running app.
 *
 * Loose rather than strict semver on purpose. Both callers compare strings a
 * third party wrote — an npx cache directory name, a git tag on a release —
 * and the useful behaviour for an unparseable one is to lose the comparison
 * rather than to throw in the middle of a launch.
 * @module @deepseek-ai/dsh-desktop-shell/version
 */

/**
 * Order two version strings: numeric segments first, then the prerelease
 * suffix as text, so `0.3.10` beats `0.3.9` and `0.3.0` beats `0.3.0-rc.7`.
 *
 * A version with no parseable numeric core always loses; two of them compare
 * equal, which keeps the ordering total.
 * @param a - left version.
 * @param b - right version.
 * @returns negative when a sorts first, positive when b does, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const split = (version: string): { nums: number[]; rest: string } => {
    const [core, rest = ''] = version.split(/[-+]/)
    const nums = (core ?? '').split('.').map(part => Number.parseInt(part, 10))
    return { nums: nums.some(part => Number.isNaN(part)) ? [] : nums, rest }
  }
  const left = split(a)
  const right = split(b)
  if (left.nums.length === 0 || right.nums.length === 0) {
    if (left.nums.length === right.nums.length) return 0
    return left.nums.length === 0 ? -1 : 1
  }
  for (let index = 0; index < Math.max(left.nums.length, right.nums.length); index += 1) {
    const delta = (left.nums[index] ?? 0) - (right.nums[index] ?? 0)
    if (delta !== 0) return delta
  }
  // A prerelease sorts BEFORE the release it leads to: an empty suffix is the
  // finished version, and plain text ordering would put it first instead.
  if (left.rest === right.rest) return 0
  if (left.rest === '') return 1
  if (right.rest === '') return -1
  return left.rest < right.rest ? -1 : 1
}
