import { describe, it, expect, vi } from 'vitest'
import { diagnoseAll, DEFAULT_CONCURRENCY } from './diagnose'

const ok = async () => ({ error: null })

describe('diagnoseAll', () => {
  it('invokes once per item', async () => {
    const invoke = vi.fn(ok)
    const r = await diagnoseAll(['a', 'b', 'c'], invoke)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(r.succeeded).toEqual(['a', 'b', 'c'])
    expect(r.failed).toEqual([])
  })

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0
    let peak = 0
    const invoke = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { error: null }
    })
    await diagnoseAll(['a', 'b', 'c', 'd', 'e', 'f', 'g'], invoke, { concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
    expect(invoke).toHaveBeenCalledTimes(7)
  })

  it('defaults to a cap of 3', () => {
    expect(DEFAULT_CONCURRENCY).toBe(3)
  })

  it('records a returned error WITHOUT counting it as a success', async () => {
    const invoke = vi.fn(async (id: string) =>
      id === 'b' ? { error: { message: 'Claude timed out' } } : { error: null })
    const r = await diagnoseAll(['a', 'b', 'c'], invoke)
    expect(r.succeeded).toEqual(['a', 'c'])
    expect(r.failed).toEqual([{ itemId: 'b', error: 'Claude timed out' }])
  })

  it('treats a thrown exception as a failure rather than losing it', async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('network down')
      return { error: null }
    })
    const r = await diagnoseAll(['a', 'b'], invoke)
    expect(r.succeeded).toEqual(['a'])
    expect(r.failed[0]).toEqual({ itemId: 'b', error: 'network down' })
  })

  it("does not let one item's failure stop its neighbours", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('boom')
      return { error: null }
    })
    const r = await diagnoseAll(['a', 'b', 'c'], invoke)
    expect(r.succeeded).toEqual(['b', 'c'])
    expect(r.failed).toHaveLength(1)
  })

  it('reports progress transitions for each item', async () => {
    const seen: [string, string][] = []
    await diagnoseAll(['a'], ok, { onProgress: (id, s) => seen.push([id, s]) })
    expect(seen).toEqual([['a', 'diagnosing'], ['a', 'completed']])
  })

  it('reports a failed transition on error', async () => {
    const seen: [string, string][] = []
    await diagnoseAll(['a'], async () => ({ error: { message: 'no' } }),
      { onProgress: (id, s) => seen.push([id, s]) })
    expect(seen).toEqual([['a', 'diagnosing'], ['a', 'failed']])
  })

  it('handles an empty list without invoking anything', async () => {
    const invoke = vi.fn(ok)
    expect(await diagnoseAll([], invoke)).toEqual({ succeeded: [], failed: [] })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not lose results or reject when onProgress throws on the diagnosing transition', async () => {
    const invoke = vi.fn(ok)
    const onProgress = (id: string, state: string) => {
      if (id === 'b' && state === 'diagnosing') throw new Error('boom')
    }
    const r = await diagnoseAll(['a', 'b', 'c'], invoke, { onProgress })
    expect(r.succeeded.sort()).toEqual(['a', 'b', 'c'])
    expect(r.failed).toEqual([])
  })

  it('does not double-book an item when onProgress throws on the completed transition', async () => {
    const invoke = vi.fn(ok)
    const onProgress = (id: string, state: string) => {
      if (id === 'a' && state === 'completed') throw new Error('boom')
    }
    const r = await diagnoseAll(['a', 'b', 'c'], invoke, { onProgress })
    expect(r.succeeded).toContain('a')
    expect(r.failed.find((f) => f.itemId === 'a')).toBeUndefined()
    expect(r.succeeded.length + r.failed.length).toBe(3)
  })
})
