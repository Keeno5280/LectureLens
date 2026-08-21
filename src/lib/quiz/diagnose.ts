/**
 * Fans out one `diagnose-miss` invocation per missed question.
 *
 * The browser fans out rather than the edge function so each invocation stays
 * small and independent: per-question progress, per-question retry, and a
 * failure on one question that does not touch its neighbours. An internal
 * Promise.all in the function would be one round trip but one point of failure,
 * against a ~150s gateway limit.
 *
 * The invoker is injected so this module is testable without a DOM, a network,
 * or a Supabase client — the honesty branches below are exactly the ones this
 * codebase has historically got wrong.
 */

export type DiagnoseState = 'diagnosing' | 'completed' | 'failed'

/** Mirrors supabase-js's `functions.invoke` result: it RESOLVES with an error, it does not throw. */
export type DiagnoseInvoker = (itemId: string) => Promise<{ error: { message: string } | null }>

export interface FanOutResult {
  succeeded: string[]
  failed: { itemId: string; error: string }[]
}

export interface FanOutOptions {
  concurrency?: number
  onProgress?: (itemId: string, state: DiagnoseState) => void
}

/** Three at a time: enough to keep wall-clock near the slowest single miss, low enough not to trip the Anthropic rate limit. */
export const DEFAULT_CONCURRENCY = 3

export async function diagnoseAll(
  itemIds: string[],
  invoke: DiagnoseInvoker,
  opts: FanOutOptions = {},
): Promise<FanOutResult> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
  const result: FanOutResult = { succeeded: [], failed: [] }

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < itemIds.length) {
      const itemId = itemIds[next++]
      opts.onProgress?.(itemId, 'diagnosing')
      try {
        // supabase-js RESOLVES with { error }; it does not throw. Both paths
        // are handled — checking only one is the bug that shipped seven times.
        const { error } = await invoke(itemId)
        if (error) {
          result.failed.push({ itemId, error: error.message })
          opts.onProgress?.(itemId, 'failed')
        } else {
          result.succeeded.push(itemId)
          opts.onProgress?.(itemId, 'completed')
        }
      } catch (e) {
        result.failed.push({ itemId, error: e instanceof Error ? e.message : String(e) })
        opts.onProgress?.(itemId, 'failed')
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, itemIds.length) }, () => worker()),
  )

  return result
}
