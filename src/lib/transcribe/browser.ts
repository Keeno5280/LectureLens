import type { Transcriber } from './index'

/**
 * Whisper via transformers.js. Prefers WebGPU (near real-time); falls back to
 * WASM CPU, which is markedly slower on long files. Model weights (~40-150MB)
 * are fetched once at runtime and cached by the browser — never bundled.
 */
export function createBrowserTranscriber(): Transcriber {
  return {
    name: 'browser-whisper',
    async transcribe(file, onProgress) {
      const { pipeline } = await import('@huggingface/transformers')

      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
      onProgress(5)

      const asr = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-base.en',
        {
          device: hasWebGPU ? 'webgpu' : 'wasm',
          progress_callback: (p: { status: string; progress?: number }) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
              onProgress(5 + p.progress * 0.35)   // model download = 5%..40%
            }
          },
        },
      )
      onProgress(40)

      const audioCtx = new AudioContext({ sampleRate: 16000 })
      const decoded = await audioCtx.decodeAudioData(await file.arrayBuffer())
      const samples = decoded.getChannelData(0)
      onProgress(50)

      const out = await asr(samples, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      })
      onProgress(100)

      const text = Array.isArray(out)
        ? out.map((o) => (o as { text: string }).text).join(' ')
        : (out as { text: string }).text

      if (!text?.trim()) throw new Error('Transcription produced no text.')
      return text.trim()
    },
  }
}
