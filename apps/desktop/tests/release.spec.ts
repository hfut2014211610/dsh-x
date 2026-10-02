import { expect, it } from 'vitest'
import { forkSerialMatchesRelease } from '../src/release.ts'

it('matches a fork-serial application version with its upstream runtime version', () => {
  expect(forkSerialMatchesRelease('0.1.6-alpha.2', '0.1.6-alpha.2')).toBe(true)
  expect(forkSerialMatchesRelease('0.1.6-alpha.2-x.0.14', '0.1.6-alpha.2')).toBe(true)
})

it.each([
  ['0.1.5-rc.1-x.0.13', '0.1.6-alpha.2'],
  ['0.1.6-alpha.2', '0.1.6-alpha.3'],
  ['0.1.6-alpha.2-x.0.14', '0.1.6-alpha.2-x.0.15'],
])('rejects application %s against runtime %s', (appVersion, runtimeVersion) => {
  expect(forkSerialMatchesRelease(appVersion, runtimeVersion)).toBe(false)
})
