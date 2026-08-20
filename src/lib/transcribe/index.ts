export interface Transcriber {
  /** Stored in lectures.transcript_source so a later provider swap can re-run selectively. */
  name: string
  transcribe(file: File, onProgress: (pct: number) => void): Promise<string>
}

export function isTranscribable(file: File): boolean {
  return file.type.startsWith('audio/') || file.type.startsWith('video/')
}

type Loader = () => Promise<Transcriber>

let loader: Loader = async () => (await import('./browser')).createBrowserTranscriber()
let cached: Transcriber | null = null

/** Test seam. Not for production use. */
export function __setTranscriberLoader(l: Loader) { loader = l; cached = null }

export async function getTranscriber(): Promise<Transcriber> {
  if (!cached) cached = await loader()
  return cached
}
