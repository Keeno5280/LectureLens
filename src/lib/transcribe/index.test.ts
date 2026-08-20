import { describe, it, expect, vi } from 'vitest'
import { isTranscribable, getTranscriber, __setTranscriberLoader } from './index'

const file = (type: string, name = 'x') => ({ type, name }) as File

describe('isTranscribable', () => {
  it('accepts audio', () => expect(isTranscribable(file('audio/mpeg'))).toBe(true))
  it('accepts video', () => expect(isTranscribable(file('video/mp4'))).toBe(true))
  it('rejects PDFs — slides go straight to Claude', () =>
    expect(isTranscribable(file('application/pdf'))).toBe(false))
})

describe('getTranscriber', () => {
  it('lazily loads the implementation so Whisper stays out of the main bundle', async () => {
    const loader = vi.fn().mockResolvedValue({
      name: 'fake', transcribe: async () => 'text',
    })
    __setTranscriberLoader(loader)
    expect(loader).not.toHaveBeenCalled()   // not loaded at import time
    const t = await getTranscriber()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(t.name).toBe('fake')
  })

  it('caches the loaded transcriber across calls', async () => {
    const loader = vi.fn().mockResolvedValue({ name: 'fake', transcribe: async () => '' })
    __setTranscriberLoader(loader)
    await getTranscriber(); await getTranscriber()
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
