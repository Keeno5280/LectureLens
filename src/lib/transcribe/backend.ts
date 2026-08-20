/**
 * Backend selection and fallback for the in-browser Whisper pipeline.
 *
 * Split out of browser.ts (which dynamically imports @huggingface/transformers,
 * pulling in onnxruntime-node/sharp under Vitest's Node environment) so these
 * decisions can be unit-tested directly, without ever importing browser.ts.
 */

export type InferenceDevice = 'webgpu' | 'wasm'

/**
 * `navigator.gpu` being present tells you the browser exposes the WebGPU API
 * *surface* — it does NOT mean a usable GPU adapter exists. Chrome with the
 * GPU blocklisted or running in a VM, Chrome without
 * "--enable-unsafe-webgpu", Safari/Firefox behind flags, headless/CI
 * browsers, and some integrated-GPU + driver combinations all have
 * `navigator.gpu` defined while `requestAdapter()` throws or resolves to
 * null. A plain `'gpu' in navigator` feature-detect is therefore not
 * sufficient on its own — we have to actually probe for a working adapter
 * before committing to the WebGPU path. Don't "simplify" this back to a
 * feature-detect; that's the exact bug this function exists to avoid.
 *
 * `requestAdapter` is injected (rather than read from `navigator` inside
 * this function) so the decision can be unit-tested with a fake, and so
 * callers can pass `undefined` when `navigator.gpu` isn't present at all.
 */
export async function selectBackend(
  requestAdapter: (() => Promise<unknown | null>) | undefined,
): Promise<InferenceDevice> {
  if (!requestAdapter) return 'wasm'
  try {
    const adapter = await requestAdapter()
    return adapter ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
}

/**
 * Runs `run(device)` and, if it throws, transparently retries once with
 * `run('wasm')` — a successful adapter probe (see `selectBackend`) doesn't
 * guarantee the pipeline can actually be constructed or run on that adapter
 * (driver quirks, out-of-memory, mid-session GPU loss, etc). Only if the
 * WASM attempt also fails does an error propagate, and it's a message aimed
 * at the user rather than a leaked backend/device string.
 */
export async function withWasmFallback<T>(
  device: InferenceDevice,
  run: (device: InferenceDevice) => Promise<T>,
): Promise<T> {
  try {
    return await run(device)
  } catch {
    if (device === 'wasm') {
      throw new Error('Transcription failed on this device.')
    }
    try {
      return await run('wasm')
    } catch {
      throw new Error('Transcription failed on this device.')
    }
  }
}
