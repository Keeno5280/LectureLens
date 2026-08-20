import type { Transcriber } from './index'
import { selectBackend, withWasmFallback } from './backend'

/** Minimal shape of `navigator.gpu` we rely on — not in this project's lib.dom.d.ts. */
type NavigatorGPU = { requestAdapter(): Promise<unknown> }

function getRequestAdapter(): (() => Promise<unknown>) | undefined {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return undefined
  const gpu = (navigator as unknown as { gpu?: NavigatorGPU }).gpu
  return gpu ? () => gpu.requestAdapter() : undefined
}

/**
 * Whisper via transformers.js. Prefers WebGPU (near real-time); falls back to
 * WASM CPU, which is markedly slower on long files. Model weights (~40-150MB)
 * are fetched once at runtime and cached by the browser — never bundled.
 *
 * Backend choice is a probe, not a feature-detect (see backend.ts), and the
 * WebGPU pipeline is wrapped so any failure at construction/run time falls
 * back to WASM transparently rather than surfacing a raw backend error.
 */
export function createBrowserTranscriber(): Transcriber {
  return {
    name: 'browser-whisper',
    async transcribe(file, onProgress) {
      const { pipeline } = await import('@huggingface/transformers')

      const device = await selectBackend(getRequestAdapter())
      onProgress(5)

      const progress_callback = (p: { status: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          onProgress(5 + p.progress * 0.35)   // model download = 5%..40%
        }
      }

      const asr = await withWasmFallback(device, (d) =>
        pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', {
          device: d,
          progress_callback,
        }),
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
