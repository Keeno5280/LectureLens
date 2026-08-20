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
 * Merges consecutive same-role turns into one, guaranteeing strict
 * user/assistant alternation regardless of what is actually in the DB.
 *
 * This matters because tutor_messages can (and does — both from the n8n
 * era and from a future failed Claude call under the current handler)
 * contain two consecutive 'user' rows: the assistant reply never got
 * written because the call in between failed. The Anthropic Messages API
 * rejects a messages[] array with two consecutive same-role turns with a
 * 400, and every retry would fail identically, wedging the conversation
 * forever. Call this on the full turn list — prior history plus the new
 * turn being appended — right before sending it to the model.
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
  return merged
}
