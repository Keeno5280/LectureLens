export interface ContextLecture {
  title: string | null
  summary_overview: string | null
  transcript: string | null
}

export function buildTutorContext(input: {
  lectures: ContextLecture[]
  assignmentPrompt: string | null
}): string {
  const parts: string[] = []

  if (input.lectures.length === 0) {
    parts.push('(No lecture content is available for this class yet.)')
  } else {
    const body = input.lectures.map((l) => {
      const lines = [`[Lecture: ${l.title ?? 'Untitled'}]`]
      if (l.summary_overview?.trim()) lines.push(`Summary: ${l.summary_overview}`)
      if (l.transcript?.trim()) lines.push(`Transcript: ${l.transcript.slice(0, 20000)}`)
      return lines.join('\n')
    }).join('\n\n')
    parts.push(`=== CLASS LECTURE CONTENT ===\n${body}`)
  }

  if (input.assignmentPrompt?.trim()) {
    parts.push(`=== ASSIGNMENT RUBRIC ===\n${input.assignmentPrompt}`)
  }

  return parts.join('\n\n')
}

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Produces a turn list that is always valid to send to the Anthropic
 * Messages API: non-empty-safe, strictly alternating user/assistant, and
 * starting with 'user'. Two passes, and the order between them matters:
 *
 * Pass 1 — merge consecutive same-role turns into one. This matters
 * because tutor_messages can (and does — both from the n8n era and from a
 * failed Claude call under the current handler, which deliberately writes
 * the user row before calling the model) contain two consecutive 'user'
 * rows: the assistant reply never got written because the call in between
 * failed. This pass also establishes the invariant pass 2 depends on:
 * once no two ADJACENT turns share a role, at most the very first turn
 * can be 'assistant' — there is nothing left for a second leading
 * assistant turn to be adjacent to.
 *
 * Pass 2 — drop a single leading 'assistant' turn, if present. The
 * Anthropic API requires messages[0].role === 'user'; a lecture-window
 * fetch that lands on a `created_at DESC LIMIT 10` boundary can easily
 * start mid-conversation on an assistant reply. A single check (not a
 * loop) is correct here ONLY because pass 1 already ran and guarantees
 * there is at most one leading assistant turn to remove — see
 * `normalizeTurns.test.ts` for a case that fails if these passes are
 * reordered. An assistant answer whose question fell out of the history
 * window is weak grounding anyway; losing it to guarantee a valid,
 * non-400ing request is the right trade.
 *
 * Call this on the full turn list — prior history plus the new turn being
 * appended — right before sending it to the model.
 */
export function normalizeTurns(turns: Turn[]): Turn[] {
  const merged: Turn[] = []
  for (const turn of turns) {
    const last = merged[merged.length - 1]
    if (last && last.role === turn.role) {
      last.content = `${last.content}\n${turn.content}`
    } else {
      merged.push({ role: turn.role, content: turn.content })
    }
  }

  if (merged.length > 0 && merged[0].role === 'assistant') {
    return merged.slice(1)
  }
  return merged
}
