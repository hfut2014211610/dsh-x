import { describe, expect, it } from 'vitest'
import { FAILOVER_CODES, nextFallbackRoute } from '../src/index.ts'

describe('nextFallbackRoute', () => {
  const chains = { m: ['gw', 'backup', 'third'] }

  it('walks to the route after the failed one', () => {
    expect(nextFallbackRoute(chains, 'm', 'gw', 'RATE_LIMIT')).toBe('backup')
    expect(nextFallbackRoute(chains, 'm', 'backup', 'TRANSPORT')).toBe('third')
  })

  it('fails over on quota and credential failures (the backup swaps the credential too)', () => {
    expect(nextFallbackRoute(chains, 'm', 'gw', 'QUOTA')).toBe('backup')
    expect(nextFallbackRoute(chains, 'm', 'gw', 'INVALID_CREDENTIAL')).toBe('backup')
    expect(nextFallbackRoute(chains, 'm', 'gw', 'MISSING_CREDENTIAL')).toBe('backup')
  })

  it('returns undefined at the end of the chain', () => {
    expect(nextFallbackRoute(chains, 'm', 'third', 'RATE_LIMIT')).toBeUndefined()
  })

  it('ignores failures that are not failover-worthy', () => {
    expect(nextFallbackRoute(chains, 'm', 'gw', 'CONTEXT_WINDOW_EXCEEDED')).toBeUndefined()
    expect(nextFallbackRoute(chains, 'm', 'gw', 'UNKNOWN_WHATEVER')).toBeUndefined()
  })

  it('ignores models without a chain and routes outside it', () => {
    expect(nextFallbackRoute(chains, 'other-model', 'gw', 'RATE_LIMIT')).toBeUndefined()
    expect(nextFallbackRoute(chains, undefined, 'gw', 'RATE_LIMIT')).toBeUndefined()
    expect(nextFallbackRoute(chains, 'm', 'not-in-chain', 'RATE_LIMIT')).toBeUndefined()
  })

  it('advertises exactly the documented failover code set', () => {
    expect([...FAILOVER_CODES].sort()).toEqual([
      'EMPTY_RESPONSE',
      'INVALID_CREDENTIAL',
      'MISSING_CREDENTIAL',
      'QUOTA',
      'RATE_LIMIT',
      'SERVER',
      'TIMEOUT',
      'TRANSPORT',
    ])
  })
})
