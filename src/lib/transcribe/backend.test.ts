import { describe, it, expect, vi } from 'vitest'
import { selectBackend, withWasmFallback } from './backend'

describe('selectBackend', () => {
  it('chooses wasm when no requestAdapter is available (no navigator.gpu at all)', async () => {
    expect(await selectBackend(undefined)).toBe('wasm')
  })

  it('chooses webgpu when requestAdapter resolves a usable adapter', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({ fake: 'adapter' })
    expect(await selectBackend(requestAdapter)).toBe('webgpu')
  })

  it('chooses wasm when navigator.gpu exists but requestAdapter resolves null', async () => {
    // This is the real-world case: Chrome with the GPU blocklisted / in a VM,
    // Chrome without --enable-unsafe-webgpu, etc. The API surface is present;
    // there is no usable adapter behind it.
    const requestAdapter = vi.fn().mockResolvedValue(null)
    expect(await selectBackend(requestAdapter)).toBe('wasm')
  })

  it('chooses wasm when requestAdapter throws', async () => {
    const requestAdapter = vi.fn().mockRejectedValue(new Error('Failed to get GPU adapter.'))
    expect(await selectBackend(requestAdapter)).toBe('wasm')
  })
})

describe('withWasmFallback', () => {
  it('returns the webgpu result when it succeeds, without touching wasm', async () => {
    const run = vi.fn().mockResolvedValue('ok')
    const result = await withWasmFallback('webgpu', run)
    expect(result).toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('webgpu')
  })

  it('retries with wasm when the webgpu attempt throws', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('[webgpu] Failed to get GPU adapter.'))
      .mockResolvedValueOnce('ok-on-wasm')
    const result = await withWasmFallback('webgpu', run)
    expect(result).toBe('ok-on-wasm')
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenNthCalledWith(1, 'webgpu')
    expect(run).toHaveBeenNthCalledWith(2, 'wasm')
  })

  it('propagates a useful, non-leaky error when both webgpu and wasm fail', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('[webgpu] Failed to get GPU adapter.'))
      .mockRejectedValueOnce(new Error('wasm backend exploded too'))
    await expect(withWasmFallback('webgpu', run)).rejects.toThrow(
      'Transcription failed on this device.',
    )
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not retry when already on wasm and it fails — propagates directly', async () => {
    const run = vi.fn().mockRejectedValue(new Error('wasm backend exploded'))
    await expect(withWasmFallback('wasm', run)).rejects.toThrow(
      'Transcription failed on this device.',
    )
    expect(run).toHaveBeenCalledTimes(1)
  })
})
