// The reap that runs before every launch spawns anything. The interesting
// cases are not the happy one — they are the two ways a recorded pid can be
// the wrong thing to kill, because getting either wrong takes down a process
// this shell never started.
import { describe, expect, it, vi } from 'vitest'
import { reapOwnedRuntime, type OwnedRuntimeRecord, type ReapDeps } from '../src/owned-runtime.ts'

function deps(overrides: Partial<ReapDeps> & { record?: OwnedRuntimeRecord } = {}): ReapDeps {
  return {
    readRecord: async () => overrides.record,
    clearRecord: vi.fn(async () => {}),
    describes: vi.fn(async () => true),
    alive: () => true,
    killTree: vi.fn(),
    ...overrides,
  }
}

/** Read one seam back as the mock the helper installed. */
const spy = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>

describe('reapOwnedRuntime', () => {
  it('reports nothing and touches nothing when no previous launch left a record', async () => {
    const collaborators = deps()
    expect(await reapOwnedRuntime(collaborators)).toBeUndefined()
    expect(spy(collaborators.killTree)).not.toHaveBeenCalled()
    expect(spy(collaborators.clearRecord)).not.toHaveBeenCalled()
  })

  it('kills the tree when the recorded pid is alive and still serving its origin', async () => {
    const collaborators = deps({ record: { pid: 4242, origin: 'http://127.0.0.1:51234' } })
    const line = await reapOwnedRuntime(collaborators)

    expect(spy(collaborators.killTree)).toHaveBeenCalledWith(4242)
    expect(line).toContain('4242')
    expect(line).toContain('http://127.0.0.1:51234')
    expect(spy(collaborators.clearRecord)).toHaveBeenCalledTimes(1)
  })

  // The ordinary case: the shell quit properly last time, or the machine went
  // down and took the runtime with it. There is nothing to kill, and the probe
  // must not even be attempted — the origin may belong to someone else now.
  it('kills nothing when the recorded pid has already exited', async () => {
    const collaborators = deps({ record: { pid: 4242, origin: 'http://127.0.0.1:51234' }, alive: () => false })
    const line = await reapOwnedRuntime(collaborators)

    expect(spy(collaborators.killTree)).not.toHaveBeenCalled()
    expect(spy(collaborators.describes)).not.toHaveBeenCalled()
    expect(line).toContain('already exited')
    expect(spy(collaborators.clearRecord)).toHaveBeenCalledTimes(1)
  })

  // Pid reuse is the case that makes a pid-only check unsafe: the number is
  // live, but it names something else entirely now. The recorded origin is
  // what separates the two, and a miss there means walk away.
  it('leaves a reused pid alone when nothing dsh answers on the recorded origin', async () => {
    const collaborators = deps({ record: { pid: 4242, origin: 'http://127.0.0.1:51234' }, describes: async () => false })
    const line = await reapOwnedRuntime(collaborators)

    expect(spy(collaborators.killTree)).not.toHaveBeenCalled()
    expect(line).toContain('reused')
    expect(spy(collaborators.clearRecord)).toHaveBeenCalledTimes(1)
  })

  // A record that survives its launch is re-examined on every later launch,
  // and every re-examination is another chance for its pid to have been
  // reused. Even the path that throws has to leave the note gone.
  it('clears the record even when the kill throws', async () => {
    const collaborators = deps({
      record: { pid: 4242, origin: 'http://127.0.0.1:51234' },
      killTree: vi.fn(() => { throw new Error('access denied') }),
    })

    await expect(reapOwnedRuntime(collaborators)).rejects.toThrow('access denied')
    expect(spy(collaborators.clearRecord)).toHaveBeenCalledTimes(1)
  })
})
