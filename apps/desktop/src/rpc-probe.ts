/**
 * Unary `host.describe` probe over the /api HTTP carrier. The desktop shell
 * uses it both to recognize an already-serving dsh instance (discovery source
 * one) and as the readiness handshake before a spawned runtime's window shows.
 * @module @deepseek-ai/dsh-desktop-shell/rpc-probe
 */

/** The minimal `host.describe` answer the shell reads. */
export interface HostDescription {
  version: string
}

/**
 * POST one `host.describe` request and validate the echo.
 *
 * Validation is the rpcId discipline of the wire protocol: a dsh host answers
 * with the caller's rpcId and an `ok` result. Anything else on the port — or
 * any non-dsh HTTP server — fails the probe, which callers treat as "not a
 * serving dsh instance". The browser trust fence admits this probe because it
 * targets loopback with no Origin header.
 * @param origin - served origin, for example `http://127.0.0.1:3080`.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @param randomUuid - UUID v4 source for the rpcId.
 * @param timeoutMs - per-attempt timeout; the caller owns the retry loop.
 * @returns the host version, or undefined when the probe fails for any reason.
 */
export async function describeOrigin(
  origin: string,
  fetchImpl: typeof fetch,
  randomUuid: () => string,
  timeoutMs: number,
): Promise<HostDescription | undefined> {
  const rpcId = randomUuid()
  let response: Response
  try {
    response = await fetchImpl(`${origin}/api/host.describe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (record.rpcId !== rpcId) return undefined
  const result = record.result
  if (typeof result !== 'object' || result === null) return undefined
  const { ok, value } = result as Record<string, unknown>
  if (ok !== true) return undefined
  if (typeof value !== 'object' || value === null) return undefined
  const version = (value as Record<string, unknown>).version
  if (typeof version !== 'string' || version === '') return undefined
  return { version }
}
